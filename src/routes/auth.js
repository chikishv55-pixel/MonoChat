const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('../utils/jwt');
const { dbRun, dbGet } = require('../db/database');
const nodemailer = require('nodemailer');
const config = require('../config');

const JWT_SECRET = process.env.JWT_SECRET || 'monochrome-super-secret-key-123';
const SALT_ROUNDS = 10;

// Ограничение попыток входа/регистрации
const loginAttempts = new Map();
const registerAttempts = new Map();
const AUTH_ATTEMPTS_LIMIT = 5;
const AUTH_ATTEMPTS_WINDOW = 5 * 60 * 1000;

router.post('/register', async (req, res) => {
    try {
        const ip = req.ip || req.connection.remoteAddress;
        const now = Date.now();
        const attempts = registerAttempts.get(ip) || { count: 0, firstAttempt: now };
        
        if (now - attempts.firstAttempt > AUTH_ATTEMPTS_WINDOW) {
            registerAttempts.set(ip, { count: 1, firstAttempt: now });
        } else {
            if (attempts.count >= AUTH_ATTEMPTS_LIMIT) {
                return res.status(429).json({ success: false, message: 'Слишком много попыток. Попробуйте позже.' });
            }
            attempts.count++;
            registerAttempts.set(ip, attempts);
        }

        const { username, displayName, password, email, fcmToken } = req.body;
        
        if (!username || !displayName || !password || !email) {
            return res.status(400).json({ success: false, message: 'Все поля обязательны.' });
        }
        if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
            return res.status(400).json({ success: false, message: 'Юзернейм: от 3 до 20 символов (буквы, цифры, _).' });
        }
        if (password.length < 6) {
            return res.status(400).json({ success: false, message: 'Пароль должен быть не менее 6 символов.' });
        }

        const lowerUser = username.toLowerCase();
        const lowerEmail = email.toLowerCase();
        
        // --- ПРОВЕРКА УНИКАЛЬНОСТИ ПОЧТЫ И ОЧИСТКА СТАРЫХ ЗАЯВОК ---
        const existingEmailUser = await dbGet(`SELECT username, is_verified FROM users WHERE email = ?`, [lowerEmail]);
        if (existingEmailUser) {
            if (existingEmailUser.is_verified) {
                return res.status(409).json({ success: false, message: 'Эта почта уже привязана к другому аккаунту!' });
            } else {
                await dbRun(`DELETE FROM users WHERE username = ?`, [existingEmailUser.username]);
            }
        }

        const hash = await bcrypt.hash(password, SALT_ROUNDS);
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString(); // 6 цифр

        try {
            await dbRun(`INSERT INTO users (username, display_name, password, email, verification_token, is_verified, fcm_token) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
                [lowerUser, displayName, hash, lowerEmail, verificationCode, 0, fcmToken || null]);
            
            registerAttempts.delete(ip);
            
            // Отправка письма
            const transporter = nodemailer.createTransport(config.emailConfig);
            const mailOptions = {
                from: `"Monochrome Chat" <${config.emailConfig.auth.user}>`,
                to: email,
                subject: 'Код подтверждения (5 минут)',
                html: `
                    <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 500px; margin: auto; border: 1px solid #1a1a1a; border-radius: 16px; background-color: #ffffff;">
                        <h2 style="color: #000; text-align: center;">⚲ MONOCHROME</h2>
                        <p style="text-align: center; font-size: 16px;">Ваш код подтверждения для завершения регистрации:</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <span style="display: inline-block; padding: 15px 30px; background: #f4f4f4; color: #000; font-size: 32px; font-weight: bold; letter-spacing: 5px; border-radius: 10px; border: 1px solid #ddd;">${verificationCode}</span>
                        </div>
                        <p style="font-size: 13px; color: #888; text-align: center;">Код действителен <b>5 минут</b>. Если вы не регистрировались, просто проигнорируйте это письмо.</p>
                    </div>
                `
            };
            
            await transporter.sendMail(mailOptions);
            res.json({ success: true, message: 'Проверьте почту для подтверждения.' });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, message: 'Ошибка при регистрации.' });
        }
    } catch (e) {
        console.error('Registration error:', e);
        res.status(500).json({ success: false, message: 'Ошибка сервера при регистрации.' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const ip = req.ip || req.connection.remoteAddress;
        const now = Date.now();
        const attempts = loginAttempts.get(ip) || { count: 0, firstAttempt: now };

        if (now - attempts.firstAttempt > AUTH_ATTEMPTS_WINDOW) {
            loginAttempts.set(ip, { count: 1, firstAttempt: now });
        } else {
            if (attempts.count >= AUTH_ATTEMPTS_LIMIT) {
                return res.status(429).json({ success: false, message: 'Слишком много попыток входа. Попробуйте позже.' });
            }
            attempts.count++;
            loginAttempts.set(ip, attempts);
        }

        const { username, password, fcmToken } = req.body;
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Введите логин и пароль.' });
        }

        const lowerUser = username.toLowerCase();
        const user = await dbGet(`SELECT * FROM users WHERE username = ?`, [lowerUser]);
        
        if (!user) {
            return res.status(401).json({ success: false, message: 'Пользователь не найден!' });
        }

        const match = await bcrypt.compare(password, user.password);
        if (match) {
            loginAttempts.delete(ip);

            if (user.is_banned) {
                return res.status(403).json({ success: false, message: 'Ваш аккаунт заблокирован.' });
            }
            if (!user.is_verified) {
                return res.status(403).json({ success: false, message: 'Пожалуйста, подтвердите вашу почту перед входом.' });
            }

            if (fcmToken && fcmToken !== user.fcm_token) {
                await dbRun(`UPDATE users SET fcm_token = ? WHERE username = ?`, [fcmToken, user.username]);
                user.fcm_token = fcmToken;
            }

            const userResponse = { ...user };
            delete userResponse.password;
            
            const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '30d' });

            res.json({ success: true, user: userResponse, token });
        } else {
            res.status(401).json({ success: false, message: 'Неверный пароль!' });
        }
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'Ошибка на стороне сервера.' });
    }
});

router.get('/me', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'Нет токена доступа' });
        }
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        
        const row = await dbGet(`SELECT username, display_name, avatar, bio, birth_date, music_status, fcm_token, is_premium, is_admin, is_moderator, custom_badge, profile_card_bg, profile_effect FROM users WHERE username = ?`, [decoded.username]);
        if (!row) return res.status(404).json({ success: false, message: 'Пользователь не найден' });
        
        res.json({ success: true, user: row });
    } catch(e) {
        res.status(401).json({ success: false, message: 'Токен недействителен' });
    }
});

router.post('/verify-code', async (req, res) => {
    try {
        const { username, code } = req.body;
        if (!username || !code) return res.status(400).json({ success: false, message: 'Все поля обязательны.' });

        const user = await dbGet(`SELECT * FROM users WHERE username = ?`, [username.toLowerCase()]);
        if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден.' });
        if (user.is_verified) return res.status(400).json({ success: false, message: 'Аккаунт уже подтвержден.' });

        if (user.verification_token === code) {
            await dbRun(`UPDATE users SET is_verified = 1, verification_token = NULL WHERE username = ?`, [user.username]);
            res.json({ success: true, message: 'Аккаунт успешно подтвержден! Теперь вы можете войти.' });
        } else {
            res.status(400).json({ success: false, message: 'Неверный код подтверждения.' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Ошибка при проверке кода.' });
    }
});

router.post('/resend-code', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username) return res.status(400).json({ success: false, message: 'Юзернейм обязателен.' });

        const user = await dbGet(`SELECT * FROM users WHERE username = ?`, [username.toLowerCase()]);
        if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден.' });
        if (user.is_verified) return res.status(400).json({ success: false, message: 'Аккаунт уже подтвержден.' });

        const newCode = Math.floor(100000 + Math.random() * 900000).toString();
        await dbRun(`UPDATE users SET verification_token = ? WHERE username = ?`, [newCode, user.username]);

        const transporter = nodemailer.createTransport(config.emailConfig);
        const mailOptions = {
            from: `"Monochrome Chat" <${config.emailConfig.auth.user}>`,
            to: user.email,
            subject: 'Новый код подтверждения',
            html: `
                <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 500px; margin: auto; border: 1px solid #1a1a1a; border-radius: 16px; background-color: #ffffff;">
                    <h2 style="color: #000; text-align: center;">⚲ MONOCHROME</h2>
                    <p style="text-align: center; font-size: 16px;">Ваш новый код подтверждения:</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <span style="display: inline-block; padding: 15px 30px; background: #f4f4f4; color: #000; font-size: 32px; font-weight: bold; letter-spacing: 5px; border-radius: 10px; border: 1px solid #ddd;">${newCode}</span>
                    </div>
                    <p style="font-size: 13px; color: #888; text-align: center;">Код действителен <b>5 минут</b>.</p>
                </div>
            `
        };
        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'Новый код отправлен на почту.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Ошибка при повторной отправке кода.' });
    }
});

router.post('/premium', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'Нет токена доступа' });
        }
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        
        const { isPremium } = req.body;
        const value = isPremium ? 1 : 0;
        
        await dbRun(`UPDATE users SET is_premium = ? WHERE username = ?`, [value, decoded.username]);
        res.json({ success: true, is_premium: value });
    } catch(e) {
        res.status(500).json({ success: false, message: 'Ошибка при обновлении статуса' });
    }
});

module.exports = { router, JWT_SECRET };
