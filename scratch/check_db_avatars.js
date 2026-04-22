const { initDB, dbAll } = require('./src/db/database');

async function checkAvatars() {
    await initDB();
    const users = await dbAll('SELECT username, avatar FROM users');
    console.log('--- User Avatars ---');
    users.forEach(u => {
        console.log(`${u.username}: ${u.avatar}`);
    });
    process.exit(0);
}

checkAvatars();
