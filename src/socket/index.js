const { dbGet, dbRun, dbAll } = require('../db/database');
const bcrypt = require('bcrypt');
const fs = require('fs').promises;
const path = require('path');
const mime = require('mime-types');
const jwt = require('../utils/jwt');
const { JWT_SECRET } = require('../routes/auth');

const SALT_ROUNDS = 10;
const loginAttempts = new Map();
const registerAttempts = new Map();
const AUTH_ATTEMPTS_LIMIT = 5;
const AUTH_ATTEMPTS_WINDOW = 5 * 60 * 1000;

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

    const saveMediaDataUrl = async (dataUrl, username) => {
        const matches = dataUrl.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) throw new Error('Invalid data URL');
        const buffer = Buffer.from(matches[2], 'base64');
        const ext = mime.extension(matches[1]) || 'bin';
        const filename = `${username}_${Date.now()}.${ext}`;
        const uploadDir = path.join(__dirname, '../../public/uploads');
        await fs.mkdir(uploadDir, { recursive: true });
        const filePath = path.join(uploadDir, filename);
        await fs.writeFile(filePath, buffer);
        return `/uploads/${filename}`;
    };

    io.use(async (socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error('Authentication error'));
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const user = await dbGet(`SELECT username, is_admin, is_banned, display_name, avatar, bio, birth_date, music_status, fcm_token, is_premium FROM users WHERE username = ?`, [decoded.username]);
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

    // Helper functions
    async function sendPushNotification(targetUsername, title, body) {
        try {
            const targetUser = await dbGet(`SELECT fcm_token FROM users WHERE username = ?`, [targetUsername]);
            if (targetUser && targetUser.fcm_token) {
                console.log(`[PUSH] Готово к отправке для ${targetUsername} на токен ${targetUser.fcm_token}: ${title} - ${body}`);
                // Placeholder for Firebase Admin SDK:
                // admin.messaging().sendToDevice(targetUser.fcm_token, { notification: { title, body } });
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
                if (!name || !type || !Array.isArray(members)) return callback({ success: false, message: 'Неверные данные' });
                const allMembersUsernames = [...new Set([me.username, ...members])];
                const placeholders = allMembersUsernames.map(() => '?').join(',');
                const existingUsers = await dbAll(`SELECT username FROM users WHERE username IN (${placeholders})`, allMembersUsernames);
                if (existingUsers.length !== allMembersUsernames.length) return callback({ success: false, message: 'Один или несколько пользователей не найдены.' });
                
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
                if (!me) return;
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
                if (!query) return callback([]);
                const me = socket.user;
                const userRows = await dbAll(`SELECT username, display_name, avatar, bio, birth_date, music_status, is_premium FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1`, [query.trim()]);
                const groupRows = await dbAll(`SELECT id, name, avatar, type, public_id FROM groups WHERE visibility = 'public' AND (LOWER(name) LIKE LOWER(?) OR LOWER(public_id) = LOWER(?)) LIMIT 5`, [`%${query}%`, query.trim()]);
                const usersResult = (userRows || []).filter(u => u.username !== me?.username).map(u => ({ ...u, isOnline: onlineUsers.has(u.username) }));
                const groupsResult = (groupRows || []).map(g => ({ username: `g${g.id}`, display_name: g.name, avatar: g.avatar, isGroup: true, type: g.type }));
                callback([...usersResult, ...groupsResult]);
            } catch (err) { callback([]); }
        });

        socket.on('get recent chats', async (callback) => {
            if (typeof callback !== 'function') callback = () => {};
            try {
                const me = socket.user;
                if (!me) return callback([]);
                const privateChatsRows = await dbAll(`SELECT DISTINCT u.username, u.display_name, u.avatar, u.bio, u.birth_date, u.music_status, u.is_premium FROM users u LEFT JOIN messages m ON (u.username = m.sender OR u.username = m.receiver) LEFT JOIN contacts c ON u.username = c.contact_username AND c.owner = ? WHERE (m.sender = ? OR m.receiver = ? OR c.owner = ?) AND u.username != ?`, [me.username, me.username, me.username, me.username, me.username]);
                const privateChats = (privateChatsRows || []).map(u => ({ ...u, isOnline: onlineUsers.has(u.username), isGroup: false }));
                const groupChatsRows = await dbAll(`SELECT g.id, g.name, g.avatar, g.type, gm.role as my_role, (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count FROM groups g JOIN group_members gm ON g.id = gm.group_id WHERE gm.user_username = ?`, [me.username]);
                const groupChats = (groupChatsRows || []).map(g => ({ username: `g${g.id}`, display_name: g.name, avatar: g.avatar, type: g.type, isGroup: true, my_role: g.my_role, member_count: g.member_count }));
                const allChats = [...groupChats, ...privateChats];
                for (const chat of allChats) {
                    chat.lastMessage = chat.isGroup ? await dbGet(`SELECT id, sender, text, type, time FROM messages WHERE receiver = ? ORDER BY id DESC LIMIT 1`, [chat.username]) : await dbGet(`SELECT id, sender, text, type, time FROM messages WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?) ORDER BY id DESC LIMIT 1`, [me.username, chat.username, chat.username, me.username]);
                }
                allChats.sort((a, b) => (b.lastMessage ? b.lastMessage.id : 0) - (a.lastMessage ? a.lastMessage.id : 0));
                callback(allChats);
            } catch (err) { callback([]); }
        });

        socket.on('update_profile', async (data, callback) => {
            if (typeof callback !== 'function') callback = () => {};
            try {
                const me = socket.user;
                if (!me) return callback({ success: false });
                await dbRun(`UPDATE users SET display_name = ?, bio = ?, birth_date = ? WHERE username = ?`, [data.displayName, data.bio, data.birthDate, me.username]);
                me.display_name = data.displayName; me.bio = data.bio; me.birth_date = data.birthDate;
                socket.broadcast.emit('user data changed', { username: me.username, display_name: me.display_name });
                callback({ success: true, user: me });
            } catch (err) { callback({ success: false }); }
        });

        socket.on('update_music_status', async (status, callback) => {
            if (typeof callback !== 'function') callback = () => {};
            const me = socket.user; if (!me) return;
            try {
                await dbRun(`UPDATE users SET music_status = ? WHERE username = ?`, [status, me.username]);
                me.music_status = status;
                socket.broadcast.emit('user_music_changed', { username: me.username, music_status: status });
                callback({ success: true });
            } catch (e) { callback({ success: false }); }
        });

        socket.on('get history', async (chatWith, callback) => {
            if (typeof callback !== 'function') callback = () => {};
            try {
                const me = socket.user; if (!me) return callback([]);
                let rows = chatWith.startsWith('g') ? await dbAll(`SELECT * FROM messages WHERE receiver = ? ORDER BY id ASC`, [chatWith]) : await dbAll(`SELECT * FROM messages WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?) ORDER BY id ASC`, [me.username, chatWith, chatWith, me.username]);
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
                const sender = socket.user; if (!sender) return;
                let { to, text, type, time, duration, replyTo } = data;
                const isGroup = to.startsWith('g');
                if (isGroup) {
                    const m = await dbGet(`SELECT role FROM group_members WHERE group_id = ? AND user_username = ?`, [to.substring(1), sender.username]);
                    if (!m) return;
                }
                
                let replySnippet = null;
                if (replyTo && replyTo.messageId) {
                    const orig = await dbGet('SELECT text, type, sender FROM messages WHERE id = ?', [replyTo.messageId]);
                    if (orig) replySnippet = `${orig.sender}: ${orig.type === 'text' ? orig.text.substring(0, 50) : orig.type}`;
                }

                if ((type==='image' || type==='audio' || type==='circle_video') && text && text.startsWith('data:')) text = await saveMediaDataUrl(text, sender.username);
                else if (type==='gallery' && Array.isArray(text)) {
                    let paths = []; for(let d of text) if(d.startsWith('data:')) paths.push(await saveMediaDataUrl(d, sender.username));
                    text = JSON.stringify(paths);
                }

                const { lastID } = await dbRun("INSERT INTO messages (sender, receiver, text, type, time, duration, reply_to_message_id, reply_snippet) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [sender.username, to, text, type, time, duration || 0, replyTo ? replyTo.messageId : null, replySnippet]);
                const msgObj = { id: lastID, sender: sender.username, text, receiver: to, type, time, duration, reply_to_message_id: replyTo ? replyTo.messageId : null, reply_snippet: replySnippet };
                
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

        socket.on('forward_message', async (data) => {
            const me = socket.user; if (!me) return;
            const orig = await dbGet(`SELECT * FROM messages WHERE id = ?`, [data.messageId]);
            if (!orig) return;
            const time = `${new Date().getHours()}:${new Date().getMinutes().toString().padStart(2,'0')}`;
            for (const target of data.targets) {
                const { lastID } = await dbRun("INSERT INTO messages (sender, receiver, text, type, time, duration, forwarded_from_username) VALUES (?, ?, ?, ?, ?, ?, ?)", [me.username, target, orig.text, orig.type, time, orig.duration || 0, orig.sender]);
                const msg = { id: lastID, sender: me.username, receiver: target, text: orig.text, type: orig.type, time, duration: orig.duration || 0, forwarded_from_username: orig.sender };
                if (target.startsWith('g')) io.to(target).emit('private message', msg);
                else {
                    const r = onlineUsers.get(target); if (r) io.to(Array.from(r)).emit('private message', msg);
                    const s = onlineUsers.get(me.username); if (s) io.to(Array.from(s)).emit('private message', msg);
                }
            }
        });

        socket.on('delete message', async (data) => {
            const me = socket.user; if (!me) return;
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

        socket.on('toggle reaction', async (data) => {
            const me = socket.user; if (!me) return;
            const existing = await dbGet(`SELECT 1 FROM message_reactions WHERE message_id = ? AND reactor_username = ? AND emoji = ?`, [data.messageId, me.username, data.emoji]);
            if (existing) await dbRun(`DELETE FROM message_reactions WHERE message_id = ? AND reactor_username = ? AND emoji = ?`, [data.messageId, me.username, data.emoji]);
            else await dbRun(`INSERT INTO message_reactions (message_id, reactor_username, emoji) VALUES (?, ?, ?)`, [data.messageId, me.username, data.emoji]);
            const msg = await dbGet(`SELECT receiver, sender FROM messages WHERE id = ?`, [data.messageId]);
            const reactionData = { messageId: data.messageId, emoji: data.emoji, reactorUsername: me.username, action: existing ? 'removed' : 'added' };
            if (msg.receiver.startsWith('g')) io.to(msg.receiver).emit('reaction updated', reactionData);
            else { [msg.sender, msg.receiver].forEach(u => { const s = onlineUsers.get(u); if (s) io.to(Array.from(s)).emit('reaction updated', reactionData); }); }
        });

        socket.on('get_comments', async (messageId, cb) => {
            const rows = await dbAll(`SELECT c.*, u.display_name, u.avatar, u.is_premium FROM message_comments c JOIN users u ON c.sender = u.username WHERE c.message_id = ? ORDER BY c.id ASC`, [messageId]);
            cb(rows || []);
        });

        socket.on('post_comment', async (data, cb) => {
            const me = socket.user; if (!me) return cb({success:false});
            const { lastID } = await dbRun('INSERT INTO message_comments (message_id, sender, text, time) VALUES (?, ?, ?, ?)', [data.messageId, me.username, data.text, data.time]);
            const comment = { id: lastID, message_id: data.messageId, sender: me.username, text: data.text, time: data.time, display_name: me.display_name, avatar: me.avatar, is_premium: me.is_premium };
            const msg = await dbGet('SELECT receiver, sender FROM messages WHERE id = ?', [data.messageId]);
            if (msg.receiver.startsWith('g')) io.to(msg.receiver).emit('new_comment', comment);
            else { [msg.sender, msg.receiver].forEach(u => { const s = onlineUsers.get(u); if (s) io.to(Array.from(s)).emit('new_comment', comment); }); }
            cb({ success: true, comment });
        });

        socket.on('start typing', (data) => {
            socket.to(data.chatId).emit('user is typing', { displayName: socket.user.display_name, chatId: data.chatId.startsWith('g') ? data.chatId : socket.user.username });
        });

        socket.on('stop typing', (data) => {
            socket.to(data.chatId).emit('user stopped typing', { displayName: socket.user.display_name, chatId: data.chatId.startsWith('g') ? data.chatId : socket.user.username });
        });

        socket.on('start_call', (data) => {
            if (!socket.user) return;
            const rec = onlineUsers.get(data.to);
            if (rec) io.to(Array.from(rec)).emit('incoming_call', { from: socket.user.username, callerName: socket.user.display_name, callerAvatar: socket.user.avatar, isVideo: data.isVideo });
            sendPushNotification(data.to, 'Входящий звонок', `Вам звонит ${socket.user.display_name}`);
        });

        socket.on('accept_call', (data) => {
            const c = onlineUsers.get(data.to); if (c) io.to(Array.from(c)).emit('call_accepted', { from: socket.user.username, isVideo: data.isVideo });
        });

        socket.on('reject_call', (data) => {
            const c = onlineUsers.get(data.to); if (c) io.to(Array.from(c)).emit('call_rejected', { from: socket.user.username });
        });

        socket.on('end_call', (data) => {
            const p = onlineUsers.get(data.to); if (p) io.to(Array.from(p)).emit('call_ended');
        });

        socket.on('webrtc_offer', (data) => {
            const p = onlineUsers.get(data.to); if (p) io.to(Array.from(p)).emit('webrtc_offer', { from: socket.user.username, offer: data.offer });
        });

        socket.on('webrtc_answer', (data) => {
            const p = onlineUsers.get(data.to); if (p) io.to(Array.from(p)).emit('webrtc_answer', { from: socket.user.username, answer: data.answer });
        });

        socket.on('webrtc_ice_candidate', (data) => {
            const p = onlineUsers.get(data.to); if (p) io.to(Array.from(p)).emit('webrtc_ice_candidate', { from: socket.user.username, candidate: data.candidate });
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
