const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');

// Start the server (DISABLED for remote VPS mode)
/*
try {
    require('./server.js');
} catch (err) {
    app.whenReady().then(() => {
        dialog.showErrorBox('Server Error', 'Failed to start the backend server:\n' + err.message);
        app.quit();
    });
}
*/

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 400,
        minHeight: 600,
        backgroundColor: '#000000',
        frame: false,
        autoHideMenuBar: true,
        icon: require('fs').existsSync(path.join(__dirname, 'public/favicon.ico')) 
            ? path.join(__dirname, 'public/favicon.ico') 
            : undefined,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            devTools: true
        }
    });

    win.removeMenu();
    win.setMenuBarVisibility(false);
    win.setAutoHideMenuBar(true);
    Menu.setApplicationMenu(null);

    // IPC handlers for custom title bar
    ipcMain.on('window-minimize', () => win.minimize());
    ipcMain.on('window-maximize', () => {
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
    });
    ipcMain.on('window-close', () => win.close());

    // Load the remote VPS server
    const loadURL = () => {
        win.loadURL('http://5.35.95.248:3000').catch(() => {
            console.log('VPS Server not reachable, retrying in 2000ms...');
            setTimeout(loadURL, 2000);
        });
    };

    loadURL();
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
