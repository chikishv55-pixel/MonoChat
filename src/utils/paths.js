const path = require('path');

let dataPath;

try {
    const { app } = require('electron');
    if (app) {
        dataPath = app.getPath('userData');
    } else {
        dataPath = process.cwd();
    }
} catch (e) {
    dataPath = process.cwd();
}

const dbPath = path.join(dataPath, 'chat.db');
const uploadsDir = path.join(dataPath, 'uploads');

module.exports = {
    dataPath,
    dbPath,
    uploadsDir
};
