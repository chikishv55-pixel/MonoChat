const { initDB, dbGet, dbRun } = require('./src/db/database');
const bcrypt = require('bcryptjs');

async function checkAdmin() {
    await initDB();
    const adminUsername = 'xxx';
    const admin = await dbGet('SELECT * FROM users WHERE username = ?', [adminUsername]);
    
    if (!admin) {
        console.log(`Создание администратора ${adminUsername}...`);
        const hash = await bcrypt.hash('admin123', 10);
        await dbRun(`INSERT INTO users (username, display_name, password, is_admin, is_verified) VALUES (?, ?, ?, ?, ?)`,
            [adminUsername, 'Administrator', hash, 1, 1]);
        console.log('Администратор создан. Логин: xxx, Пароль: admin123');
    } else {
        console.log('Администратор xxx уже существует.');
        if (!admin.is_admin) {
            await dbRun('UPDATE users SET is_admin = 1 WHERE username = ?', [adminUsername]);
            console.log('Права администратора обновлены для xxx.');
        }
    }
    process.exit(0);
}

checkAdmin().catch(err => {
    console.error(err);
    process.exit(1);
});
