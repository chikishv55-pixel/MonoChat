/**
 * create_admin.js — скрипт создания/восстановления администратора
 * Запуск: node create_admin.js <username> <password>
 * Пример: node create_admin.js xxx mypassword123
 */
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const args = process.argv.slice(2);
const username = (args[0] || 'xxx').toLowerCase().trim();
const password = args[1] || '';

if (!password) {
    console.error('Использование: node create_admin.js <username> <password>');
    process.exit(1);
}

const dbPath = path.resolve(process.cwd(), 'chat.db');
console.log(`[DB] Используем базу данных: ${dbPath}`);

const db = new Database(dbPath);

(async () => {
    try {
        const hash = await bcrypt.hash(password, 10);
        const existing = db.prepare('SELECT username FROM users WHERE username = ?').get(username);

        if (existing) {
            // Пользователь нашёлся — обновляем пароль и права
            db.prepare(`
                UPDATE users 
                SET password = ?, is_admin = 1, is_premium = 1, is_verified = 1, is_banned = 0
                WHERE username = ?
            `).run(hash, username);
            console.log(`✅ Пользователь @${username} обновлён: пароль сброшен, is_admin=1, is_verified=1`);
        } else {
            // Пользователь не найден — создаём нового
            db.prepare(`
                INSERT INTO users (username, display_name, password, is_admin, is_premium, is_verified, is_banned)
                VALUES (?, ?, ?, 1, 1, 1, 0)
            `).run(username, username, hash);
            console.log(`✅ Создан новый администратор @${username} с is_verified=1`);
        }

        // Проверяем результат
        const user = db.prepare('SELECT username, is_admin, is_verified, is_premium FROM users WHERE username = ?').get(username);
        console.log('Данные в БД:', user);

    } catch (err) {
        console.error('Ошибка:', err.message);
        process.exit(1);
    } finally {
        db.close();
    }
})();
