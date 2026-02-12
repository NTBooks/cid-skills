const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const Hash = require('ipfs-only-hash');

const defaultDsoulUrlTemplate = 'https://dsoul.org/wp-json/diamond-soul/v1/search_by_cid?cid={CID}';

async function loadDsoulUrlTemplate() {
  const envPaths = [
    app.isPackaged ? path.join(path.dirname(process.execPath), '.env') : null,
    path.join(app.getPath('userData'), '.env'),
    path.join(__dirname, '.env')
  ].filter(Boolean);
  for (const envPath of envPaths) {
    try {
      const content = await fs.readFile(envPath, 'utf-8');
      const match = content.match(/^\s*DSOUL\s*=\s*(.+?)\s*$/m);
      if (match) {
        const value = match[1].replace(/^["']|["']$/g, '').trim();
        if (value) return value;
      }
    } catch (_) {
      // file missing or unreadable, try next
    }
  }
  return defaultDsoulUrlTemplate;
}

let mainWindow;
const userDataPath = app.getPath('userData');
const dataDir = path.join(userDataPath, 'ipfs-files');
const settingsPath = path.join(userDataPath, 'settings.json');

// Set app name before accessing userData path
app.setName('Diamond Soul Downloader');

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.mkdir(dataDir, { recursive: true });
  } catch (error) {
    console.error('Error creating data directory:', error);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Diamond Soul Downloader',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      devTools: true // Enable DevTools
    }
  });

  // Remove menu bar completely
  mainWindow.setMenuBarVisibility(false);
  
  // Open DevTools (you can comment this out if you don't want it to open automatically)
  // mainWindow.webContents.openDevTools();
  
  // Add keyboard shortcut to toggle DevTools (F12 or Ctrl+Shift+I)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools();
    }
  });
  
  mainWindow.loadFile('index.html');
}

app.whenReady().then(async () => {
  // Remove menu bar completely
  Menu.setApplicationMenu(null);
  
  await ensureDataDir();
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

// IPC handlers
ipcMain.handle('get-files', async () => {
  try {
    const files = await fs.readdir(dataDir);
    const fileData = await Promise.all(
      files
        .filter(f => f.endsWith('.json'))
        .map(async (file) => {
          const content = await fs.readFile(path.join(dataDir, file), 'utf-8');
          return JSON.parse(content);
        })
    );
    return fileData;
  } catch (error) {
    console.error('Error reading files:', error);
    return [];
  }
});

ipcMain.handle('save-file', async (event, fileData) => {
  try {
    const filename = `${fileData.cid}.json`;
    const filepath = path.join(dataDir, filename);
    await fs.writeFile(filepath, JSON.stringify(fileData, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('Error saving file:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-file', async (event, cid) => {
  try {
    const filename = `${cid}.json`;
    const filepath = path.join(dataDir, filename);
    await fs.unlink(filepath);
    return { success: true };
  } catch (error) {
    console.error('Error deleting file:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('read-file', async (event, cid) => {
  try {
    const filename = `${cid}.json`;
    const filepath = path.join(dataDir, filename);
    const content = await fs.readFile(filepath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Error reading file:', error);
    return null;
  }
});

ipcMain.handle('update-file-tags', async (event, cid, tags) => {
  try {
    const filename = `${cid}.json`;
    const filepath = path.join(dataDir, filename);
    const content = await fs.readFile(filepath, 'utf-8');
    const fileData = JSON.parse(content);
    fileData.tags = tags;
    await fs.writeFile(filepath, JSON.stringify(fileData, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('Error updating tags:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('calculate-hash', async (event, content) => {
  try {
    // Convert string to Buffer if needed, Hash.of accepts string or Buffer
    const hash = await Hash.of(content);
    return { success: true, hash };
  } catch (error) {
    console.error('Error calculating hash:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fetch-dsoul-by-cid', async (event, cid) => {
  try {
    const template = await loadDsoulUrlTemplate();
    const url = template.replace(/\{CID\}/g, encodeURIComponent(cid));
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}: ${text || res.statusText}` };
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return { success: false, error: `Invalid JSON: ${text.slice(0, 200)}${text.length > 200 ? '...' : ''}` };
    }
    return { success: true, data };
  } catch (error) {
    const msg = error && (error.message || String(error));
    return { success: false, error: msg };
  }
});

// Settings handlers
async function loadSettings() {
  try {
    const content = await fs.readFile(settingsPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    // Return default settings if file doesn't exist
    return { skillsFolder: '' };
  }
}

async function saveSettings(settings) {
  try {
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('Error saving settings:', error);
    return { success: false, error: error.message };
  }
}

ipcMain.handle('get-settings', async () => {
  return await loadSettings();
});

ipcMain.handle('save-settings', async (event, settings) => {
  return await saveSettings(settings);
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, path: result.filePaths[0] };
  }
  return { success: false };
});

ipcMain.handle('open-skills-folder', async () => {
  const settings = await loadSettings();
  if (!settings.skillsFolder) {
    return { success: false, error: 'Skills folder not set. Please configure it in Options.' };
  }
  const err = await shell.openPath(settings.skillsFolder);
  if (err) {
    return { success: false, error: err };
  }
  return { success: true };
});

// File activation handlers
ipcMain.handle('activate-file', async (event, cid) => {
  try {
    // Read file data
    const filename = `${cid}.json`;
    const filepath = path.join(dataDir, filename);
    const content = await fs.readFile(filepath, 'utf-8');
    const fileData = JSON.parse(content);
    
    // Load settings to get skills folder
    const settings = await loadSettings();
    if (!settings.skillsFolder) {
      return { success: false, error: 'Skills folder not set. Please configure it in Options.' };
    }
    
    // Ensure skills folder exists
    await fs.mkdir(settings.skillsFolder, { recursive: true });
    
    // Write file as {CID}.MD
    const skillsFilePath = path.join(settings.skillsFolder, `${cid}.MD`);
    await fs.writeFile(skillsFilePath, fileData.content, 'utf-8');
    
    // Update file data to mark as active
    fileData.active = true;
    await fs.writeFile(filepath, JSON.stringify(fileData, null, 2), 'utf-8');
    
    return { success: true };
  } catch (error) {
    console.error('Error activating file:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('deactivate-file', async (event, cid) => {
  try {
    // Load settings to get skills folder
    const settings = await loadSettings();
    if (!settings.skillsFolder) {
      return { success: false, error: 'Skills folder not set.' };
    }
    
    // Remove file from skills folder
    const skillsFilePath = path.join(settings.skillsFolder, `${cid}.MD`);
    try {
      await fs.unlink(skillsFilePath);
    } catch (error) {
      // File might not exist, that's okay
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    
    // Update file data to mark as inactive
    const filename = `${cid}.json`;
    const filepath = path.join(dataDir, filename);
    const content = await fs.readFile(filepath, 'utf-8');
    const fileData = JSON.parse(content);
    fileData.active = false;
    await fs.writeFile(filepath, JSON.stringify(fileData, null, 2), 'utf-8');
    
    return { success: true };
  } catch (error) {
    console.error('Error deactivating file:', error);
    return { success: false, error: error.message };
  }
});
