const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs').promises;

// Path to chat.db from the root directory
const dbPath = path.join(__dirname, '../../chat.db');

let dbInstance = null;

/**
 * Saves the current in-memory database to the filesystem.
 */
async function saveDB() {
    if (!dbInstance) return;
    try {
        const data = dbInstance.export();
        const buffer = Buffer.from(data);
        await fs.writeFile(dbPath, buffer);
    } catch (err) {
        console.error('Ошибка сохранения БД на диск:', err);
    }
}

// --- Обертки для работы с базой данных через async/await ---
const dbRun = async (sql, params = []) => {
    if (!dbInstance) throw new Error('БД не инициализирована');
    try {
        // sql.js uses object-based params usually, but it can handle arrays if we prepare.
        // For simplicity, we use run() for non-query commands.
        dbInstance.run(sql, params);
        
        // sql.js doesn't provide lastID easily from run() unless it's a statement.
        // We can get last_insert_rowid()
        const lastIDRes = dbInstance.exec("SELECT last_insert_rowid() as id");
        const lastID = lastIDRes[0].values[0][0];
        
        // Save to disk after every write to ensure persistence (Option A simplicity)
        await saveDB();
        
        return { lastID, changes: 1 }; 
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
        const res = dbInstance.exec(sql, params);
        if (res.length === 0) return null;
        
        // Convert sql.js format to standard object format
        const columns = res[0].columns;
        const values = res[0].values[0];
        if (!values) return null;
        
        const row = {};
        columns.forEach((col, i) => {
            row[col] = values[i];
        });
        return row;
    } catch (err) {
        console.error('Ошибка получения записи:', sql, params, err.message);
        throw err;
    }
};

const dbAll = async (sql, params = []) => {
    if (!dbInstance) throw new Error('БД не инициализирована');
    try {
        const res = dbInstance.exec(sql, params);
        if (res.length === 0) return [];
        
        const columns = res[0].columns;
        const rows = res[0].values.map(values => {
            const row = {};
            columns.forEach((col, i) => {
                row[col] = values[i];
            });
            return row;
        });
        return rows;
    } catch (err) {
        console.error('Ошибка получения записей:', sql, params, err.message);
        throw err;
    }
};

// --- Инициализация таблиц в БД ---
async function initDB() {
    try {
        const SQL = await initSqlJs();
        
        let fileBuffer;
        try {
            fileBuffer = await fs.readFile(dbPath);
            console.log('Загрузка существующей базы данных...');
        } catch (e) {
            console.log('Создание новой базы данных...');
            fileBuffer = Buffer.alloc(0);
        }

        dbInstance = new SQL.Database(fileBuffer);

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
            profile_effect TEXT DEFAULT 'none'
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

        // Migrations for Roles & Permissions
        try { await dbRun("ALTER TABLE users ADD COLUMN is_moderator INTEGER DEFAULT 0"); } catch(e){}
        try { await dbRun("ALTER TABLE users ADD COLUMN custom_badge TEXT"); } catch(e){}
        
        // Migration for reports: add message_id if missing
        try {
            const columnsInReports = await dbAll(`PRAGMA table_info(reports)`);
            if (!columnsInReports.some(c => c.name === 'message_id')) {
                await dbRun(`ALTER TABLE reports ADD COLUMN message_id INTEGER`);
            }
        } catch(e){}

        // Migration: Ensure xxx is admin
        await dbRun("UPDATE users SET is_admin = 1 WHERE username = 'xxx'");

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

        // --- Миграции ---
        const columnsInUsers = await dbAll(`PRAGMA table_info(users)`);
        const hasIsAdmin = columnsInUsers.some(c => c.name === 'is_admin');
        if (!hasIsAdmin) {
            // addColumnIfNotExists logic
            await dbRun(`ALTER TABLE users ADD COLUMN bio TEXT`);
            await dbRun(`ALTER TABLE users ADD COLUMN birth_date TEXT`);
            await dbRun(`ALTER TABLE users ADD COLUMN music_status TEXT`);
            await dbRun(`ALTER TABLE users ADD COLUMN fcm_token TEXT`);
            await dbRun(`ALTER TABLE users ADD COLUMN is_premium INTEGER DEFAULT 0`);
            await dbRun(`ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`);
            await dbRun(`ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0`);
            await dbRun(`ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0`);
            await dbRun(`ALTER TABLE users ADD COLUMN verification_token TEXT`);
            await dbRun(`ALTER TABLE users ADD COLUMN email TEXT`);
        }
        
        // Ensure profile_card_bg exists
        if (!columnsInUsers.some(c => c.name === 'profile_card_bg')) {
            await dbRun(`ALTER TABLE users ADD COLUMN profile_card_bg TEXT`);
        }

        // Ensure profile_effect exists
        if (!columnsInUsers.some(c => c.name === 'profile_effect')) {
            await dbRun(`ALTER TABLE users ADD COLUMN profile_effect TEXT DEFAULT 'none'`);
        }
        
        // Ensure other columns exist too (for existing DBs)
        const columnsInMessages = await dbAll(`PRAGMA table_info(messages)`);
        if (!columnsInMessages.some(c => c.name === 'reply_to_message_id')) {
            await dbRun(`ALTER TABLE messages ADD COLUMN reply_to_message_id INTEGER`);
            await dbRun(`ALTER TABLE messages ADD COLUMN reply_snippet TEXT`);
            await dbRun(`ALTER TABLE messages ADD COLUMN forwarded_from_username TEXT`);
        }

        // Создаем папки для загрузок, если их нет
        const uploadsDir = path.join(__dirname, '../../public/uploads');
        await fs.mkdir(path.join(uploadsDir, 'avatars'), { recursive: true });
        await fs.mkdir(path.join(uploadsDir, 'stories'), { recursive: true });
        await fs.mkdir(path.join(uploadsDir, 'media'), { recursive: true });
        
        console.log('sql.js: БД инициализирована и синхронизирована с диском.');
        
        return true;
    } catch (err) {
        console.error('Ошибка инициализации БД (sql.js):', err);
        throw err;
    }
}

module.exports = {
    get db() { return dbInstance; },
    dbRun,
    dbGet,
    dbAll,
    initDB,
    saveDB
};
