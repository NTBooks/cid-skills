const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const Hash = require('ipfs-only-hash');
const yauzl = require('yauzl');

const defaultDsoulProviderOrigin = 'https://dsoul.org';
const DSOUL_API_PATH = '/wp-json/diamond-soul/v1';

// CLI: parse "install" or "config" commands. argv[2] = command, then command-specific args.
function getCliArgs() {
  const argv = process.argv;
  const cmd = argv[2];
  if (cmd === 'install') {
    const rest = argv.slice(3);
    const global = rest.includes('-g');
    const target = rest.find((a) => a !== '-g' && !a.startsWith('-'));
    if (!target || !String(target).trim()) return null;
    return { command: 'install', target: String(target).trim(), global };
  }
  if (cmd === 'config') {
    const key = argv[3];
    const value = argv[4];
    const validKeys = ['dsoul-provider', 'skills-folder'];
    if (!key || !validKeys.includes(key)) return null;
    return {
      command: 'config',
      key,
      value: value != null ? String(value).trim() : undefined
    };
  }
  if (cmd === 'uninstall') {
    const target = (argv[3] || '').trim();
    if (!target) return null;
    return { command: 'uninstall', target };
  }
  return null;
}

function parseCID(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.startsWith('ipfs://')) {
    return trimmed.substring(7).split('/')[0].trim() || null;
  }
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z0-9]{58,}|z[a-z0-9]+)$/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

async function loadDsoulProviderFromEnv() {
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
  return defaultDsoulProviderOrigin;
}

/** Get DSOUL API base URL: user origin (e.g. https://dsoul.org) + /wp-json/diamond-soul/v1. Used for CID lookup and shortname resolution. */
async function getDsoulProviderBase() {
  const settings = await loadSettings();
  const url = settings.dsoulProviderUrl && String(settings.dsoulProviderUrl).trim();
  const raw = url || await loadDsoulProviderFromEnv();
  let origin = (raw || '').trim().replace(/\/+$/, '');
  if (!origin) origin = defaultDsoulProviderOrigin;
  // Append API path if user only provided host (e.g. https://dsoul.org)
  if (origin.endsWith(DSOUL_API_PATH)) return origin;
  return origin + DSOUL_API_PATH;
}

/** URL template for CID lookup: base + /search_by_cid?cid={CID}. */
async function getDsoulUrlTemplate() {
  const base = await getDsoulProviderBase();
  return `${base}/search_by_cid?cid={CID}`;
}

