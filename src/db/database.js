const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs').promises;

// Path to chat.db from the root directory
const dbPath = path.join(__dirname, '../../chat.db');

let dbInstance = null;

/**
 * better-sqlite3 handles disk persistence automatically.
 * These functions are kept for compatibility with existing code.
 */
async function saveDB() {
    // No-op for better-sqlite3
    return Promise.resolve();
}

async function saveDBImmediate() {
    // No-op or sync closing if needed, but not required for graceful shutdown in simple cases
    return Promise.resolve();
}

// --- Wrappers for DB operations using better-sqlite3 (keeping async for compatibility) ---
const dbRun = async (sql, params = []) => {
    if (!dbInstance) throw new Error('БД не инициализирована');
    try {
        const stmt = dbInstance.prepare(sql);
        const info = stmt.run(params);
        return { lastID: info.lastInsertRowid, changes: info.changes };
    } catch (err) {
        if (err.message && !err.message.includes('UNIQUE constraint failed')) {
            console.error('Ошибка выполнения запроса:', sql, params, err.message);
        }
        throw err;
    }
};

const dbGet = async (sql, params = []) => {
    if (!dbInstance) throw new Error('БД не инициализирована');
    try {
        const stmt = dbInstance.prepare(sql);
        const row = stmt.get(params);
        return row || null;
    } catch (err) {
        console.error('Ошибка получения записи:', sql, params, err.message);
        throw err;
    }
};

const dbAll = async (sql, params = []) => {
    if (!dbInstance) throw new Error('БД не инициализирована');
    try {
        const stmt = dbInstance.prepare(sql);
        return stmt.all(params);
    } catch (err) {
        console.error('Ошибка получения записей:', sql, params, err.message);
        throw err;
    }
};

/**
 * Initializes the database and creates tables.
 */
async function initDB() {
    try {
        // Initialize better-sqlite3
        dbInstance = new Database(dbPath);
        
        // Optimize performance
        dbInstance.pragma('journal_mode = WAL');
        dbInstance.pragma('synchronous = NORMAL');

        // --- Создание таблиц ---
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
            is_premium INTEGER DEFAULT 0,
            is_admin INTEGER DEFAULT 0,
            is_banned INTEGER DEFAULT 0,
            is_verified INTEGER DEFAULT 0,
            verification_token TEXT,
            email TEXT,
            profile_card_bg TEXT,
            profile_effect TEXT DEFAULT 'none',
            is_moderator INTEGER DEFAULT 0,
            custom_badge TEXT
        )`);

        await dbRun(`CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER,
            reporter TEXT,
            reason TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        await dbRun(`CREATE TABLE IF NOT EXISTS admin_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_username TEXT,
            action TEXT,
            target TEXT,
            details TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
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
            type TEXT NOT NULL,
            creator_username TEXT NOT NULL,
            public_id TEXT UNIQUE,
            visibility TEXT NOT NULL DEFAULT 'public'
        )`);

        await dbRun(`CREATE TABLE IF NOT EXISTS group_members (
            group_id INTEGER NOT NULL,
            user_username TEXT NOT NULL,
            role TEXT NOT NULL,
            PRIMARY KEY(group_id, user_username)
        )`);

        await dbRun(`CREATE TABLE IF NOT EXISTS message_reactions (
            message_id INTEGER NOT NULL,
            reactor_username TEXT NOT NULL,
            emoji TEXT NOT NULL,
            PRIMARY KEY(message_id, reactor_username, emoji)
        )`);

        await dbRun(`CREATE TABLE IF NOT EXISTS message_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER NOT NULL,
            sender TEXT NOT NULL,
            text TEXT NOT NULL,
            time TEXT NOT NULL
        )`);

        // Migration: Ensure xxx is admin
        await dbRun("UPDATE users SET is_admin = 1 WHERE username = 'xxx'");

        // Создаем папки для загрузок, если их нет
        const uploadsDir = path.join(__dirname, '../../public/uploads');
        await fs.mkdir(path.join(uploadsDir, 'avatars'), { recursive: true });
        await fs.mkdir(path.join(uploadsDir, 'stories'), { recursive: true });
        await fs.mkdir(path.join(uploadsDir, 'media'), { recursive: true });
        
        console.log('better-sqlite3: БД инициализирована и готова к работе.');
        
        return true;
    } catch (err) {
        console.error('Ошибка инициализации БД (better-sqlite3):', err);
        throw err;
    }
}

module.exports = {
    get db() { return dbInstance; },
    dbRun,
    dbGet,
    dbAll,
    initDB,
    saveDB,
    saveDBImmediate
};
