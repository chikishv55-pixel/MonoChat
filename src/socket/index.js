const { dbGet, dbRun, dbAll } = require('../db/database');
const bcrypt = require('bcryptjs');
const fs = require('fs').promises;
const path = require('path');
const mime = require('mime-types');
const jwt = require('../utils/jwt');
const { JWT_SECRET } = require('../routes/auth');

const SALT_ROUNDS = 10;

module.exports = function(io, onlineUsers) {
    const joinUserRooms = async (socket, username) => {
        try {
            const memberOf = await dbAll('SELECT group_id FROM group_members WHERE user_username = ?', [username]);
            memberOf.forEach(group => {
                socket.join(`g${group.group_id}`);
            });
        } catch (e) {
            console.error(`Failed to join rooms for ${username}`, e);
        }
    };

    const isMember = async (groupId, username) => {
        if (!groupId.startsWith('g')) return true; // Private chat
        const id = parseInt(groupId.substring(1));
        const membership = await dbGet('SELECT 1 FROM group_members WHERE group_id = ? AND user_username = ?', [id, username]);
        return !!membership;
    };

    const saveMediaDataUrl = async (dataUrl, username, folder = 'media') => {
        const matches = dataUrl.match(/^data:([A-Za-z0-9.+\-/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) throw new Error('Invalid data URL');
        const buffer = Buffer.from(matches[2], 'base64');
        const ext = mime.extension(matches[1]) || 'bin';
        const filename = `${username}_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
        const uploadDir = path.join(__dirname, '../../public/uploads', folder);
        await fs.mkdir(uploadDir, { recursive: true });
        const filePath = path.join(uploadDir, filename);
        await fs.writeFile(filePath, buffer);
        return `/uploads/${folder}/${filename}`;
    };

    io.use(async (socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error('Authentication error'));
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const user = await dbGet(`SELECT username, is_admin, is_moderator, is_banned, display_name, avatar, bio, birth_date, music_status, fcm_token, is_premium, profile_card_bg, profile_effect, custom_badge FROM users WHERE username = ?`, [decoded.username]);
            if (!user) return next(new Error('User not found'));
            if (user.is_banned) return next(new Error('Your account is banned'));
            
            socket.user = user;
            socket.username = user.username;
            socket.isAdmin = !!user.is_admin;
            next();
        } catch (err) {
            next(new Error('Authentication error: Invalid token'));
        }
    });

    // Helper to log administrative actions
    const logAdminAction = async (adminUsername, action, target, details) => {
        try {
            await dbRun("INSERT INTO admin_logs (admin_username, action, target, details) VALUES (?, ?, ?, ?)", [adminUsername, action, target, details]);
        } catch (e) {
            console.error("Failed to log admin action:", e);
        }
    };

    async function sendPushNotification(targetUsername, title, body) {
        try {
            const targetUser = await dbGet(`SELECT fcm_token FROM users WHERE username = ?`, [targetUsername]);
            if (targetUser && targetUser.fcm_token) {
                console.log(`[PUSH] Готово к отправке для ${targetUsername}: ${title} - ${body}`);
            }
        } catch (e) { console.error("Ошибка подготовки Push:", e); }
    }

    io.on('connection', (socket) => {
        const user = socket.user;
        if (!onlineUsers.has(user.username)) {
            onlineUsers.set(user.username, new Set());
        }
        onlineUsers.get(user.username).add(socket.id);
        joinUserRooms(socket, user.username);
        socket.broadcast.emit('user status changed', { username: user.username, online: true });

        socket.on('create_chat', async (data, callback) => {
            if (typeof callback !== 'function') callback = () => {};
            try {
                const me = socket.user;
                if (!me) return callback({ success: false, message: 'Не авторизован' });
                const { name, type, members, avatar } = data;
                const allMembersUsernames = [...new Set([me.username, ...members])];
                const { lastID: groupId } = await dbRun(`INSERT INTO groups (name, type, creator_username, avatar, visibility) VALUES (?, ?, ?, ?, ?)`, [name, type, me.username, avatar || null, 'public']);
                for (const username of allMembersUsernames) {
                    await dbRun(`INSERT INTO group_members (group_id, user_username, role) VALUES (?, ?, ?)`, [groupId, username, (username === me.username ? 'admin' : 'member')]);
                }
                const chatInfo = { id: groupId, name, type, avatar, creator_username: me.username, isGroup: true };
                allMembersUsernames.forEach(username => {
                    const sockets = onlineUsers.get(username);
                    if (sockets) {
                        io.to(Array.from(sockets)).emit('new_chat_created', chatInfo);
                        Array.from(sockets).forEach(id => { const s = io.sockets.sockets.get(id); if (s) s.join(`g${groupId}`); });
                    }
                });
                callback({ success: true, chat: chatInfo });
            } catch (err) { console.error(err); callback({ success: false }); }
        });

        socket.on('add contact', async (data, callback) => {
            if (typeof callback !== 'function') callback = () => {};
            try {
                const me = socket.user;
                const contactUsername = data.username.toLowerCase();
                if (await dbGet('SELECT username FROM users WHERE username = ?', [contactUsername])) {
                    await dbRun(`INSERT OR REPLACE INTO contacts (owner, contact_username, alias) VALUES (?, ?, ?)`, [me.username, contactUsername, data.alias]);
                    callback({ success: true });
                } else callback({ success: false, message: 'Пользователь не найден.' });
            } catch (err) { callback({ success: false }); }
        });

        socket.on('get contacts', async (callback) => {
            if (typeof callback !== 'function') callback = () => {};
            const me = socket.user;
            if (!me) return callback([]);
            callback(await dbAll(`SELECT contact_username, alias FROM contacts WHERE owner = ?`, [me.username]));
        });

        socket.on('search users', async (query, callback) => {
            if (typeof callback !== 'function') callback = () => {};
            try {
                const userRows = await dbAll(`SELECT username, display_name, avatar, bio, birth_date, music_status, is_premium, is_admin, is_moderator, custom_badge, profile_card_bg, profile_effect FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1`, [query.trim()]);
                const groupRows = await dbAll(`SELECT id, name, avatar, type, public_id FROM groups WHERE visibility = 'public' AND (LOWER(name) LIKE LOWER(?) OR LOWER(public_id) = LOWER(?)) LIMIT 5`, [`%${query}%`, query.trim()]);
                const usersResult = userRows.map(u => ({ ...u, isOnline: onlineUsers.has(u.username) }));
                const groupsResult = groupRows.map(g => ({ username: `g${g.id}`, display_name: g.name, avatar: g.avatar, isGroup: true, type: g.type }));
                callback([...usersResult, ...groupsResult]);
            } catch (err) { callback([]); }
        });

        socket.on('get_user_profile', async (data, callback) => {
            if (typeof callback !== 'function') callback = () => {};
            try {
                const user = await dbGet(`SELECT username, display_name, avatar, bio, is_premium, is_admin, is_moderator, custom_badge, profile_card_bg, profile_effect FROM users WHERE username = ?`, [data.username]);
                if (user) {
                    user.isOnline = onlineUsers.has(user.username);
                    callback(user);
                } else callback(null);
            } catch (err) { callback(null); }
        });

        socket.on('get recent chats', async (callback) => {
            if (typeof callback !== 'function') callback = () => {};
            try {
                const me = socket.user;
                if (!me) return callback([]);
                
                // 1. Get all private chat partners and groups
                const privateChatsRows = await dbAll(`SELECT DISTINCT u.username, u.display_name, u.avatar, u.is_premium FROM users u LEFT JOIN messages m ON (u.username = m.sender OR u.username = m.receiver) LEFT JOIN contacts c ON u.username = c.contact_username AND c.owner = ? WHERE (m.sender = ? OR m.receiver = ? OR c.owner = ?) AND u.username != ?`, [me.username, me.username, me.username, me.username, me.username]);
                const groupChatsRows = await dbAll(`SELECT g.id, g.name, g.avatar, g.type FROM groups g JOIN group_members gm ON g.id = gm.group_id WHERE gm.user_username = ?`, [me.username]);
                
                const chats = [
                    ...groupChatsRows.map(g => ({ username: `g${g.id}`, display_name: g.name, avatar: g.avatar, type: g.type, isGroup: true })),
                    ...privateChatsRows.map(u => ({ ...u, isGroup: false, isOnline: onlineUsers.has(u.username) }))
                ];

                // 2. Fetch last messages in batch (or at least more efficiently)
                // For SQL.js we still might need to loop, but we can do it faster
                for (const chat of chats) {
                    if (chat.isGroup) {
                        chat.lastMessage = await dbGet(`SELECT id, sender, text, type, time FROM messages WHERE receiver = ? ORDER BY id DESC LIMIT 1`, [chat.username]);
                    } else {
                        chat.lastMessage = await dbGet(`SELECT id, sender, text, type, time FROM messages WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?) ORDER BY id DESC LIMIT 1`, [me.username, chat.username, chat.username, me.username]);
                    }
                }

                // 3. Sort by last message ID
                chats.sort((a, b) => (b.lastMessage ? b.lastMessage.id : 0) - (a.lastMessage ? a.lastMessage.id : 0));
                callback(chats);
            } catch (err) { console.error('Recent chats error:', err); callback([]); }
        });

        socket.on('update_profile', async (data, callback) => {
            if (typeof callback !== 'function') callback = () => {};
            try {
                const me = socket.user;
                await dbRun(`UPDATE users SET display_name = ?, bio = ?, birth_date = ?, profile_card_bg = ?, profile_effect = ? WHERE username = ?`, [data.displayName, data.bio, data.birthDate, data.profileCardBg, data.profileEffect || 'none', me.username]);
                me.display_name = data.displayName; me.bio = data.bio; me.birth_date = data.birthDate; me.profile_card_bg = data.profileCardBg; me.profile_effect = data.profileEffect || 'none';
                socket.broadcast.emit('user data changed', { username: me.username, display_name: me.display_name });
                callback({ success: true, user: me });
            } catch (err) { callback({ success: false }); }
        });

        socket.on('get history', async (chatWith, callback) => {
            if (typeof callback !== 'function') callback = () => {};
            try {
                const me = socket.user;
                
                // Security check
                if (!(await isMember(chatWith, me.username))) {
                    return callback([]);
                }
                let query = `
                    SELECT m.*, u.is_admin as sender_is_admin, u.is_moderator as sender_is_moderator, u.custom_badge as sender_custom_badge 
                    FROM messages m 
                    LEFT JOIN users u ON m.sender = u.username 
                    WHERE `;
                let rows;
                if (chatWith.startsWith('g')) {
                    rows = await dbAll(query + `receiver = ? ORDER BY m.id ASC`, [chatWith]);
                } else {
                    rows = await dbAll(query + `(sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?) ORDER BY m.id ASC`, [me.username, chatWith, chatWith, me.username]);
                }
                const ids = rows.map(r => r.id);
                if (ids.length > 0) {
                    const reactions = await dbAll(`SELECT * FROM message_reactions WHERE message_id IN (${ids.map(()=>'?').join(',')})`, ids);
                    const comments = await dbAll(`SELECT message_id, COUNT(*) as c FROM message_comments WHERE message_id IN (${ids.map(()=>'?').join(',')}) GROUP BY message_id`, ids);
                    rows.forEach(r => { r.reactions = reactions.filter(re => re.message_id === r.id); r.comment_count = (comments.find(c => c.message_id === r.id) || {c:0}).c; });
                }
                callback(rows.filter(r => !(r.deleted_by && r.deleted_by.includes(me.username))));
            } catch (err) { callback([]); }
        });

        socket.on('private message', async (data) => {
            try {
                const sender = socket.user;
                let { to, text, type, time, duration, replyTo } = data;
                
                // Security check: must be a member to send message
                if (!(await isMember(to, sender.username))) {
                    console.warn(`Unauthorized message attempt by ${sender.username} to ${to}`);
                    return;
                }

                const isGroup = to.startsWith('g');
                let replySnippet = null;
                if (replyTo && replyTo.messageId) {
                    const orig = await dbGet('SELECT text, type, sender FROM messages WHERE id = ?', [replyTo.messageId]);
                    if (orig) replySnippet = `${orig.sender}: ${orig.type === 'text' ? orig.text.substring(0, 50) : orig.type}`;
                }
                
                if ((type==='image' || type==='audio' || type==='circle_video') && text && text.startsWith('data:')) {
                    text = await saveMediaDataUrl(text, sender.username, 'media');
                }
                else if (type==='gallery' && Array.isArray(text)) {
                    let paths = []; 
                    for(let d of text) {
                        if(d.startsWith('data:')) paths.push(await saveMediaDataUrl(d, sender.username, 'media'));
                    }
                    text = JSON.stringify(paths);
                }
                
                const { lastID } = await dbRun("INSERT INTO messages (sender, receiver, text, type, time, duration, reply_to_message_id, reply_snippet) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [sender.username, to, text, type, time, duration || 0, replyTo ? replyTo.messageId : null, replySnippet]);
                
                const msgObj = { 
                    id: lastID, sender: sender.username, text, receiver: to, type, time, duration, 
                    reply_to_message_id: replyTo ? replyTo.messageId : null, reply_snippet: replySnippet,
                    sender_is_admin: sender.is_admin, sender_is_moderator: sender.is_moderator, sender_custom_badge: sender.custom_badge
                };
                
                if (isGroup) io.to(to).emit('private message', msgObj);
                else {
                    const rec = onlineUsers.get(to);
                    if (rec) io.to(Array.from(rec)).emit('private message', msgObj);
                    else sendPushNotification(to, `Новое сообщение от ${sender.display_name}`, type === 'text' ? text : `[${type}]`);
                    const sen = onlineUsers.get(sender.username);
                    if (sen) io.to(Array.from(sen)).emit('private message', msgObj);
                }
            } catch (err) { console.error(err); }
        });

        socket.on('toggle reaction', async (data) => {
            try {
                const me = socket.user;
                const { messageId, emoji } = data;
                const existing = await dbGet('SELECT 1 FROM message_reactions WHERE message_id = ? AND reactor_username = ? AND emoji = ?', [messageId, me.username, emoji]);
                
                if (existing) {
                    await dbRun('DELETE FROM message_reactions WHERE message_id = ? AND reactor_username = ? AND emoji = ?', [messageId, me.username, emoji]);
                } else {
                    await dbRun('INSERT INTO message_reactions (message_id, reactor_username, emoji) VALUES (?, ?, ?)', [messageId, me.username, emoji]);
                }
                
                const msg = await dbGet('SELECT receiver FROM messages WHERE id = ?', [messageId]);
                if (msg) {
                    if (msg.receiver.startsWith('g')) io.to(msg.receiver).emit('reaction toggled', { messageId, emoji, reactor: me.username, added: !existing });
                    else {
                        const rec = onlineUsers.get(msg.receiver); if (rec) io.to(Array.from(rec)).emit('reaction toggled', { messageId, emoji, reactor: me.username, added: !existing });
                        const sen = onlineUsers.get(me.username); if (sen) io.to(Array.from(sen)).emit('reaction toggled', { messageId, emoji, reactor: me.username, added: !existing });
                    }
                }
            } catch (e) { console.error(e); }
        });

        socket.on('forward_message', async (data, callback) => {
            if (typeof callback !== 'function') callback = () => {};
            try {
                const me = socket.user;
                const { messageId, targets } = data;
                const orig = await dbGet('SELECT text, type FROM messages WHERE id = ?', [messageId]);
                if (!orig) return callback({ success: false, message: 'Сообщение не найдено' });

                for (const to of targets) {
                    if (!(await isMember(to, me.username))) continue;
                    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    const { lastID } = await dbRun("INSERT INTO messages (sender, receiver, text, type, time, forwarded_from_username) VALUES (?, ?, ?, ?, ?, ?)", [me.username, to, orig.text, orig.type, time, me.username]);
                    const msgObj = { id: lastID, sender: me.username, text: orig.text, receiver: to, type: orig.type, time, forwarded_from_username: me.username, sender_is_admin: me.is_admin, sender_is_moderator: me.is_moderator, sender_custom_badge: me.custom_badge };
                    
                    if (to.startsWith('g')) io.to(to).emit('private message', msgObj);
                    else {
                        const rec = onlineUsers.get(to); if (rec) io.to(Array.from(rec)).emit('private message', msgObj);
                        const sen = onlineUsers.get(me.username); if (sen) io.to(Array.from(sen)).emit('private message', msgObj);
                    }
                }
                callback({ success: true });
            } catch (e) { console.error(e); callback({ success: false }); }
        });

        socket.on('get_comments', async (messageId, callback) => {
            if (typeof callback !== 'function') callback = () => {};
            try {
                const comments = await dbAll(`
                    SELECT c.*, u.display_name, u.avatar, u.is_premium 
                    FROM message_comments c 
                    JOIN users u ON c.sender = u.username 
                    WHERE c.message_id = ? 
                    ORDER BY c.id ASC`, [messageId]);
                callback(comments);
            } catch (e) { console.error(e); callback([]); }
        });

        socket.on('post_comment', async (data, callback) => {
            if (typeof callback !== 'function') callback = () => {};
            try {
                const me = socket.user;
                const { messageId, text, time } = data;
                const { lastID } = await dbRun("INSERT INTO message_comments (message_id, sender, text, time) VALUES (?, ?, ?, ?)", [messageId, me.username, text, time]);
                const commentObj = { id: lastID, message_id: messageId, sender: me.username, text, time, display_name: me.display_name, avatar: me.avatar, is_premium: me.is_premium };
                
                const msg = await dbGet('SELECT receiver FROM messages WHERE id = ?', [messageId]);
                if (msg) {
                    if (msg.receiver.startsWith('g')) io.to(msg.receiver).emit('new_comment', commentObj);
                    else {
                        const rec = onlineUsers.get(msg.receiver); if (rec) io.to(Array.from(rec)).emit('new_comment', commentObj);
                        const sen = onlineUsers.get(me.username); if (sen) io.to(Array.from(sen)).emit('new_comment', commentObj);
                    }
                }
                callback({ success: true, comment: commentObj });
            } catch (e) { console.error(e); callback({ success: false }); }
        });

        socket.on('post story', async (data) => {
            try {
                const me = socket.user;
                const storiesPath = await saveMediaDataUrl(data.image, me.username, 'stories');
                const expires = Date.now() + (24 * 60 * 60 * 1000);
                await dbRun("INSERT INTO stories (username, image, time, expires) VALUES (?, ?, ?, ?)", [me.username, storiesPath, data.time, expires]);
                io.emit('story_posted', { username: me.username, avatar: me.avatar, image: storiesPath, time: data.time });
            } catch (e) { console.error(e); }
        });

        socket.on('get stories', async (callback) => {
            if (typeof callback !== 'function') callback = () => {};
            try {
                const now = Date.now();
                const stories = await dbAll(`
                    SELECT s.*, u.display_name, u.avatar 
                    FROM stories s 
                    JOIN users u ON s.username = u.username 
                    WHERE s.expires > ? 
                    ORDER BY s.id DESC`, [now]);
                callback(stories);
            } catch (e) { console.error(e); callback([]); }
        });

        socket.on('delete message', async (data) => {
            const me = socket.user;
            const row = await dbGet(`SELECT sender, receiver, deleted_by FROM messages WHERE id = ?`, [data.msgId]);
            if (!row) return;
            if (data.deleteType === 'everyone' && row.sender === me.username) {
                await dbRun(`DELETE FROM messages WHERE id = ?`, [data.msgId]);
                if (row.receiver.startsWith('g')) io.to(row.receiver).emit('message deleted', { msgId: data.msgId });
                else {
                    const r = onlineUsers.get(row.receiver); if (r) io.to(Array.from(r)).emit('message deleted', { msgId: data.msgId });
                    const s = onlineUsers.get(me.username); if (s) io.to(Array.from(s)).emit('message deleted', { msgId: data.msgId });
                }
            } else if (data.deleteType === 'me') {
                let db = row.deleted_by || '';
                if (!db.includes(me.username)) {
                    db += (db ? ',' : '') + me.username;
                    await dbRun(`UPDATE messages SET deleted_by = ? WHERE id = ?`, [db, data.msgId]);
                    socket.emit('message deleted', { msgId: data.msgId });
                }
            }
        });

        // --- ADMIN & MODERATION ---
        socket.on('report_message', async (data, callback) => {
            if (typeof callback !== 'function') callback = () => {};
            try {
                const me = socket.user;
                await dbRun("INSERT INTO reports (message_id, reporter, reason) VALUES (?, ?, ?)", [data.messageId, me.username, data.reason]);
                callback({ success: true });
            } catch (err) { console.error(err); callback({ success: false }); }
        });

        socket.on('admin_get_reports', async (callback) => {
            if (typeof callback !== 'function') callback = () => {};
            try {
                if (!socket.user || (!socket.user.is_admin && !socket.user.is_moderator)) return callback([]);
                const reports = await dbAll(`
                    SELECT r.*, m.text as message_text, m.sender as message_sender, m.type as message_type 
                    FROM reports r 
                    LEFT JOIN messages m ON r.message_id = m.id 
                    ORDER BY r.id DESC
                `);
                callback(reports);
            } catch (err) { console.error(err); callback([]); }
        });

        socket.on('admin_resolve_report', async (data, callback) => {
            if (typeof callback !== 'function') callback = () => {};
            try {
                if (!socket.user || (!socket.user.is_admin && !socket.user.is_moderator)) return callback({ success: false, message: 'Нет прав' });
                await dbRun("DELETE FROM reports WHERE id = ?", [data.reportId]);
                await logAdminAction(socket.username, 'REPORT_RESOLVE', `Report #${data.reportId}`, 'Report marked as resolved');
                callback({ success: true });
            } catch (err) { console.error(err); callback({ success: false, message: err.message }); }
        });

        socket.on('admin_ban_user', async (data, callback) => {
            if (typeof callback !== 'function') callback = () => {};
            try {
                if (!socket.user || !socket.user.is_admin) return callback({ success: false, message: 'Нет прав' });
                await dbRun("UPDATE users SET is_banned = 1 WHERE username = ?", [data.username]);
                await logAdminAction(socket.username, 'USER_BAN', data.username, 'User account suspended');
                callback({ success: true });
            } catch (err) { console.error(err); callback({ success: false }); }
        });

        socket.on('admin_unban_user', async (data, callback) => {
            if (typeof callback !== 'function') callback = () => {};
            try {
                if (!socket.user || !socket.user.is_admin) return callback({ success: false, message: 'Нет прав' });
                await dbRun("UPDATE users SET is_banned = 0 WHERE username = ?", [data.username]);
                await logAdminAction(socket.username, 'USER_UNBAN', data.username, 'User account restored');
                callback({ success: true });
            } catch (err) { console.error(err); callback({ success: false }); }
        });

        socket.on('admin_get_users', async (callback) => {
            if (typeof callback !== 'function') callback = () => {};
            if (!socket.user || !socket.user.is_admin) return callback([]);
            const users = await dbAll("SELECT username, display_name, is_banned, is_admin, is_moderator, custom_badge FROM users LIMIT 200");
            callback(users);
        });

        socket.on('admin_set_role', async (data, callback) => {
            if (typeof callback !== 'function') callback = () => {};
            if (!socket.user || !socket.user.is_admin) return callback({ success: false });
            const { username, role } = data;
            let is_admin = (role === 'admin' ? 1 : 0);
            let is_moderator = (role === 'moderator' ? 1 : 0);
            await dbRun("UPDATE users SET is_admin = ?, is_moderator = ? WHERE username = ?", [is_admin, is_moderator, username]);
            await logAdminAction(socket.username, 'ROLE_CHANGE', username, `New role assigned: ${role.toUpperCase()}`);
            callback({ success: true });
        });

        socket.on('admin_set_badge', async (data, callback) => {
            if (typeof callback !== 'function') callback = () => {};
            if (!socket.user || !socket.user.is_admin) return callback({ success: false });
            await dbRun("UPDATE users SET custom_badge = ? WHERE username = ?", [data.badge, data.username]);
            await logAdminAction(socket.username, 'BADGE_CHANGE', data.username, `Badge set to: ${data.badge || 'None'}`);
            callback({ success: true });
        });

        socket.on('admin_get_logs', async (callback) => {
            if (typeof callback !== 'function') callback = () => {};
            try {
                if (!socket.user || !socket.user.is_admin) return callback([]);
                const logs = await dbAll("SELECT * FROM admin_logs ORDER BY id DESC LIMIT 200");
                callback(logs);
            } catch (err) { console.error(err); callback([]); }
        });

        // --- WebRTC Signaling ---
        socket.on('start_call', (data) => {
            const receiver = onlineUsers.get(data.to);
            if (receiver) {
                data.from = socket.username;
                data.callerName = socket.user.display_name;
                data.callerAvatar = socket.user.avatar;
                io.to(Array.from(receiver)).emit('incoming_call', data);
            }
        });

        socket.on('accept_call', (data) => {
            const receiver = onlineUsers.get(data.to);
            if (receiver) {
                io.to(Array.from(receiver)).emit('call_accepted');
            }
        });

        socket.on('reject_call', (data) => {
            const receiver = onlineUsers.get(data.to);
            if (receiver) {
                io.to(Array.from(receiver)).emit('call_rejected');
            }
        });

        socket.on('end_call', (data) => {
            const receiver = onlineUsers.get(data.to);
            if (receiver) {
                io.to(Array.from(receiver)).emit('call_ended');
            }
        });

        socket.on('webrtc_offer', (data) => {
            const receiver = onlineUsers.get(data.to);
            if (receiver) {
                data.from = socket.username;
                io.to(Array.from(receiver)).emit('webrtc_offer', data);
            }
        });

        socket.on('webrtc_answer', (data) => {
            const receiver = onlineUsers.get(data.to);
            if (receiver) {
                data.from = socket.username;
                io.to(Array.from(receiver)).emit('webrtc_answer', data);
            }
        });

        socket.on('webrtc_ice_candidate', (data) => {
            const receiver = onlineUsers.get(data.to);
            if (receiver) {
                io.to(Array.from(receiver)).emit('webrtc_ice_candidate', data);
            }
        });

        socket.on('disconnect', () => {
            const u = socket.user;
            if (u && onlineUsers.has(u.username)) {
                onlineUsers.get(u.username).delete(socket.id);
                if (onlineUsers.get(u.username).size === 0) {
                    onlineUsers.delete(u.username);
                    socket.broadcast.emit('user status changed', { username: u.username, online: false });
                }
            }
        });
    });
};
