const express = require('express');
const router = express.Router();
const { dbRun, dbGet } = require('../db/database');
const jwt = require('jsonwebtoken');

// Note: In this project, JWT_SECRET is often imported or defined locally. 
// I will use a safe way to get it or fallback to the one in auth.js if possible.
const JWT_SECRET = process.env.JWT_SECRET || 'monochrome-super-secret-key-123';

// Middleware to verify token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// Unified endpoint for profile customization (background + effect)
router.post('/update-customization', authenticateToken, async (req, res) => {
    try {
        const { effect, cardBg } = req.body;
        const username = req.user.username;

        if (effect === undefined && cardBg === undefined) {
            return res.status(400).json({ success: false, message: 'Нет данных для обновления.' });
        }

        let query = 'UPDATE users SET ';
        const params = [];
        const updates = [];

        if (effect !== undefined) {
            updates.push('profile_effect = ?');
            params.push(effect);
        }
        if (cardBg !== undefined) {
            updates.push('profile_card_bg = ?');
            params.push(cardBg);
        }

        query += updates.join(', ') + ' WHERE username = ?';
        params.push(username);

        await dbRun(query, params);
        res.json({ success: true, message: 'Кастомизация сохранена.' });
    } catch (err) {
        console.error('Ошибка в update-customization:', err);
        res.status(500).json({ success: false, message: 'Ошибка сервера.' });
    }
});

// For compatibility with groups.js (if needed)
router.post('/update-profile', authenticateToken, async (req, res) => {
    try {
        const { displayName, bio, profileCardBg, birthDate } = req.body;
        const username = req.user.username;

        await dbRun(
            `UPDATE users SET display_name = ?, bio = ?, profile_card_bg = ?, birth_date = ? WHERE username = ?`,
            [displayName, bio, profileCardBg, birthDate, username]
        );
        res.json({ success: true, message: 'Профиль обновлен.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Ошибка сервера.' });
    }
});

module.exports = router;
