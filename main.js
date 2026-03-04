const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    titleBarStyle: 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.webContents.on('did-create-window', (childWindow, details) => {
    try {
      const childUrl = (details && typeof details.url === 'string') ? details.url : '';
      if (!childUrl) return;

      if (childUrl.includes('mic-update.html')) {
        childWindow.setMenuBarVisibility(false);
        childWindow.setAutoHideMenuBar(true);
        childWindow.removeMenu();
      }
    } catch {
      // ignore
    }
  });

  const ses = mainWindow.webContents.session;

  ses.on('select-serial-port', async (event, portList, webContents, callback) => {
    event.preventDefault();

    const PREFERRED_SCALE_IDS = [
      { vendorId: 0x0557, productId: 0x2008 },
      { vendorId: 0x0557, productId: 0x2011 },
    ];

    const selected = (portList || []).find((port) => {
      const vendorId = typeof port.vendorId === 'number' ? port.vendorId : null;
      const productId = typeof port.productId === 'number' ? port.productId : null;
      if (vendorId === null || productId === null) return false;
      return PREFERRED_SCALE_IDS.some((p) => p.vendorId === vendorId && p.productId === productId);
    });

    const selectedByName = !selected
      ? (portList || []).find((port) => {
          const displayName = typeof port.displayName === 'string' ? port.displayName : '';
          const portName = typeof port.portName === 'string' ? port.portName : '';
          const name = `${displayName} ${portName}`.toLowerCase();
          return name.includes('aten');
        })
      : null;

    if (selected || selectedByName) {
      callback((selected || selectedByName).portId);
      return;
    }

    const list = Array.isArray(portList) ? portList : [];
    if (!list.length) {
      callback('');
      return;
    }

    const labels = list.map((port) => {
      const displayName = typeof port.displayName === 'string' ? port.displayName : '';
      const portName = typeof port.portName === 'string' ? port.portName : '';
      const vendorId = typeof port.vendorId === 'number' ? `0x${port.vendorId.toString(16).padStart(4, '0')}` : '';
      const productId = typeof port.productId === 'number' ? `0x${port.productId.toString(16).padStart(4, '0')}` : '';
      const extras = [portName, vendorId && productId ? `${vendorId}:${productId}` : ''].filter(Boolean).join(' ');
      return `${displayName || 'Serial Port'}${extras ? ` (${extras})` : ''}`;
    });

    try {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        message: 'Select a serial port',
        buttons: [...labels, 'Cancel'],
        defaultId: 0,
        cancelId: labels.length,
        noLink: true,
      });

      if (response >= 0 && response < list.length) {
        callback(list[response].portId);
      } else {
        callback('');
      }
    } catch {
      callback('');
    }
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission === 'serial' && details.securityOrigin === 'file:///') {
      return true;
    }
    return false;
  });

  ses.setDevicePermissionHandler((details) => {
    if (details.deviceType === 'serial' && details.origin === 'file://') {
      return true;
    }
    return false;
  });

  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'serial') {
      callback(true);
      return;
    }
    callback(false);
  });

  mainWindow.loadFile(path.join(__dirname, 'login.html'));

  const shouldOpenDevTools =
    process.argv.includes('--devtools') || process.env.ELECTRON_DEVTOOLS === '1';

  if (shouldOpenDevTools) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    // Dereference the window object if needed
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
