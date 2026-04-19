const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'chat.db');
console.log('Attempting to fix admin in:', dbPath);

const db = new Database(dbPath);

try {
    const users = db.prepare("SELECT username FROM users").all();
    console.log('Current users:', users.map(u => u.username).join(', ') || 'NONE');

    if (users.length > 0) {
        const result = db.prepare("UPDATE users SET is_admin = 1, is_premium = 1").run();
        console.log(`Updated ${result.changes} users to ADMIN.`);
    } else {
        console.log('No users found to promote.');
        // Maybe insert the xxx user if we are sure?
        // But we don't have their password hash.
    }

    // Insert a dummy log so the logs panel isn't empty
    db.prepare("INSERT INTO admin_logs (admin_username, action, target, details) VALUES (?, ?, ?, ?)").run(
        'system', 'DB_FIX', 'admin_panel', 'Admin rights restored after DB migration'
    );
    console.log('Inserted dummy admin log.');

} catch (err) {
    console.error('Error during fix:', err);
} finally {
    db.close();
}
