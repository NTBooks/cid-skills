const path = require('path');
const fs = require('fs').promises;
const { getFilesDir, getSettingsPath, defaultDsoulProviderOrigin } = require('./config');

const DEFAULT_IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://dweb.link/ipfs/',
  'https://gateway.ipfs.io/ipfs/'
];

const DEFAULT_RPC_BASE = 'https://mainnet.base.org,https://1rpc.io/base,https://base.public.blockpi.network/v1/rpc/public,https://base.rpc.blxrbdn.com/,https://base.leorpc.com/?api_key=FREE,https://base.llamarpc.com,https://base-public.nodies.app,https://endpoints.omniatech.io/v1/base/mainnet/public,https://base.api.onfinality.io/public,https://base-rpc.polkachu.com/,https://base.rpc.subquery.network/public,https://base.gateway.tenderly.co,https://base.rpc.thirdweb.com/,https://base-rpc.publicnode.com,https://base.drpc.org';

const DSOUL_JSON_FILENAME = 'dsoul.json';

async function ensureDataDir() {
  const dataDir = getFilesDir();
  try {
    await fs.mkdir(dataDir, { recursive: true });
  } catch (error) {
    console.error('Error creating data directory:', error);
  }
}

async function loadSettings() {
  const settingsPath = getSettingsPath();
  try {
    const content = await fs.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(content);
    settings.skillsFolder = settings.skillsFolder || process.env.DSOUL_SKILLS_FOLDER || '';
    settings.skillsFolderName = settings.skillsFolderName != null && String(settings.skillsFolderName).trim() !== '' ? String(settings.skillsFolderName).trim() : 'skills';
    settings.dsoulProviderUrl = settings.dsoulProviderUrl || defaultDsoulProviderOrigin;
    settings.rpcBase = settings.rpcBase ?? DEFAULT_RPC_BASE;
    if (!Array.isArray(settings.ipfsGateways) || settings.ipfsGateways.length === 0) {
      settings.ipfsGateways = DEFAULT_IPFS_GATEWAYS.slice();
    }
    return settings;
  } catch (_) {
    return {
      skillsFolder: process.env.DSOUL_SKILLS_FOLDER || '',
      skillsFolderName: 'skills',
      dsoulProviderUrl: defaultDsoulProviderOrigin,
      rpcBase: DEFAULT_RPC_BASE,
      ipfsGateways: DEFAULT_IPFS_GATEWAYS.slice()
    };
  }
}

async function saveSettings(settings) {
  const settingsPath = getSettingsPath();
  try {
    const dir = path.dirname(settingsPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('Error saving settings:', error);
    return { success: false, error: error.message };
  }
}

async function readFileData(cid) {
  const dataDir = getFilesDir();
  const filename = `${cid}.json`;
  const filepath = path.join(dataDir, filename);
  const content = await fs.readFile(filepath, 'utf-8');
  return JSON.parse(content);
}

async function saveFileData(fileData, zipBuffer) {
  const dataDir = getFilesDir();
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

async function doDeleteFile(cid) {
  const dataDir = getFilesDir();
  try {
    const filename = `${cid}.json`;
    const filepath = path.join(dataDir, filename);
    let fileData = null;
    try {
      const content = await fs.readFile(filepath, 'utf-8');
      fileData = JSON.parse(content);
    } catch (_) { }
    await fs.unlink(filepath);
    if (fileData && (fileData.is_skill_bundle || fileData.is_bundle)) {
      const zipPath = path.join(dataDir, `${cid}.zip`);
      try { await fs.unlink(zipPath); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function getAllFiles() {
  const dataDir = getFilesDir();
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
}

async function updateFileTags(cid, tags) {
  const dataDir = getFilesDir();
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
}

function getDsoulJsonPath(skillsFolder) {
  return path.join(skillsFolder, DSOUL_JSON_FILENAME);
}

async function readDsoulJson(skillsFolder) {
  const filepath = getDsoulJsonPath(skillsFolder);
  try {
    const content = await fs.readFile(filepath, 'utf-8');
    const data = JSON.parse(content);
    return Array.isArray(data.skills) ? data : { skills: [] };
  } catch (_) {
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
    const hostname = item.hostname != null && String(item.hostname).trim() ? String(item.hostname).trim() : null;
    const entry = {
      cid: item.cid,
      shortname: item.shortname ?? null,
      num: item.post_id != null ? item.post_id : null,
      src: item.post_link != null && String(item.post_link).trim() ? String(item.post_link).trim() : null,
      hostname
    };
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

module.exports = {
  DEFAULT_IPFS_GATEWAYS,
  DEFAULT_RPC_BASE,
  DSOUL_JSON_FILENAME,
  ensureDataDir,
  loadSettings,
  saveSettings,
  readFileData,
  saveFileData,
  doDeleteFile,
  getAllFiles,
  updateFileTags,
  getDsoulJsonPath,
  readDsoulJson,
  updateDsoulJson
};
