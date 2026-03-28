const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs').promises;

// Path to chat.db from the root directory
const dbPath = path.join(__dirname, '../../chat.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Ошибка подключения к БД:', err);
        process.exit(1);
    } else {
        console.log('Подключено к базе данных SQLite.');
    }
});

// --- Обертки для работы с базой данных через async/await ---
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
        if (err) {
            if (err.code !== 'SQLITE_CONSTRAINT') {
                console.error('Ошибка выполнения запроса:', sql, params, err.message);
            }
            reject(err);
        } else {
            resolve({ lastID: this.lastID, changes: this.changes });
        }
    });
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
        if (err) {
            console.error('Ошибка получения записи:', sql, params, err.message);
            reject(err);
        } else {
            resolve(row);
        }
    });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('Ошибка получения записей:', sql, params, err.message);
            reject(err);
        } else {
            resolve(rows);
        }
    });
});

// --- Инициализация таблиц в БД ---
async function initDB() {
    try {
        await dbRun(`CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender TEXT,
            receiver TEXT,
            text TEXT,
            type TEXT DEFAULT 'text', 
            time TEXT,
            duration REAL DEFAULT 0,
            deleted_by TEXT DEFAULT '',
            reply_to_message_id INTEGER,
            reply_snippet TEXT,
            forwarded_from_username TEXT
        )`);
        
        await dbRun(`CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            display_name TEXT,
            password TEXT,
            avatar TEXT,
            bio TEXT,
            birth_date TEXT,
            music_status TEXT,
            fcm_token TEXT,
            is_premium INTEGER DEFAULT 0
        )`);

        await dbRun(`CREATE TABLE IF NOT EXISTS contacts (
            owner TEXT,
            contact_username TEXT,
            alias TEXT,
            PRIMARY KEY(owner, contact_username)
        )`);

        await dbRun(`CREATE TABLE IF NOT EXISTS stories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            image TEXT,
            time TEXT,
            expires INTEGER
        )`);

        await dbRun(`CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            avatar TEXT,
            type TEXT NOT NULL, -- 'group' or 'channel',
            creator_username TEXT NOT NULL,
            public_id TEXT UNIQUE, -- e.g. @mycoolgroup
            visibility TEXT NOT NULL DEFAULT 'public' -- 'public' or 'private'
        )`);

        await dbRun(`CREATE TABLE IF NOT EXISTS group_members (
            group_id INTEGER NOT NULL,
            user_username TEXT NOT NULL,
            role TEXT NOT NULL, -- 'admin' or 'member'
            PRIMARY KEY(group_id, user_username)
        )`);

        await dbRun(`CREATE TABLE IF NOT EXISTS message_reactions (
            message_id INTEGER NOT NULL,
            reactor_username TEXT NOT NULL,
            emoji TEXT NOT NULL,
            PRIMARY KEY(message_id, reactor_username, emoji),
            FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
        )`);

        await dbRun(`CREATE TABLE IF NOT EXISTS message_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER NOT NULL,
            sender TEXT NOT NULL,
            text TEXT NOT NULL,
            time TEXT NOT NULL,
            FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
        )`);

        // --- Миграция схемы для существующих баз данных ---
        const addColumnIfNotExists = async (table, column, type) => {
            const columns = await dbAll(`PRAGMA table_info(${table})`);
            if (!columns.some(c => c.name === column)) {
                await dbRun(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
            }
        };

        await addColumnIfNotExists('messages', 'reply_to_message_id', 'INTEGER');
        await addColumnIfNotExists('messages', 'reply_snippet', 'TEXT');
        await addColumnIfNotExists('users', 'bio', 'TEXT');
        await addColumnIfNotExists('users', 'birth_date', 'TEXT');
        await addColumnIfNotExists('messages', 'forwarded_from_username', 'TEXT');
        await addColumnIfNotExists('users', 'music_status', 'TEXT');
        await addColumnIfNotExists('users', 'fcm_token', 'TEXT');
        await addColumnIfNotExists('users', 'is_premium', 'INTEGER DEFAULT 0');

        // Создаем папки для загрузок, если их нет
        const uploadsDir = path.join(__dirname, '../../public/uploads');
        await fs.mkdir(path.join(uploadsDir, 'avatars'), { recursive: true });
        await fs.mkdir(path.join(uploadsDir, 'stories'), { recursive: true });
        await fs.mkdir(path.join(uploadsDir, 'media'), { recursive: true });
        console.log('Папки для загрузок готовы и БД инициализирована.');
        
        return true;
    } catch (err) {
        console.error('Ошибка инициализации БД:', err);
        throw err;
    }
}

module.exports = {
    db,
    dbRun,
    dbGet,
    dbAll,
    initDB
};
