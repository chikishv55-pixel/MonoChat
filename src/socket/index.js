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


    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error('Authentication error: No token'));
        
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            // We need to fetch the user from DB to put in socket.user
            dbGet(`SELECT username, display_name, avatar, bio, birth_date, music_status, fcm_token FROM users WHERE username = ?`, [decoded.username])
                .then(row => {
                    if (!row) return next(new Error('Authentication error: User not found'));
                    socket.user = row;
                    next();
                })
                .catch(err => next(new Error('Authentication error: DB error')));
        } catch (err) {
            next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', (socket) => {

    // On connection, we immediately add them to onlineUsers
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
            if (!name || !type || !Array.isArray(members)) {
                return callback({ success: false, message: 'Неверные данные' });
            }

            // Улучшение: Проверяем, существуют ли все участники
            const allMembersUsernames = [...new Set([me.username, ...members])];
            const placeholders = allMembersUsernames.map(() => '?').join(',');
            const existingUsers = await dbAll(`SELECT username FROM users WHERE username IN (${placeholders})`, allMembersUsernames);

            if (existingUsers.length !== allMembersUsernames.length) {
                const existingUsernames = new Set(existingUsers.map(u => u.username));
                const nonExistentUsers = allMembersUsernames.filter(u => !existingUsernames.has(u));
                return callback({ success: false, message: `Пользователи не найдены: ${nonExistentUsers.join(', ')}` });
            }
            // Конец улучшения

            // 1. Create group
            const { lastID: groupId } = await dbRun(
                `INSERT INTO groups (name, type, creator_username, avatar, visibility) VALUES (?, ?, ?, ?, ?)`,
                [name, type, me.username, avatar || null, 'public'] // Groups are public by default
            );

            // 2. Add members
            const memberInsertPromises = [];

            for (const username of allMembersUsernames) {
                const role = (username === me.username) ? 'admin' : 'member';
                memberInsertPromises.push(
                    dbRun(`INSERT INTO group_members (group_id, user_username, role) VALUES (?, ?, ?)`, [groupId, username, role])
                );
            }
            await Promise.all(memberInsertPromises);

            // 3. Notify members and make them join the room
            const chatInfo = { id: groupId, name, type, avatar, creator_username: me.username, isGroup: true };

            for (const username of allMembersUsernames) {
                const userSocketIds = onlineUsers.get(username);
                if (userSocketIds) {
                    io.to(Array.from(userSocketIds)).emit('new_chat_created', chatInfo);
                    Array.from(userSocketIds).map(id => io.sockets.sockets.get(id)).filter(Boolean).forEach(sock => sock.join(`g${groupId}`));
                }
            }
            
            callback({ success: true, chat: chatInfo });
        } catch (err) {
            console.error('Ошибка создания чата:', err);
            callback({ success: false, message: 'Ошибка на стороне сервера.' });
        }
    });

    socket.on('add contact', async (data, callback) => {
        if (typeof callback !== 'function') callback = () => {};
        try {
            const me = socket.user;
            if (!me) return;

            const contactUsername = data.username.toLowerCase();
            const contactExists = await dbGet('SELECT username FROM users WHERE username = ?', [contactUsername]);
            if (!contactExists) {
                return callback({ success: false, message: 'Пользователь не найден.' });
            }

            await dbRun(`INSERT OR REPLACE INTO contacts (owner, contact_username, alias) VALUES (?, ?, ?)`, 
                [me.username, contactUsername, data.alias]);
            
            callback({ success: true });
        } catch (err) {
            callback({ success: false, message: 'Не удалось добавить контакт.' });
        }
    });

    socket.on('get contacts', async (callback) => {
        if (typeof callback !== 'function') callback = () => {};
        try {
            const me = socket.user;
            if (!me) return callback([]);
            const rows = await dbAll(`SELECT contact_username, alias FROM contacts WHERE owner = ?`, [me.username]);
            callback(rows || []);
        } catch (err) {
            callback([]);
        }
    });

    socket.on('story posted', () => {
        socket.broadcast.emit('new story');
    });
            
            

    socket.on('get stories', async (callback) => {
        if (typeof callback !== 'function') callback = () => {};
        try {
            const me = socket.user;
            if (!me) return callback([]);
            const rows = await dbAll(`SELECT s.*, u.display_name, u.avatar FROM stories s
                JOIN users u ON s.username = u.username
                WHERE (s.username = ? OR s.username IN (SELECT contact_username FROM contacts WHERE owner = ?))
                AND s.expires > ? ORDER BY s.id DESC`, [me.username, me.username, Date.now()]);
            callback(rows || []);
        } catch (err) {
            callback([]);
        }
    });

    socket.on('search users', async (query, callback) => {
        if (typeof callback !== 'function') callback = () => {};
        try {
            if (!query) return callback([]);
            const me = socket.user;
            const userRows = await dbAll(
                `SELECT username, display_name, avatar, bio, birth_date, music_status FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1`,
                [query.trim()]);
            
            const groupRows = await dbAll(`
                SELECT id, name, avatar, type, public_id 
                FROM groups 
                WHERE visibility = 'public' AND (LOWER(name) LIKE LOWER(?) OR LOWER(public_id) = LOWER(?))
                LIMIT 5`,
                [`%${query}%`, query.trim()]);

            const usersResult = (userRows || [])
                .filter(u => u.username !== me?.username) // Не показывать себя в поиске
                .map(u => ({ ...u, isOnline: onlineUsers.has(u.username) }));

            const groupsResult = (groupRows || []).map(g => ({
                username: `g${g.id}`, display_name: g.name, avatar: g.avatar, isGroup: true, type: g.type
            }));

            callback([...usersResult, ...groupsResult]);
        } catch (err) {
            console.error("Search error:", err);
            callback([]);
        }
    });

    socket.on('get recent chats', async (callback) => {
        if (typeof callback !== 'function') callback = () => {};
        try {
            const me = socket.user;
            if (!me) return callback([]);

            // 1. Get recent private chats and contacts
            const privateChatsRows = await dbAll(`
                SELECT DISTINCT u.username, u.display_name, u.avatar, u.bio, u.birth_date, u.music_status
                FROM users u 
                LEFT JOIN messages m ON (u.username = m.sender OR u.username = m.receiver)
                LEFT JOIN contacts c ON u.username = c.contact_username AND c.owner = ?
                WHERE (m.sender = ? OR m.receiver = ? OR c.owner = ?) AND u.username != ?
            `, [me.username, me.username, me.username, me.username, me.username]);
            
            const privateChats = (privateChatsRows || []).map(u => ({ 
                ...u, 
                isOnline: onlineUsers.has(u.username), 
                isGroup: false 
            }));

            // 2. Get all group chats for the user
            const groupChatsRows = await dbAll(`
                SELECT g.id, g.name, g.avatar, g.type, gm.role as my_role,
                       (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
                FROM groups g
                JOIN group_members gm ON g.id = gm.group_id
                WHERE gm.user_username = ?
            `, [me.username]);

            const groupChats = (groupChatsRows || []).map(g => ({
                username: `g${g.id}`, // Use this as the unique ID on the client
                display_name: g.name,
                avatar: g.avatar,
                type: g.type,
                isGroup: true,
                isOnline: false, // Groups don't have an online status
                my_role: g.my_role,
                member_count: g.member_count
            }));

            // 3. Combine and get last message for each
            const allChats = [...groupChats, ...privateChats];
            const lastMessagesPromises = allChats.map(chat => {
                if (chat.isGroup) {
                    return dbGet(`
                        SELECT id, sender, text, type, time 
                        FROM messages 
                        WHERE receiver = ? 
                        ORDER BY id DESC LIMIT 1`, [chat.username]);
                } else {
                    return dbGet(`
                        SELECT id, sender, text, type, time 
                        FROM messages 
                        WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?) 
                        ORDER BY id DESC LIMIT 1`, [me.username, chat.username, chat.username, me.username]);
                }
            });

            const lastMessages = await Promise.all(lastMessagesPromises);

            allChats.forEach((chat, index) => {
                chat.lastMessage = lastMessages[index] || null;
            });

            // 4. Sort chats by last message time (using ID as a proxy for time)
            allChats.sort((a, b) => {
                const idA = a.lastMessage ? a.lastMessage.id : 0;
                const idB = b.lastMessage ? b.lastMessage.id : 0;
                return idB - idA;
            });

            callback(allChats);
        } catch (err) {
            console.error('Error getting recent chats', err);
            callback([]);
        }
    });

    socket.on('update_profile', async (data, callback) => {
        if (typeof callback !== 'function') callback = () => {};
        const cb = callback;
        try {
            const me = socket.user;
            if (!me) return cb({ success: false, message: 'Не авторизован' });

            const { displayName, bio, birthDate } = data;
            // --- Безопасность: Валидация входных данных ---
            if (!displayName || displayName.length < 2 || displayName.length > 30) {
                return cb({ success: false, message: 'Имя должно быть от 2 до 30 символов.' });
            }
            if (bio && bio.length > 200) {
                return cb({ success: false, message: 'Описание не может быть длиннее 200 символов.' });
            }
            // ---
            await dbRun(`UPDATE users SET display_name = ?, bio = ?, birth_date = ? WHERE username = ?`,
                [displayName, bio, birthDate, me.username]);

            const updatedUser = { ...me, display_name: displayName, bio, birth_date: birthDate };
            
            // Обновляем данные на всех сокетах этого пользователя
            const userSocketIds = onlineUsers.get(me.username);
            if (userSocketIds) {
                userSocketIds.forEach(socketId => {
                    const sock = io.sockets.sockets.get(socketId);
                    if (sock) sock.user = updatedUser;
                });
            }

            // Уведомляем всех об изменении имени
            socket.broadcast.emit('user data changed', { username: me.username, display_name: displayName });
            cb({ success: true, user: updatedUser });
        } catch (err) {
            cb({ success: false, message: 'Ошибка сервера при обновлении профиля.' });
        }
    });

    socket.on('update_music_status', async (status, callback) => {
        if (typeof callback !== 'function') callback = () => {};
        const me = socket.user;
        if (!me) return;
        try {
            const cleanStatus = status ? status.substring(0, 80) : null;
            await dbRun(`UPDATE users SET music_status = ? WHERE username = ?`, [cleanStatus, me.username]);
            me.music_status = cleanStatus;
            
            const userSockets = onlineUsers.get(me.username);
            if (userSockets) {
                userSockets.forEach(id => {
                    const sock = io.sockets.sockets.get(id);
                    if (sock) sock.user.music_status = cleanStatus;
                });
            }
            socket.broadcast.emit('user_music_changed', { username: me.username, music_status: cleanStatus });
            if (callback) callback({ success: true, music_status: cleanStatus });
        } catch (e) {
            if (callback) callback({ success: false });
        }
    });

    socket.on('avatar updated', (data) => {
        const me = socket.user;
        if (!me) return;
        me.avatar = data.path;
        
        const userSocketIds = onlineUsers.get(me.username);
        if (userSocketIds) {
            userSocketIds.forEach(socketId => {
                const sock = io.sockets.sockets.get(socketId);
                if (sock) sock.user.avatar = data.path;
            });
        }
        
        socket.broadcast.emit('user data changed', { username: me.username, avatar: data.path });
    });
            
            

    socket.on('get history', async (chatWith, callback) => {
        if (typeof callback !== 'function') callback = () => {};
        try {
            const me = socket.user;
            if (!me) return callback([]);

            let rows;
            if (chatWith.startsWith('g')) {
                // Group chat history
                const groupId = chatWith.substring(1);
                // Optional: check if user is a member before fetching
                const isMember = await dbGet(`SELECT 1 FROM group_members WHERE group_id = ? AND user_username = ?`, [groupId, me.username]);
                if (!isMember) return callback([]);

                rows = await dbAll(
                    `SELECT * FROM messages 
                     WHERE receiver = ? ORDER BY id ASC`,
                    [chatWith]
                );
            } else {
                // Private chat history
                rows = await dbAll(
                    `SELECT * FROM messages 
                     WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?) ORDER BY id ASC`,
                    [me.username, chatWith, chatWith, me.username]
                );
            }

            const messageIds = (rows || []).map(r => r.id);
            if (messageIds.length > 0) {
                const reactions = await dbAll(`
                    SELECT message_id, emoji, reactor_username 
                    FROM message_reactions 
                    WHERE message_id IN (${messageIds.map(() => '?').join(',')})
                `, messageIds);

                const reactionsMap = new Map();
                reactions.forEach(reaction => {
                    if (!reactionsMap.has(reaction.message_id)) reactionsMap.set(reaction.message_id, []);
                    reactionsMap.get(reaction.message_id).push(reaction);
                });

                rows.forEach(row => {
                    row.reactions = reactionsMap.get(row.id) || [];
                });

                const commentsMap = new Map();
                const commentCounts = await dbAll(`
                    SELECT message_id, COUNT(*) as c 
                    FROM message_comments 
                    WHERE message_id IN (${messageIds.map(() => '?').join(',')})
                    GROUP BY message_id
                `, messageIds);
                commentCounts.forEach(cc => commentsMap.set(cc.message_id, cc.c));
                rows.forEach(row => { row.comment_count = commentsMap.get(row.id) || 0; });
            }

            const visible = (rows || []).filter(r => !(r.deleted_by && r.deleted_by.includes(me.username)));
            callback(visible);
        } catch (err) {
            callback([]);
        }
    });

    socket.on('get_group_details', async (groupIdString, callback) => {
        if (typeof callback !== 'function') callback = () => {};
        try {
            const me = socket.user;
            if (!me) return callback({ success: false, message: 'Не авторизован' });

            const groupId = groupIdString.substring(1);
            const group = await dbGet(`SELECT * FROM groups WHERE id = ?`, [groupId]);
            if (!group) return callback({ success: false, message: 'Группа не найдена' });

            const members = await dbAll(`
                SELECT u.username, u.display_name, u.avatar, gm.role
                FROM users u JOIN group_members gm ON u.username = gm.user_username
                WHERE gm.group_id = ?
            `, [groupId]);

            const myRole = members.find(m => m.username === me.username)?.role;
            if (!myRole) return callback({ success: false, message: 'Вы не состоите в этой группе' });

            callback({ success: true, group, members, myRole });
        } catch (err) {
            console.error('Error getting group details:', err);
            callback({ success: false, message: 'Ошибка сервера' });
        }
    });

    socket.on('remove_group_member', async (data, callback) => {
        if (typeof callback !== 'function') callback = () => {};
        try {
            const me = socket.user;
            const { groupId, usernameToRemove } = data;
            if (!me || !groupId || !usernameToRemove) return callback({ success: false, message: 'Неверные данные' });

            const myMembership = await dbGet(`SELECT role FROM group_members WHERE group_id = ? AND user_username = ?`, [groupId, me.username]);
            const targetMembership = await dbGet(`SELECT role FROM group_members WHERE group_id = ? AND user_username = ?`, [groupId, usernameToRemove]);

            if (!myMembership || !targetMembership) return callback({ success: false, message: 'Участник не найден' });

            const isLeaving = me.username === usernameToRemove;
            const isAdmin = myMembership.role === 'admin';

            // Check permissions
            if (!isLeaving && (!isAdmin || targetMembership.role === 'admin')) {
                return callback({ success: false, message: 'Недостаточно прав для удаления этого участника.' });
            }

            // Perform deletion
            await dbRun(`DELETE FROM group_members WHERE group_id = ? AND user_username = ?`, [groupId, usernameToRemove]);

            // Notify all remaining members
            const groupRoom = `g${groupId}`;
            io.to(groupRoom).emit('group_member_removed', { groupId, removedUsername: usernameToRemove, removerUsername: me.username });

            // Make the removed user leave the socket room and notify them
            const removedUserSockets = onlineUsers.get(usernameToRemove);
            if (removedUserSockets) {
                removedUserSockets.forEach(socketId => {
                    const sock = io.sockets.sockets.get(socketId);
                    if (sock) sock.leave(groupRoom);
                });
            }

            callback({ success: true });
        } catch (err) {
            console.error('Error removing group member:', err);
            callback({ success: false, message: 'Ошибка сервера' });
        }
    });

    socket.on('add_group_members', async (data, callback) => {
        if (typeof callback !== 'function') callback = () => {};
        try {
            const me = socket.user;
            const { groupId, members } = data;
            if (!me || !groupId || !Array.isArray(members) || members.length === 0) return callback({ success: false, message: 'Неверные данные' });

            const myMembership = await dbGet(`SELECT role FROM group_members WHERE group_id = ? AND user_username = ?`, [groupId, me.username]);
            if (!myMembership || myMembership.role !== 'admin') {
                return callback({ success: false, message: 'Недостаточно прав' });
            }

            // Add new members
            const insertPromises = members.map(username => 
                dbRun(`INSERT OR IGNORE INTO group_members (group_id, user_username, role) VALUES (?, ?, ?)`, [groupId, username, 'member'])
            );
            await Promise.all(insertPromises);

            const group = await dbGet(`SELECT * FROM groups WHERE id = ?`, [groupId]);
            const newMembersInfo = await dbAll(`SELECT username, display_name, avatar FROM users WHERE username IN (${members.map(()=>'?').join(',')})`, members);

            // Notify existing members
            io.to(`g${groupId}`).emit('group_members_added', { groupId, newMembers: newMembersInfo, addedBy: me.username });

            // Notify new members and make them join
            const chatInfo = { id: groupId, name: group.name, type: group.type, avatar: group.avatar, creator_username: group.creator_username, isGroup: true };
            for (const member of newMembersInfo) {
                const userSocketIds = onlineUsers.get(member.username);
                if (userSocketIds) {
                    io.to(Array.from(userSocketIds)).emit('new_chat_created', chatInfo);
                    Array.from(userSocketIds).map(id => io.sockets.sockets.get(id)).filter(Boolean).forEach(sock => sock.join(`g${groupId}`));
                }
            }

            callback({ success: true, newMembers: newMembersInfo });
        } catch (err) {
            console.error('Error adding group members:', err);
            callback({ success: false, message: 'Ошибка сервера' });
        }
    });

    socket.on('update_group_settings', async (data, callback) => {
        if (typeof callback !== 'function') callback = () => {};
        try {
            const me = socket.user;
            const { groupId, settings } = data;
            if (!me || !groupId || !settings) return callback({ success: false, message: 'Неверные данные' });

            const myMembership = await dbGet(`SELECT role FROM group_members WHERE group_id = ? AND user_username = ?`, [groupId, me.username]);
            if (!myMembership || myMembership.role !== 'admin') {
                return callback({ success: false, message: 'Недостаточно прав' });
            }

            const { name, public_id, visibility } = settings;
            // Basic validation
            if (public_id && !/^[a-z0-9_]{3,30}$/.test(public_id)) {
                return callback({ success: false, message: 'Неверный формат публичного ID. Используйте a-z, 0-9, _ длиной 3-30 символов.' });
            }

            await dbRun(`UPDATE groups SET name = ?, public_id = ?, visibility = ? WHERE id = ?`,
                [name, public_id || null, visibility, groupId]);
            
            io.to(`g${groupId}`).emit('group_settings_updated', { groupId, newSettings: settings });
            callback({ success: true });
        } catch (err) {
            if (err.code === 'SQLITE_CONSTRAINT') {
                return callback({ success: false, message: 'Этот публичный ID уже занят.' });
            }
            console.error('Error updating group settings:', err);
            callback({ success: false, message: 'Ошибка сервера' });
        }
    });

    socket.on('start typing', ({ chatId }) => {
        const user = socket.user;
        if (!user) return;

        if (chatId.startsWith('g')) {
            // Group chat: broadcast to the room, excluding the sender
            socket.to(chatId).emit('user is typing', { 
                displayName: user.display_name, 
                chatId: chatId 
            });
        } else {
            // Private chat: emit to the specific user
            const receiverSocketIds = onlineUsers.get(chatId);
            if (receiverSocketIds) {
                io.to(Array.from(receiverSocketIds)).emit('user is typing', {
                    displayName: user.display_name,
                    chatId: user.username // The chat from their perspective is with the sender
                });
            }
        }
    });

    socket.on('stop typing', ({ chatId }) => {
        const user = socket.user;
        if (!user) return;

        if (chatId.startsWith('g')) {
            socket.to(chatId).emit('user stopped typing', { 
                displayName: user.display_name, 
                chatId: chatId 
            });
        } else {
            const receiverSocketIds = onlineUsers.get(chatId);
            if (receiverSocketIds) {
                io.to(Array.from(receiverSocketIds)).emit('user stopped typing', {
                    displayName: user.display_name,
                    chatId: user.username
                });
            }
        }
    });

    socket.on('toggle reaction', async ({ messageId, emoji }, callback) => {
        if (typeof callback !== 'function') callback = () => {};
        const me = socket.user;
        if (!me || !messageId || !emoji) return;

        try {
            const msg = await dbGet(`SELECT receiver, sender FROM messages WHERE id = ?`, [messageId]);
            if (!msg) return;

            const existingReaction = await dbGet(
                `SELECT 1 FROM message_reactions WHERE message_id = ? AND reactor_username = ? AND emoji = ?`,
                [messageId, me.username, emoji]
            );

            let action;
            if (existingReaction) {
                await dbRun(
                    `DELETE FROM message_reactions WHERE message_id = ? AND reactor_username = ? AND emoji = ?`,
                    [messageId, me.username, emoji]
                );
                action = 'removed';
            } else {
                await dbRun(
                    `INSERT INTO message_reactions (message_id, reactor_username, emoji) VALUES (?, ?, ?)`,
                    [messageId, me.username, emoji]
                );
                action = 'added';
            }

            const reactionData = { messageId, emoji, reactorUsername: me.username, action };

            if (msg.receiver.startsWith('g')) {
                io.to(msg.receiver).emit('reaction updated', reactionData);
            } else {
                const participants = [msg.sender, msg.receiver];
                participants.forEach(username => {
                    const userSockets = onlineUsers.get(username);
                    if (userSockets) {
                        io.to(Array.from(userSockets)).emit('reaction updated', reactionData);
                    }
                });
            }

            callback({ success: true, action });
        } catch (err) {
            console.error('Error toggling reaction:', err);
            callback({ success: false });
        }
    });

    socket.on('private message', async (data) => {
        try {
            const sender = socket.user;
            if (!sender) return;
            
            let { to, text, type, time, duration, replyTo } = data;

            const isGroupMessage = to.startsWith('g');

            if (isGroupMessage) {
                const groupId = to.substring(1);
                // Check if user is a member
                const member = await dbGet(`SELECT role FROM group_members WHERE group_id = ? AND user_username = ?`, [groupId, sender.username]);
                if (!member) {
                    return; // Not a member, can't send
                }
                // For channels, only admins can send
                const groupInfo = await dbGet(`SELECT type FROM groups WHERE id = ?`, [groupId]);
                if (groupInfo && groupInfo.type === 'channel' && member.role !== 'admin') {
                    socket.emit('message failed', { time: data.time, error: 'Только администраторы могут писать в этом канале.' });
                    return;
                }
            }

            let replySnippet = null;
            if (replyTo && replyTo.messageId) {
                const originalMsg = await dbGet('SELECT text, type, sender FROM messages WHERE id = ?', [replyTo.messageId]);
                if (originalMsg) {
                    let snippetText = '';
                    if (originalMsg.type === 'text') {
                        snippetText = originalMsg.text.substring(0, 50);
                    } else if (originalMsg.type === 'image') {
                        snippetText = 'Фото';
                    } else if (originalMsg.type === 'gallery') {
                        snippetText = 'Галерея';
                    } else if (originalMsg.type === 'audio') {
                        snippetText = 'Голосовое сообщение';
                    } else if (originalMsg.type === 'circle_video') {
                        snippetText = 'Видеосообщение';
                    } else if (originalMsg.type === 'sticker') {
                        snippetText = 'Стикер';
                    }
                    replySnippet = `${originalMsg.sender}: ${snippetText}`;
                }
            }

            // Обработка медиафайлов (включая аудио и кружки)
            if ((type === 'image' || type === 'audio' || type === 'circle_video') && text && typeof text === 'string' && text.startsWith('data:')) {
                try {
                    text = await saveMediaDataUrl(text, sender.username);
                } catch (fileError) {
                    console.error('Ошибка сохранения файла сообщения:', fileError);
                    socket.emit('message failed', { time: data.time, error: fileError.message || 'Ошибка сохранения медиафайла' });
                    return;
                }
            } else if (type === 'gallery' && Array.isArray(text)) {
                try {
                    const savedPaths = [];
                    for (const dataUrl of text) {
                        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
                            const publicPath = await saveMediaDataUrl(dataUrl, sender.username);
                            savedPaths.push(publicPath);
                        }
                    }
                    if (savedPaths.length > 0) {
                        text = JSON.stringify(savedPaths); // Сохраняем пути как JSON-строку
                    } else {
                        throw new Error('В галерее нет валидных изображений');
                    }
                } catch (fileError) {
                    console.error('Ошибка сохранения галереи:', fileError);
                    socket.emit('message failed', { time: data.time, error: fileError.message || 'Ошибка сохранения галереи' });
                    return;
                }
            } else if (type === 'image' || type === 'gallery' || type === 'circle_video') {
                if (!text || !text.startsWith('/uploads/')) {
                    socket.emit('message failed', { time: data.time, error: 'Неверные медиа данные' });
                    return;
                }
            }

            const { lastID } = await dbRun("INSERT INTO messages (sender, receiver, text, type, time, duration, reply_to_message_id, reply_snippet) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                   [sender.username, to, text, type, time, duration || 0, replyTo ? replyTo.messageId : null, replySnippet]);

            const msgObj = { id: lastID, sender: sender.username, text, receiver: to, type, time, duration, reply_to_message_id: replyTo ? replyTo.messageId : null, reply_snippet: replySnippet };
            
            if (isGroupMessage) {
                // Broadcast to everyone in the group room (including all of sender's devices)
                io.to(to).emit('private message', msgObj);
            } else { // It's a private message
                // Отправляем сообщение на все устройства получателя
                const receiverSocketIds = onlineUsers.get(to);
                if (receiverSocketIds) {
                    io.to(Array.from(receiverSocketIds)).emit('private message', msgObj);
                }
                // Отправляем сообщение на все устройства отправителя (для синхронизации)
                const senderSocketIds = onlineUsers.get(sender.username);
                if (senderSocketIds) {
                    io.to(Array.from(senderSocketIds)).emit('private message', msgObj);
                }
            }
        } catch (err) {
            console.error('Не удалось отправить личное сообщение от', socket.user?.username, err);
            socket.emit('message failed', { time: data.time, error: 'Ошибка базы данных' });
        }
    });

    socket.on('forward_message', async (data, callback) => {
        if (typeof callback !== 'function') callback = () => {};
        const cb = callback;
        try {
            const me = socket.user;
            if (!me) return;
            const { messageId, targets } = data;
            if (!messageId || !Array.isArray(targets) || targets.length === 0) return;
    
            const originalMsg = await dbGet(`SELECT * FROM messages WHERE id = ?`, [messageId]);
            if (!originalMsg) return;
    
            // Basic check if user can see the message (simplified)
            const isGroupMsg = originalMsg.receiver.startsWith('g');
            let canSee = false;
            if (isGroupMsg) {
                const isMember = await dbGet(`SELECT 1 FROM group_members WHERE group_id = ? AND user_username = ?`, [originalMsg.receiver.substring(1), me.username]);
                if (isMember) canSee = true;
            } else {
                if (originalMsg.sender === me.username || originalMsg.receiver === me.username) canSee = true;
            }
            if (!canSee) return;
    
            const now = new Date();
            const time = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
    
            for (const targetId of targets) {
                const { lastID } = await dbRun(
                    "INSERT INTO messages (sender, receiver, text, type, time, duration, forwarded_from_username) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [me.username, targetId, originalMsg.text, originalMsg.type, time, originalMsg.duration || 0, originalMsg.sender]
                );
                const newMsgObj = { id: lastID, sender: me.username, receiver: targetId, text: originalMsg.text, type: originalMsg.type, time, duration: originalMsg.duration || 0, forwarded_from_username: originalMsg.sender };
    
                if (targetId.startsWith('g')) {
                    io.to(targetId).emit('private message', newMsgObj);
                } else {
                    const targetSockets = onlineUsers.get(targetId);
                    if (targetSockets) io.to(Array.from(targetSockets)).emit('private message', newMsgObj);
                    const senderSockets = onlineUsers.get(me.username);
                    if (senderSockets) io.to(Array.from(senderSockets)).emit('private message', newMsgObj);
                }
            }
            cb({ success: true });
        } catch (err) {
            console.error('Error forwarding message:', err);
            cb({ success: false, message: 'Server error' });
        }
    });

    socket.on('delete message', async (data) => {
        try {
            const me = socket.user;
            if (!me) return;
            const { msgId, deleteType } = data;

            const row = await dbGet(`SELECT sender, receiver, deleted_by FROM messages WHERE id = ?`, [msgId]);
            if (!row) return;

            if (deleteType === 'everyone' && row.sender === me.username) {
                await dbRun(`DELETE FROM messages WHERE id = ?`, [msgId]);

                if (row.receiver.startsWith('g')) {
                    // Уведомляем всех в группе
                    io.to(row.receiver).emit('message deleted', { msgId });
                } else {
                    // Уведомляем все устройства получателя
                    const receiverSocketIds = onlineUsers.get(row.receiver);
                    if (receiverSocketIds) { io.to(Array.from(receiverSocketIds)).emit('message deleted', { msgId }); }
                    // Уведомляем все устройства отправителя
                    const senderSocketIds = onlineUsers.get(me.username);
                    if (senderSocketIds) { io.to(Array.from(senderSocketIds)).emit('message deleted', { msgId }); }
                }
            } else if (deleteType === 'me') {
                let deletedBy = row.deleted_by || '';
                if (!deletedBy.includes(me.username)) {
                    deletedBy += (deletedBy ? ',' : '') + me.username;
                    await dbRun(`UPDATE messages SET deleted_by = ? WHERE id = ?`, [deletedBy, msgId]);
                    socket.emit('message deleted', { msgId });
                }
            }
        } catch (err) {
            console.error('Не удалось удалить сообщение для', socket.user?.username, err);
        }
    });

    socket.on('get_comments', async (messageId, callback) => {
        if (typeof callback !== 'function') callback = () => {};
        try {
            const me = socket.user;
            if (!me) return callback([]);
            
            const msg = await dbGet('SELECT receiver, sender FROM messages WHERE id = ?', [messageId]);
            if (!msg) return callback([]);
            if (msg.receiver.startsWith('g')) {
                const isMember = await dbGet(`SELECT 1 FROM group_members WHERE group_id = ? AND user_username = ?`, [msg.receiver.substring(1), me.username]);
                if (!isMember) return callback([]);
            } else if (msg.sender !== me.username && msg.receiver !== me.username) return callback([]);

            const rows = await dbAll(`
                SELECT c.*, u.display_name, u.avatar 
                FROM message_comments c
                JOIN users u ON c.sender = u.username
                WHERE c.message_id = ? ORDER BY c.id ASC
            `, [messageId]);
            callback(rows || []);
        } catch (err) {
            callback([]);
        }
    });

    socket.on('post_comment', async (data, callback) => {
        if (typeof callback !== 'function') callback = () => {};
        try {
            const me = socket.user;
            if (!me) return callback({ success: false });
            
            const msg = await dbGet('SELECT receiver, sender FROM messages WHERE id = ?', [data.messageId]);
            if (!msg) return callback({ success: false, message: 'Сообщение не найдено' });
            if (msg.receiver.startsWith('g')) {
                const isMember = await dbGet(`SELECT 1 FROM group_members WHERE group_id = ? AND user_username = ?`, [msg.receiver.substring(1), me.username]);
                if (!isMember) return callback({ success: false, message: 'Нет доступа' });
            } else if (msg.sender !== me.username && msg.receiver !== me.username) return callback({ success: false, message: 'Нет доступа' });

            const { messageId, text, time } = data;
            const { lastID } = await dbRun(
                'INSERT INTO message_comments (message_id, sender, text, time) VALUES (?, ?, ?, ?)', 
                [messageId, me.username, text, time]
            );
            
            const comment = { id: lastID, message_id: messageId, sender: me.username, text, time, display_name: me.display_name, avatar: me.avatar };
            
            if (msg.receiver.startsWith('g')) {
                io.to(msg.receiver).emit('new_comment', comment);
            } else {
                const senderSockets = onlineUsers.get(msg.sender);
                if (senderSockets) io.to(Array.from(senderSockets)).emit('new_comment', comment);
                const receiverSockets = onlineUsers.get(msg.receiver);
                if (receiverSockets) io.to(Array.from(receiverSockets)).emit('new_comment', comment);
            }
            callback({ success: true, comment });
        } catch (err) {
            callback({ success: false });
        }
    });

    // --- WebRTC Видеозвонки Сигналинг ---
    socket.on('start_call', (data) => {
        if (!socket.user) return;
        const receiverSockets = onlineUsers.get(data.to);
        if (receiverSockets) {
            io.to(Array.from(receiverSockets)).emit('incoming_call', { from: socket.user.username, callerName: socket.user.display_name, callerAvatar: socket.user.avatar, isVideo: data.isVideo });
        }
    });

    socket.on('accept_call', (data) => {
        if (!socket.user) return;
        const callerSockets = onlineUsers.get(data.to);
        if (callerSockets) io.to(Array.from(callerSockets)).emit('call_accepted', { from: socket.user.username, isVideo: data.isVideo });
    });

    socket.on('reject_call', (data) => {
        if (!socket.user) return;
        const callerSockets = onlineUsers.get(data.to);
        if (callerSockets) io.to(Array.from(callerSockets)).emit('call_rejected', { from: socket.user.username });
    });

    socket.on('end_call', (data) => {
        if (!socket.user) return;
        const peerSockets = onlineUsers.get(data.to);
        if (peerSockets) io.to(Array.from(peerSockets)).emit('call_ended');
    });

    socket.on('webrtc_offer', (data) => {
        if (!socket.user) return;
        const peerSockets = onlineUsers.get(data.to);
        if (peerSockets) io.to(Array.from(peerSockets)).emit('webrtc_offer', { from: socket.user.username, offer: data.offer });
    });

    socket.on('webrtc_answer', (data) => {
        if (!socket.user) return;
        const peerSockets = onlineUsers.get(data.to);
        if (peerSockets) io.to(Array.from(peerSockets)).emit('webrtc_answer', { from: socket.user.username, answer: data.answer });
    });

    socket.on('webrtc_ice_candidate', (data) => {
        if (!socket.user) return;
        const peerSockets = onlineUsers.get(data.to);
        if (peerSockets) io.to(Array.from(peerSockets)).emit('webrtc_ice_candidate', { from: socket.user.username, candidate: data.candidate });
    });

    // --- Функция для отправки Push уведомлений (Подготовка) ---
    // В будущем здесь будет использоваться firebase-admin SDK
    async function sendPushNotification(targetUsername, title, body) {
        try {
            const targetUser = await dbGet(`SELECT fcm_token FROM users WHERE username = ?`, [targetUsername]);
            if (targetUser && targetUser.fcm_token) {
                console.log(`[PUSH] Готово к отправке для ${targetUsername} на токен ${targetUser.fcm_token}: ${title} - ${body}`);
                // Сюда добавим код Firebase Admin SDK
            }
        } catch (e) { console.error("Ошибка подготовки Push:", e); }
    }

    socket.on('disconnect', () => {
        const user = socket.user;
        if (user && onlineUsers.has(user.username)) {
            const userSockets = onlineUsers.get(user.username);
            userSockets.delete(socket.id);

            // Если это было последнее соединение пользователя
            if (userSockets.size === 0) {
                onlineUsers.delete(user.username);
                socket.broadcast.emit('user status changed', { username: user.username, online: false });
            }
        }
    });
});
};
