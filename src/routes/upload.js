const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const mime = require('mime-types');
const { existsSync } = require('fs');
const { dbRun, dbGet } = require('../db/database');
const jwt = require('../utils/jwt');
const { JWT_SECRET } = require('./auth');

router.use((req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Нет токена доступа' });
    }
    const token = authHeader.split(' ')[1];
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch(e) {
        res.status(401).json({ success: false, message: 'Токен недействителен' });
    }
});

async function saveMediaDataUrl(dataUrl, username, folder) {
    const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!matches || matches.length !== 3) throw new Error('Неверный формат Data URL');
    
    const mimeType = matches[1];
    const fileBuffer = Buffer.from(matches[2], 'base64');
    let extension = mime.extension(mimeType);
    if (!extension) {
        extension = mimeType.split('/')[1].split(';')[0];
    }
    
    const allowedExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'webm', 'weba', 'mp4', 'mp3', 'ogg', 'wav'];
    if (!extension || !allowedExts.includes(extension.toLowerCase())) throw new Error(`Неподдерживаемый тип файла: ${extension}`);

    const filename = `${username}-${Date.now()}.${extension}`;
    const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads', folder);
    // Ensure directory exists
    await fs.mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, filename);
    await fs.writeFile(filePath, fileBuffer);
    return `/uploads/${folder}/${filename}`;
}

router.post('/avatar', async (req, res) => {
    try {
        const { avatar } = req.body;
        if (!avatar) return res.status(400).json({ success: false });
        
        // Проверяем что данные вообще пришли

        const publicPath = await saveMediaDataUrl(avatar, req.user.username, 'avatars');
        await dbRun(`UPDATE users SET avatar = ? WHERE username = ?`, [publicPath, req.user.username]);
        res.json({ success: true, path: publicPath });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.post('/story', async (req, res) => {
    try {
        const { image, time } = req.body;
        if (!image) return res.status(400).json({ success: false });
        const publicPath = await saveMediaDataUrl(image, req.user.username, 'stories');
        const expires = Date.now() + (24 * 60 * 60 * 1000);
        await dbRun(`INSERT INTO stories (username, image, time, expires) VALUES (?, ?, ?, ?)`,
            [req.user.username, publicPath, time, expires]);
        res.json({ success: true, path: publicPath });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.post('/chat-media', async (req, res) => {
    try {
        const { media } = req.body;
        if (!media) return res.status(400).json({ success: false });
        const publicPath = await saveMediaDataUrl(media, req.user.username, 'media');
        res.json({ success: true, path: publicPath });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
