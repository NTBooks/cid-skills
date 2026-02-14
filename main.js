const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const Hash = require('ipfs-only-hash');
const yauzl = require('yauzl');

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
    let files;
    try {
      files = await fs.readdir(dataDir);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const results = await Promise.allSettled(
      jsonFiles.map(async (file) => {
        const content = await fs.readFile(path.join(dataDir, file), 'utf-8');
        return JSON.parse(content);
      })
    );
    const fileData = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value && result.value.cid) {
        fileData.push(result.value);
      } else if (result.status === 'rejected') {
        console.warn('Skipping invalid file:', jsonFiles[i], result.reason?.message || result.reason);
      }
    });
    return fileData;
  } catch (error) {
    console.error('Error reading files:', error);
    return [];
  }
});

ipcMain.handle('save-file', async (event, fileData, zipBuffer) => {
  try {
    const cid = fileData.cid;
    if (fileData.is_bundle && zipBuffer) {
      const zipPath = path.join(dataDir, `${cid}.zip`);
      const buf = Buffer.from(zipBuffer);
      await fs.writeFile(zipPath, buf);
    }
    const toSave = fileData.is_bundle ? { ...fileData, content: undefined } : { ...fileData };
    const filename = `${cid}.json`;
    const filepath = path.join(dataDir, filename);
    await fs.writeFile(filepath, JSON.stringify(toSave, null, 2), 'utf-8');
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
    let fileData = null;
    try {
      const content = await fs.readFile(filepath, 'utf-8');
      fileData = JSON.parse(content);
    } catch (_) {}
    await fs.unlink(filepath);
    if (fileData && fileData.is_bundle) {
      const zipPath = path.join(dataDir, `${cid}.zip`);
      try {
        await fs.unlink(zipPath);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
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
    if (error.code === 'ENOENT') return null;
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
    // IPFS CID is hash of raw bytes. For binary (e.g. zip) we must hash Buffer/Uint8Array, not UTF-8 decoded string.
    let input = content;
    if (content && typeof content.buffer === 'object' && content.buffer instanceof ArrayBuffer) {
      input = Buffer.from(content);
    } else if (content && content instanceof ArrayBuffer) {
      input = Buffer.from(content);
    }
    const hash = await Hash.of(input);
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

function extractEntryToFileNoOverwrite(zipfile, entry, destDir) {
  return new Promise((resolve, reject) => {
    const destPath = path.join(destDir, entry.fileName);
    if (/\/$/.test(entry.fileName)) {
      fs.mkdir(destPath, { recursive: true }).then(() => resolve(), reject);
      return;
    }
    fs.stat(destPath).then(() => resolve(), (e) => {
      if (e.code !== 'ENOENT') { resolve(); return; }
      fs.mkdir(path.dirname(destPath), { recursive: true }).then(() => {
        zipfile.openReadStream(entry, (err, readStream) => {
          if (err) return reject(err);
          const writeStream = fsSync.createWriteStream(destPath);
          readStream.pipe(writeStream);
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
        });
      }).catch(reject);
    });
  });
}

// File activation handlers
ipcMain.handle('activate-file', async (event, cid) => {
  try {
    const filename = `${cid}.json`;
    const filepath = path.join(dataDir, filename);
    const content = await fs.readFile(filepath, 'utf-8');
    const fileData = JSON.parse(content);

    const settings = await loadSettings();
    if (!settings.skillsFolder) {
      return { success: false, error: 'Skills folder not set. Please configure it in Options.' };
    }

    await fs.mkdir(settings.skillsFolder, { recursive: true });

    if (fileData.is_bundle) {
      const zipPath = path.join(dataDir, `${cid}.zip`);
      await new Promise((resolve, reject) => {
        let pending = 0;
        let ended = false;
        function maybeDone() {
          if (ended && pending === 0) {
            zipfile.close();
            resolve();
          }
        }
        yauzl.open(zipPath, { lazyEntries: false }, (err, zipfile) => {
          if (err) return reject(err);
          zipfile.on('entry', (entry) => {
            pending++;
            extractEntryToFileNoOverwrite(zipfile, entry, settings.skillsFolder).then(() => {
              pending--;
              maybeDone();
            }, reject);
          });
          zipfile.on('end', () => {
            ended = true;
            maybeDone();
          });
          zipfile.on('error', reject);
        });
      });
    } else {
      const skillsFilePath = path.join(settings.skillsFolder, `${cid}.MD`);
      await fs.writeFile(skillsFilePath, fileData.content, 'utf-8');
    }

    fileData.active = true;
    await fs.writeFile(filepath, JSON.stringify(fileData, null, 2), 'utf-8');

    return { success: true };
  } catch (error) {
    console.error('Error activating file:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('hash-file-from-path', async (event, cid) => {
  try {
    const zipPath = path.join(dataDir, `${cid}.zip`);
    const buf = await fs.readFile(zipPath);
    const hash = await Hash.of(buf);
    return { success: true, hash };
  } catch (error) {
    console.error('Error hashing file from path:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('deactivate-file', async (event, cid) => {
  try {
    const settings = await loadSettings();
    if (!settings.skillsFolder) {
      return { success: false, error: 'Skills folder not set.' };
    }

    const filename = `${cid}.json`;
    const filepath = path.join(dataDir, filename);
    const content = await fs.readFile(filepath, 'utf-8');
    const fileData = JSON.parse(content);

    if (fileData.is_bundle) {
      const zipPath = path.join(dataDir, `${cid}.zip`);
      const entries = await new Promise((resolve, reject) => {
        const list = [];
        yauzl.open(zipPath, { lazyEntries: false }, (err, zipfile) => {
          if (err) return reject(err);
          zipfile.on('entry', (entry) => list.push(entry.fileName));
          zipfile.on('end', () => {
            zipfile.close();
            resolve(list);
          });
          zipfile.on('error', reject);
        });
      });
      for (const fileName of entries) {
        if (/\/$/.test(fileName)) continue;
        const fullPath = path.join(settings.skillsFolder, fileName);
        try {
          await fs.unlink(fullPath);
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
        }
      }
    } else {
      const skillsFilePath = path.join(settings.skillsFolder, `${cid}.MD`);
      try {
        await fs.unlink(skillsFilePath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }

    fileData.active = false;
    await fs.writeFile(filepath, JSON.stringify(fileData, null, 2), 'utf-8');

    return { success: true };
  } catch (error) {
    console.error('Error deactivating file:', error);
    return { success: false, error: error.message };
  }
});
