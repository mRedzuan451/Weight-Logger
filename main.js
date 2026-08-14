require('dotenv').config();

const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const crypto = require('crypto');
const path = require('path');

function normalizeUsername(username) {
  return typeof username === 'string' ? username.trim() : '';
}

function normalizePassword(password) {
  return typeof password === 'string' ? password : '';
}

function hashPassword(username, password) {
  const normalizedUsername = normalizeUsername(username);
  const normalizedPassword = normalizePassword(password);
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(`${normalizedUsername}:${normalizedPassword}`, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

function isLegacyPasswordHash(passwordHash) {
  return typeof passwordHash === 'string' && !passwordHash.startsWith('scrypt$');
}

function verifyPassword(username, password, passwordHash) {
  const normalizedUsername = normalizeUsername(username);
  const normalizedPassword = normalizePassword(password);
  if (typeof passwordHash !== 'string' || !passwordHash) return false;
  if (isLegacyPasswordHash(passwordHash)) {
    const legacyValue = `${normalizedUsername}:${normalizedPassword}`;
    let encoded = legacyValue;
    try {
      encoded = Buffer.from(legacyValue, 'utf8').toString('base64');
    } catch {
    }
    return passwordHash === encoded || passwordHash === legacyValue;
  }

  const parts = passwordHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt' || !parts[1] || !parts[2]) return false;
  try {
    const derivedKey = crypto.scryptSync(`${normalizedUsername}:${normalizedPassword}`, parts[1], 64);
    const actual = Buffer.from(parts[2], 'hex');
    return actual.length === derivedKey.length && crypto.timingSafeEqual(actual, derivedKey);
  } catch {
    return false;
  }
}

function getBootstrapAdmin() {
  const username = normalizeUsername(process.env.DEFAULT_ADMIN_USERNAME || 'admin');
  const password = normalizePassword(process.env.DEFAULT_ADMIN_PASSWORD);
  if (!username || !password) return null;
  return {
    username,
    displayName: process.env.DEFAULT_ADMIN_DISPLAY_NAME || 'Administrator',
    employeeId: process.env.DEFAULT_ADMIN_EMPLOYEE_ID || username,
    role: 'admin',
    active: true,
    passwordHash: hashPassword(username, password),
  };
}

ipcMain.handle('auth:hash-password', (_event, username, password) => hashPassword(username, password));
ipcMain.handle('auth:verify-password', (_event, username, password, passwordHash) => verifyPassword(username, password, passwordHash));
ipcMain.handle('auth:is-legacy-password-hash', (_event, passwordHash) => isLegacyPasswordHash(passwordHash));
ipcMain.handle('auth:get-bootstrap-admin', () => getBootstrapAdmin());

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
