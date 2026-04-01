const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

// Optional: Start the server if it's not already running
// require('./server.js'); 

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        backgroundColor: '#000000',
        icon: path.join(__dirname, 'public/favicon.ico'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js') // We'll create this if needed
        }
    });

    // Load the local server (assuming it starts on port 3000)
    win.loadURL('http://localhost:3000');

    // Menu.setApplicationMenu(null); // Optional: hide default menu
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
