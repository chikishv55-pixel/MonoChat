require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { initDB, saveDBImmediate } = require('./src/db/database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    maxHttpBufferSize: 1e8, // 100MB для больших файлов
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
}); 

const PORT = process.env.PORT || 3000;

// --- Middlewares ---
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }

    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', 
        "default-src 'self' *; " +
        "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.socket.io; " +
        "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; " +
        "font-src 'self' https://fonts.gstatic.com; " +
        "img-src 'self' data: blob: *; " +
        "media-src 'self' data: blob: *; " +
        "connect-src 'self' ws: wss: *;"
    );
    next();
});

app.use(express.json({ limit: '100mb' }));
const { uploadsDir } = require('./src/utils/paths');
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// Logging
app.use((req, res, next) => {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
    next();
});

// --- Routes ---
const authRouter = require('./src/routes/auth').router;
app.use('/api/auth', authRouter);
app.use('/api/upload', require('./src/routes/upload'));
app.use('/api/user', require('./src/routes/user'));

// --- Socket.io ---
const onlineUsers = new Map(); // username -> Set<socket.id>
require('./src/socket/index')(io, onlineUsers);

// --- Graceful Shutdown ---
async function gracefulShutdown(signal) {
    console.log(`\nПолучен сигнал ${signal}. Сохранение БД и завершение работы...`);
    try {
        await saveDBImmediate();
        console.log('БД успешно сохранена. Выход.');
        process.exit(0);
    } catch (err) {
        console.error('Ошибка при сохранении БД перед выходом:', err);
        process.exit(1);
    }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// --- Start Server ---
initDB().then(() => {
    server.listen(PORT, '0.0.0.0', async () => {
        console.log(`\n⚲ MONOCHROME SERVER START`);
        console.log(`URL: http://localhost:${PORT}`);
        
        try {
            const { dbGet, dbAll } = require('./src/db/database');
            const userCount = await dbGet('SELECT COUNT(*) as count FROM users');
            const logCount = await dbGet('SELECT COUNT(*) as count FROM admin_logs');
            console.log(`[DB INFO] Users in DB: ${userCount.count}`);
            console.log(`[DB INFO] Admin logs in DB: ${logCount.count}`);
        } catch (e) {
            console.error('[DB INFO] Failed to get stats:', e.message);
        }
    });
}).catch(err => {
    console.error('Ошибка инициализации БД:', err);
    process.exit(1);
});