/** Resolve shortname (e.g. user@project:v1) to CID via DSOUL provider. GET base/resolve_shortname?shortname={NAME}. */
async function resolveShortname(shortname) {
  const base = await getDsoulProviderBase();
  const url = `${base}/resolve_shortname?shortname=${encodeURIComponent(shortname)}`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    if (res.status === 404) {
      return { success: false, error: `Shortname not found: ${shortname}` };
    }
    if (res.status === 400) {
      return { success: false, error: text || 'Bad request (missing shortname)' };
    }
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}: ${text || res.statusText}` };
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return { success: false, error: 'Invalid JSON from shortname resolution' };
    }
    const cid = data && data.cid;
    if (!cid || typeof cid !== 'string') {
      return { success: false, error: 'Response missing cid' };
    }
    return { success: true, cid: cid.trim(), data };
  } catch (err) {
    return { success: false, error: err && (err.message || String(err)) };
  }
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

// Default IPFS gateways (used when none configured)
const DEFAULT_IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://dweb.link/ipfs/',
  'https://gateway.ipfs.io/ipfs/'
];
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

/** Minimal skill header parse for CLI: extract name from frontmatter or first # heading. */
function parseSkillHeaderForCli(content) {
  if (typeof content !== 'string') return null;
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (frontmatterMatch) {
    const nameMatch = frontmatterMatch[1].match(/\bname\s*:\s*(.+?)(?:\n|$)/);
    if (nameMatch) {
      const v = nameMatch[1].trim().replace(/^["']|["']$/g, '');
      if (v) return { name: v };
    }
  }
  const h1Match = content.match(/^#+\s*(?:Persona|Skill|Agent|Assistant)?:?\s*(.+?)(?:\s*\([^)]+\))?\s*$/m)
    || content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    const name = h1Match[1].trim().replace(/\s*\([^)]+\)\s*$/, '').trim();
    if (name) return { name };
  }
  return null;
}

async function runCliInstall(cid, options = {}, installRef) {
  try {
    const template = await getDsoulUrlTemplate();
    const url = template.replace(/\{CID\}/g, encodeURIComponent(cid));
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) {
      console.error(`DSOUL API error: HTTP ${res.status}: ${text || res.statusText}`);
      return false;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      console.error('Invalid JSON from DSOUL API');
      return false;
    }
    const entries = Array.isArray(data) ? data : [];
    if (entries.length === 0) {
      console.error(`No skill found for CID: ${cid}`);
      return false;
    }
    const entry = entries.length === 1 ? entries[0] : entries.find((e) => e.cid === cid) || entries[0];
    const isBundle = !!(entry.is_skill_bundle ?? entry.is_bundle);

    const settings = await loadSettings();
    const gateways = Array.isArray(settings.ipfsGateways) && settings.ipfsGateways.length > 0
      ? settings.ipfsGateways
      : DEFAULT_IPFS_GATEWAYS;
    const normalizedGateways = gateways.map((u) => {
      const s = (u || '').trim();
      return s.endsWith('/') ? s : s + '/';
    });
    let content = null;
    for (const gateway of normalizedGateways) {
      try {
        const gatewayUrl = gateway + cid;
        const response = await fetch(gatewayUrl);
        if (!response.ok) continue;
        const contentLength = response.headers.get('Content-Length');
        if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE) continue;
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_FILE_SIZE) continue;
        content = arrayBuffer;
        break;
      } catch (_) {
        // try next gateway
      }
    }
    if (!content) {
      console.error('Failed to download from all IPFS gateways');
      return false;
    }

    const buf = Buffer.from(content);
    const hashResult = await Hash.of(buf);
    if (hashResult !== cid) {
      console.error(`Hash mismatch: expected ${cid}, got ${hashResult}`);
      return false;
    }

    const contentStr = buf.toString('utf-8');
    const skillMetadata = isBundle ? null : parseSkillHeaderForCli(contentStr);
    const existing = await readFileData(cid).catch(() => null);
    const fileData = {
      cid,
      content: isBundle ? undefined : contentStr,
      is_skill_bundle: isBundle || undefined,
      tags: existing?.tags ?? [],
      active: false,
      skillMetadata: skillMetadata || null,
      dsoulEntry: entry,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      activatedFolderName: existing?.activatedFolderName,
      activatedSkillsFolder: existing?.activatedSkillsFolder
    };

    const saveResult = await saveFileData(fileData, isBundle ? buf : undefined);
    if (!saveResult.success) {
      console.error('Save failed:', saveResult.error);
      return false;
    }

    const skillsFolder = options.skillsFolder != null
      ? options.skillsFolder
      : (settings.skillsFolder || process.env.DSOUL_SKILLS_FOLDER || '');
    if (!skillsFolder) {
      console.error('Skills folder not set. Use -g and set it in Options, or set DSOUL_SKILLS_FOLDER.');
      return false;
    }
    if (options.skillsFolder != null) {
      await fs.mkdir(skillsFolder, { recursive: true });
    }

    const activateOptions = options.skillsFolder != null ? { skillsFolderOverride: skillsFolder } : undefined;
    const activateResult = await doActivateFile(cid, activateOptions);
    if (!activateResult.success) {
      console.error('Activate failed:', activateResult.error);
      return false;
    }

    try {
      await updateDsoulJson(skillsFolder, 'add', {
        cid,
        shortname: (installRef && installRef !== cid) ? installRef : null
      });
    } catch (e) {
      // non-fatal
    }

    const name = skillMetadata?.name || entry.name || cid;
    console.log(`Installed and activated: ${name} (${cid})`);
    return true;
  } catch (err) {
    console.error('Install failed:', err.message || String(err));
    return false;
  }
}

async function readFileData(cid) {
  const filename = `${cid}.json`;
  const filepath = path.join(dataDir, filename);
  const content = await fs.readFile(filepath, 'utf-8');
  return JSON.parse(content);
}

async function saveFileData(fileData, zipBuffer) {
  try {
    const cid = fileData.cid;
    const isBundle = fileData.is_skill_bundle || fileData.is_bundle;
    if (isBundle && zipBuffer) {
      const zipPath = path.join(dataDir, `${cid}.zip`);
      const buf = Buffer.isBuffer(zipBuffer) ? zipBuffer : Buffer.from(zipBuffer);
      await fs.writeFile(zipPath, buf);
    }
    const toSave = isBundle ? { ...fileData, content: undefined } : { ...fileData };
    const filename = `${cid}.json`;
    const filepath = path.join(dataDir, filename);
    await fs.writeFile(filepath, JSON.stringify(toSave, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

const DSOUL_JSON_FILENAME = 'dsoul.json';

function getDsoulJsonPath(skillsFolder) {
  return path.join(skillsFolder, DSOUL_JSON_FILENAME);
}

async function readDsoulJson(skillsFolder) {
  const filepath = getDsoulJsonPath(skillsFolder);
  try {
    const content = await fs.readFile(filepath, 'utf-8');
    const data = JSON.parse(content);
    return Array.isArray(data.skills) ? data : { skills: [] };
  } catch (e) {
    return { skills: [] };
  }
}

async function updateDsoulJson(skillsFolder, action, item) {
  if (!skillsFolder || !String(skillsFolder).trim()) return;
  const dir = path.resolve(skillsFolder);
  await fs.mkdir(dir, { recursive: true });
  const data = await readDsoulJson(skillsFolder);
  if (action === 'add') {
    const existing = data.skills.findIndex((s) => s.cid === item.cid);
    const entry = { cid: item.cid, shortname: item.shortname ?? null };
    if (existing >= 0) {
      data.skills[existing] = entry;
    } else {
      data.skills.push(entry);
    }
  } else if (action === 'remove' && item.cid) {
    data.skills = data.skills.filter((s) => s.cid !== item.cid);
  }
  const filepath = getDsoulJsonPath(skillsFolder);
  await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
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
  const cliArgs = getCliArgs();
  if (cliArgs && cliArgs.command === 'config') {
    const settings = await loadSettings();
    const settingKey = cliArgs.key === 'dsoul-provider' ? 'dsoulProviderUrl' : 'skillsFolder';
    if (cliArgs.value !== undefined) {
      settings[settingKey] = cliArgs.value;
      const result = await saveSettings(settings);
      if (!result.success) {
        console.error(result.error || 'Failed to save settings');
        process.exit(1);
        return;
      }
      console.log(cliArgs.key, 'set to', cliArgs.value);
    } else {
      const current = settings[settingKey] || '';
      console.log(current || '(not set)');
    }
    process.exit(0);
    return;
  }
  if (cliArgs && cliArgs.command === 'uninstall') {
    await ensureDataDir();
    let cid = parseCID(cliArgs.target);
    if (!cid) {
      const resolved = await resolveShortname(cliArgs.target);
      if (!resolved.success) {
        console.error(resolved.error);
        process.exit(1);
        return;
      }
      cid = resolved.cid;
    }
    const existing = await readFileData(cid).catch(() => null);
    if (!existing) {
      console.error('Not installed:', cliArgs.target);
      process.exit(1);
      return;
    }
    const uninstallBaseFolder = existing.activatedSkillsFolder || (await loadSettings()).skillsFolder || process.env.DSOUL_SKILLS_FOLDER || '';
    try {
      if (uninstallBaseFolder) await updateDsoulJson(uninstallBaseFolder, 'remove', { cid });
    } catch (_) {}
    const deactivateResult = await doDeactivateFile(cid);
    if (!deactivateResult.success && existing.active) {
      console.warn('Could not deactivate (removing from app anyway):', deactivateResult.error);
    }
    const deleteResult = await doDeleteFile(cid);
    if (!deleteResult.success) {
      console.error(deleteResult.error || 'Failed to remove');
      process.exit(1);
      return;
    }
    console.log('Uninstalled:', cid);
    process.exit(0);
    return;
  }
  if (cliArgs && cliArgs.command === 'install') {
    await ensureDataDir();
    let cid = parseCID(cliArgs.target);
    let shortnameData = null;
    if (!cid) {
      const resolved = await resolveShortname(cliArgs.target);
      if (!resolved.success) {
        console.error(resolved.error);
        process.exit(1);
        return;
      }
      cid = resolved.cid;
      shortnameData = resolved.data;
    }
    if (shortnameData != null) {
      console.log('Shortname resolution:');
      console.log(JSON.stringify(shortnameData, null, 2));
    }
    const installOptions = cliArgs.global ? undefined : { skillsFolder: path.join(process.cwd(), 'Skills') };
    const ok = await runCliInstall(cid, installOptions, cliArgs.target);
    process.exit(ok ? 0 : 1);
    return;
  }

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
  return await saveFileData(fileData, zipBuffer);
});

async function doDeleteFile(cid) {
  try {
    const filename = `${cid}.json`;
    const filepath = path.join(dataDir, filename);
    let fileData = null;
    try {
      const content = await fs.readFile(filepath, 'utf-8');
      fileData = JSON.parse(content);
    } catch (_) {}
    await fs.unlink(filepath);
    if (fileData && (fileData.is_skill_bundle || fileData.is_bundle)) {
      const zipPath = path.join(dataDir, `${cid}.zip`);
      try {
        await fs.unlink(zipPath);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

ipcMain.handle('delete-file', async (event, cid) => {
  return await doDeleteFile(cid);
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
    if (content == null) {
      return { success: false, error: 'No content to hash' };
    }
    let input;
    if (typeof content === 'string') {
      input = Buffer.from(content, 'utf-8');
    } else if (content && typeof content.buffer === 'object' && content.buffer instanceof ArrayBuffer) {
      input = Buffer.from(content);
    } else if (content && content instanceof ArrayBuffer) {
      input = Buffer.from(content);
    } else if (Buffer.isBuffer(content)) {
      input = content;
    } else {
      return { success: false, error: 'Content must be a string or buffer' };
    }
    const hash = await Hash.of(input);
    return { success: true, hash };
  } catch (error) {
    console.error('Error calculating hash:', error);
    const msg = (error && (error.message || String(error))) || 'Unknown error';
    return { success: false, error: msg };
  }
});

ipcMain.handle('fetch-dsoul-by-cid', async (event, cid) => {
  try {
    const template = await getDsoulUrlTemplate();
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
    const settings = JSON.parse(content);
    settings.skillsFolder = settings.skillsFolder || process.env.DSOUL_SKILLS_FOLDER || '';
    settings.dsoulProviderUrl = settings.dsoulProviderUrl ?? '';
    if (!Array.isArray(settings.ipfsGateways) || settings.ipfsGateways.length === 0) {
      settings.ipfsGateways = DEFAULT_IPFS_GATEWAYS.slice();
    }
    return settings;
  } catch (error) {
    return {
      skillsFolder: process.env.DSOUL_SKILLS_FOLDER || '',
      dsoulProviderUrl: '',
      ipfsGateways: DEFAULT_IPFS_GATEWAYS.slice()
    };
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

/** Returns a file-safe folder name: trimmed, invalid path chars replaced with underscore, collapsed. */
function getFileSafeSkillName(fileData) {
  let raw = (fileData.skillMetadata?.name || fileData.dsoulEntry?.name || fileData.cid || 'skill').trim();
  raw = raw.replace(/\.zip$/i, '').trim() || raw;
  const safe = raw.replace(/[\s\\/:*?"<>|]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'skill';
  return safe;
}

/** Returns skillDir path and final folder name, adding _1, _2, ... if base name already exists. */
async function getSkillDirNoConflict(skillsFolder, fileSafeName) {
  let name = fileSafeName;
  let dir = path.join(skillsFolder, name);
  let n = 0;
  while (true) {
    try {
      await fs.access(dir);
      n++;
      name = `${fileSafeName}_${n}`;
      dir = path.join(skillsFolder, name);
    } catch (e) {
      if (e.code === 'ENOENT') break;
      throw e;
    }
  }
  return { skillDir: dir, folderName: name };
}

function extractEntryToFileNoOverwrite(zipfile, entry, destDir, destFileNameOverride) {
  const destFileName = destFileNameOverride != null ? destFileNameOverride : entry.fileName;
  return new Promise((resolve, reject) => {
    const destPath = path.join(destDir, destFileName);
    if (/\/$/.test(entry.fileName)) {
      const dirPath = path.join(destDir, entry.fileName);
      fs.mkdir(dirPath, { recursive: true }).then(() => resolve(), reject);
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
async function doActivateFile(cid, options) {
  try {
    const filename = `${cid}.json`;
    const filepath = path.join(dataDir, filename);
    const content = await fs.readFile(filepath, 'utf-8');
    const fileData = JSON.parse(content);

    const settings = await loadSettings();
    const baseFolder = (options && options.skillsFolderOverride != null && options.skillsFolderOverride !== '')
      ? options.skillsFolderOverride
      : (settings.skillsFolder || process.env.DSOUL_SKILLS_FOLDER || '');
    if (!baseFolder) {
      return { success: false, error: 'Skills folder not set. Please configure it in Options or set DSOUL_SKILLS_FOLDER.' };
    }

    const baseFolderResolved = path.resolve(baseFolder);
    const sameFolder = fileData.activatedFolderName && fileData.activatedSkillsFolder &&
      path.resolve(fileData.activatedSkillsFolder) === baseFolderResolved;

    let skillDir;
    let folderName;
    if (sameFolder) {
      folderName = fileData.activatedFolderName;
      skillDir = path.join(baseFolder, folderName);
      try {
        await fs.rm(skillDir, { recursive: true, force: true });
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      await fs.mkdir(skillDir, { recursive: true });
    } else {
      const fileSafeName = getFileSafeSkillName(fileData);
      const result = await getSkillDirNoConflict(baseFolder, fileSafeName);
      skillDir = result.skillDir;
      folderName = result.folderName;
      await fs.mkdir(skillDir, { recursive: true });
    }

    if (fileData.is_skill_bundle || fileData.is_bundle) {
      const zipPath = path.join(dataDir, `${cid}.zip`);
      await new Promise((resolve, reject) => {
        let resolved = false;
        yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
          if (err) return reject(err);
          zipfile.on('entry', (entry) => {
            const baseLower = path.basename(entry.fileName).replace(/\/$/, '').toLowerCase();
            const mainAsSkillMd = baseLower === 'skill.md' ? 'skill.md' : null;
            extractEntryToFileNoOverwrite(zipfile, entry, skillDir, mainAsSkillMd).then(() => {
              zipfile.readEntry();
            }, (e) => {
              if (!resolved) { resolved = true; try { zipfile.close(); } catch (_) {} reject(e); }
            });
          });
          zipfile.on('end', () => {
            if (!resolved) { resolved = true; try { zipfile.close(); } catch (_) {} resolve(); }
          });
          zipfile.on('error', (e) => {
            if (e && (e.message === 'closed' || e.message === 'Closed')) return;
            if (!resolved) { resolved = true; try { zipfile.close(); } catch (_) {} reject(e); }
          });
          zipfile.readEntry();
        });
      });
    } else {
      const skillMdPath = path.join(skillDir, 'skill.md');
      await fs.writeFile(skillMdPath, fileData.content, 'utf-8');
    }

    fileData.active = true;
    fileData.activatedFolderName = folderName;
    fileData.activatedSkillsFolder = baseFolder;
    await fs.writeFile(filepath, JSON.stringify(fileData, null, 2), 'utf-8');

    try {
      await updateDsoulJson(baseFolder, 'add', { cid, shortname: null });
    } catch (_) {}

    return { success: true };
  } catch (error) {
    console.error('Error activating file:', error);
    return { success: false, error: error.message };
  }
}

ipcMain.handle('activate-file', async (event, cid) => {
  return await doActivateFile(cid);
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

/** Find and read first zip entry whose basename matches entryFileName (case-insensitive). */
function readEntryFromZip(zipPath, entryFileName) {
  return new Promise((resolve, reject) => {
    const targetName = (entryFileName || '').toString().toLowerCase();
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipfile.readEntry();
          return;
        }
        const entryBase = path.basename(entry.fileName).replace(/\/$/, '').toLowerCase();
        if (entryBase === targetName) {
          zipfile.openReadStream(entry, (readErr, readStream) => {
            if (readErr) { zipfile.close(); return reject(readErr); }
            const chunks = [];
            readStream.on('data', (chunk) => chunks.push(chunk));
            readStream.on('end', () => {
              zipfile.close();
              resolve(Buffer.concat(chunks).toString('utf-8'));
            });
            readStream.on('error', (e) => { zipfile.close(); reject(e); });
          });
        } else {
          zipfile.readEntry();
        }
      });
      zipfile.on('end', () => { zipfile.close(); resolve(null); });
      zipfile.on('error', reject);
      zipfile.readEntry();
    });
  });
}

/** Find and read first zip file entry where predicate(entryFileName) is true. Path comparison is case-insensitive. */
function readFirstEntryFromZipWhere(zipPath, predicate) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipfile.readEntry();
          return;
        }
        const normalized = path.basename(entry.fileName).replace(/\/$/, '').toLowerCase();
        if (predicate(entry.fileName, normalized)) {
          zipfile.openReadStream(entry, (readErr, readStream) => {
            if (readErr) { zipfile.close(); return reject(readErr); }
            const chunks = [];
            readStream.on('data', (chunk) => chunks.push(chunk));
            readStream.on('end', () => {
              zipfile.close();
              resolve(Buffer.concat(chunks).toString('utf-8'));
            });
            readStream.on('error', (e) => { zipfile.close(); reject(e); });
          });
        } else {
          zipfile.readEntry();
        }
      });
      zipfile.on('end', () => { zipfile.close(); resolve(null); });
      zipfile.on('error', reject);
      zipfile.readEntry();
    });
  });
}

ipcMain.handle('get-bundle-skill-content', async (event, cid) => {
  try {
    const zipPath = path.join(dataDir, `${cid}.zip`);
    const content = await readEntryFromZip(zipPath, 'Skill.MD');
    return { success: true, content };
  } catch (error) {
    console.error('Error reading bundle skill content:', error);
    return { success: false, error: error.message };
  }
});

/** Validate zip buffer: has Skill.MD (case-insensitive basename). Used when DSOUL has no entry so we detect skill bundles from IPFS directly. */
ipcMain.handle('validate-zip-skill-bundle', async (event, buffer) => {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const tmpPath = path.join(os.tmpdir(), `dsoul-verify-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
  try {
    await fs.writeFile(tmpPath, buf);
    const skillContent = await readEntryFromZip(tmpPath, 'Skill.MD');
    return { success: true, valid: !!skillContent, skillContent: skillContent || null };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
});

