const path = require('path');
const fs = require('fs').promises;
const { getBlocklistCachePath } = require('./config');
const { getDsoulProviderBase } = require('./dsoul-api');
const { loadSettings, readDsoulJson } = require('./storage');

const BLOCKLIST_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

async function fetchBlocklistFromApi() {
  try {
    const base = await getDsoulProviderBase();
    const url = `${base}/blocklist`;
    console.error('Calling DSoul API:', url);
    if (process.env.DSOUL_DEBUG) {
      process.stderr.write(`Blocklist API URL: ${url}\n`);
    }
    const res = await fetch(url);
    const text = await res.text();
    if (process.env.DSOUL_DEBUG) {
      process.stderr.write(`Blocklist API raw response (HTTP ${res.status}): ${text.slice(0, 2000)}${text.length > 2000 ? '...' : ''}\n`);
    }
    if (!res.ok) return { success: false, error: `HTTP ${res.status}: ${text || res.statusText}` };
    let data;
    try { data = JSON.parse(text); } catch (_) { return { success: false, error: 'Invalid JSON from blocklist' }; }
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.cids) ? data.cids : (data && data.cids ? [data.cids] : []));
    const cids = list
      .map((c) => (typeof c === 'string' ? c : (c && typeof c === 'object' && typeof c.cid === 'string' ? c.cid : null)))
      .filter((c) => c != null && c.trim())
      .map((c) => c.trim());
    if (process.env.DSOUL_DEBUG) {
      process.stderr.write(`Blocklist parsed: ${cids.length} CID(s)\n`);
    }
    return { success: true, cids };
  } catch (err) {
    return { success: false, error: err && (err.message || String(err)) };
  }
}

async function loadBlocklistFromCache() {
  try {
    const filepath = getBlocklistCachePath();
    const content = await fs.readFile(filepath, 'utf-8');
    const data = JSON.parse(content);
    const cids = Array.isArray(data.cids) ? data.cids : [];
    const fetchedAt = typeof data.fetchedAt === 'number' ? data.fetchedAt : 0;
    return { cids, fetchedAt };
  } catch (_) {
    return null;
  }
}

async function saveBlocklistToCache(cids) {
  try {
    const filepath = getBlocklistCachePath();
    await fs.writeFile(filepath, JSON.stringify({ cids, fetchedAt: Date.now() }, null, 2), 'utf-8');
    return true;
  } catch (_) {
    return false;
  }
}

async function getBlocklist(forceRefresh) {
  let cids = [];
  if (!forceRefresh) {
    const cached = await loadBlocklistFromCache();
    if (cached && cached.fetchedAt && (Date.now() - cached.fetchedAt) < BLOCKLIST_CACHE_MAX_AGE_MS) {
      return new Set(cached.cids);
    }
    if (cached && cached.cids.length > 0) {
      cids = cached.cids;
    }
  }
  const result = await fetchBlocklistFromApi();
  if (result.success && result.cids.length >= 0) {
    cids = result.cids;
    await saveBlocklistToCache(cids);
  }
  return new Set(cids);
}

async function getAllInstalledCids() {
  const settings = await loadSettings();
  const globalFolder = (settings.skillsFolder || process.env.DSOUL_SKILLS_FOLDER || '').trim();
  const folderName = (settings.skillsFolderName != null && String(settings.skillsFolderName).trim() !== '') ? String(settings.skillsFolderName).trim() : 'Skills';
  const localFolder = path.join(process.cwd(), folderName);
  const folders = [];
  if (globalFolder) folders.push({ dir: globalFolder, label: 'global' });
  if (!globalFolder || path.resolve(globalFolder) !== path.resolve(localFolder)) {
    folders.push({ dir: localFolder, label: 'local' });
  }
  const out = [];
  for (const { dir, label } of folders) {
    try {
      const data = await readDsoulJson(dir);
      const skills = Array.isArray(data.skills) ? data.skills : [];
      for (const skill of skills) {
        const cid = skill.cid || '';
        if (cid) out.push({ cid, dir, label });
      }
    } catch (_) {
      // skip
    }
  }
  return out;
}

function printBlockedCidsWarning(blockedCids) {
  if (!blockedCids || blockedCids.length === 0) return;
  const lines = [
    '',
    '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
    '  WARNING: The following CIDs are on the blocklist and should not be used:',
    '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
    ...blockedCids.map((c) => `  - ${c}`),
    '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
    ''
  ];
  process.stderr.write(lines.join('\n'));
}

module.exports = {
  BLOCKLIST_CACHE_MAX_AGE_MS,
  fetchBlocklistFromApi,
  getBlocklist,
  getAllInstalledCids,
  printBlockedCidsWarning
};
