const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('chat.db');

db.serialize(() => {
    // Ensure is_admin exists and is set for xxx
    db.run("UPDATE users SET is_admin = 1 WHERE username = 'xxx'", (err) => {
        if (err) {
            console.error("Error setting admin:", err.message);
        } else {
            console.log("Admin rights granted to user 'xxx'");
        }
    });

    db.all("SELECT username, is_admin FROM users", [], (err, rows) => {
        if (err) {
            console.error(err.message);
        } else {
            console.log("Current users and admin status:", rows);
        }
        db.close();
    });
});