/** License filenames to try (case-insensitive match against zip entry basename). */
const LICENSE_ENTRY_NAMES = ['license.md', 'license', 'license.txt'];

ipcMain.handle('get-bundle-license-content', async (event, cid) => {
  try {
    const zipPath = path.join(dataDir, `${cid}.zip`);
    for (const name of LICENSE_ENTRY_NAMES) {
      const content = await readEntryFromZip(zipPath, name);
      if (content) return { success: true, content };
    }
    const content = await readFirstEntryFromZipWhere(zipPath, (_fileName, baseLower) => baseLower.includes('license'));
    return { success: true, content };
  } catch (error) {
    console.error('Error reading bundle license content:', error);
    return { success: false, error: error.message };
  }
});

async function doDeactivateFile(cid) {
  try {
    const filename = `${cid}.json`;
    const filepath = path.join(dataDir, filename);
    const content = await fs.readFile(filepath, 'utf-8');
    const fileData = JSON.parse(content);

    const settings = await loadSettings();
    const baseFolder = fileData.activatedSkillsFolder || settings.skillsFolder || process.env.DSOUL_SKILLS_FOLDER || '';

    try {
      if (baseFolder) await updateDsoulJson(baseFolder, 'remove', { cid });
    } catch (_) {}

    if (fileData.activatedFolderName) {
      if (!baseFolder) {
        return { success: false, error: 'Skills folder not set and activation path unknown.' };
      }
      const skillDir = path.join(baseFolder, fileData.activatedFolderName);
      try {
        await fs.rm(skillDir, { recursive: true, force: true });
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      delete fileData.activatedFolderName;
      delete fileData.activatedSkillsFolder;
    } else if (baseFolder) {
      if (fileData.is_skill_bundle || fileData.is_bundle) {
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
          const fullPath = path.join(baseFolder, fileName);
          try {
            await fs.unlink(fullPath);
          } catch (e) {
            if (e.code !== 'ENOENT') throw e;
          }
        }
      } else {
        const skillsFilePath = path.join(baseFolder, `${cid}.MD`);
        try {
          await fs.unlink(skillsFilePath);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
    }

    fileData.active = false;
    await fs.writeFile(filepath, JSON.stringify(fileData, null, 2), 'utf-8');

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

ipcMain.handle('deactivate-file', async (event, cid) => {
  return await doDeactivateFile(cid);
});
