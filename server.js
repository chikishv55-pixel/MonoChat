require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    maxHttpBufferSize: 1e7,
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
}); 

const PORT = process.env.PORT || 3000;

const { initDB } = require('./src/db/database');

initDB().then(() => {
    // Запускаем сервер только после успешной инициализации БД
    server.listen(PORT, '0.0.0.0', () => console.log(`Сервер запущен на http://0.0.0.0:${PORT}`));
}).catch(err => {
    console.error('Ошибка инициализации БД:', err);
    process.exit(1);
});

app.use((req, res, next) => {
    // Разрешаем CORS для статических файлов (чтобы приложение из Capacitor могло скачивать картинки)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }

    // Защита от кликджекинга
    res.setHeader('X-Frame-Options', 'DENY');
    // Запрещает браузеру "угадывать" тип контента
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Базовая политика безопасности контента (CSP)
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

// JSON body parser с увеличенным лимитом для переваривания Base64
app.use(express.json({ limit: '50mb' }));

// Логирование запросов для отладки 404
app.use((req, res, next) => {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
    next();
});

const authRouter = require('./src/routes/auth').router;
console.log('--- Registered Auth Routes ---');
authRouter.stack.forEach(s => { if(s.route) console.log('Route loaded:', s.route.path); });
app.use('/api/auth', authRouter);
app.use('/api/upload', require('./src/routes/upload'));
app.use('/api/user', require('./src/routes/user'));

app.use(express.static(path.join(__dirname, 'public')));
const onlineUsers = new Map(); // username -> Set<socket.id>

require('./src/socket/index')(io, onlineUsers);
