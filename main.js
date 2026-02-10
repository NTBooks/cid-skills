const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const Hash = require('ipfs-only-hash');

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
