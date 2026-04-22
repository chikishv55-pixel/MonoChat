const path = require('path');
const { app } = require('electron');

let dataPath;

try {
    if (app) {
        // We are in the Electron main process
        dataPath = app.getPath('userData');
    } else {
        // We might be in a standalone node process or a child process
        // Try to get it from Electron if possible (renderer or secondary main)
        const electron = require('electron');
        const remoteApp = electron.app || (electron.remote && electron.remote.app);
        if (remoteApp) {
            dataPath = remoteApp.getPath('userData');
        } else {
            dataPath = process.cwd();
        }
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
