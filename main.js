const { app, BrowserWindow, ipcMain, dialog, Menu, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const { Writable } = require('stream');
const readline = require('readline');
const archiver = require('archiver');
const FormData = require('form-data');
const Hash = require('ipfs-only-hash');
const yauzl = require('yauzl');

const defaultDsoulProviderOrigin = 'https://dsoul.org';
const DSOUL_API_PATH = '/wp-json/diamond-soul/v1';

function printCliDisclaimer() {
  const msg = [
    'dsoul CLI - alpha release. Use at your own risk.',
    'Open source: https://github.com/NTBooks/cid-skills',
    ''
  ].join('\n');
  process.stderr.write(msg);
}

// CLI: parse commands. In packaged app (AppImage, etc.) argv[1] is first user arg; in dev argv[2] is.
function getCliArgs() {
  const argv = process.argv;
  const cmdIndex = app.isPackaged ? 1 : 2;
  const argIndex = cmdIndex + 1;
  const cmd = argv[cmdIndex];
  if (cmd === 'install') {
    const rest = argv.slice(argIndex);
    const global = rest.includes('-g');
    const yes = rest.includes('-y');
    const target = rest.find((a) => a !== '-g' && a !== '-y' && !a.startsWith('-'));
    if (!target || !String(target).trim()) return null;
    return { command: 'install', target: String(target).trim(), global, yes };
  }
  if (cmd === 'config') {
    const key = argv[argIndex];
    const value = argv[argIndex + 1];
    const validKeys = ['dsoul-provider', 'skills-folder', 'skills-folder-name'];
    if (!key || !validKeys.includes(key)) return null;
    return {
      command: 'config',
      key,
      value: value != null ? String(value).trim() : undefined
    };
  }
  if (cmd === 'uninstall') {
    const target = (argv[argIndex] || '').trim();
    if (!target) return null;
    return { command: 'uninstall', target };
  }
  if (cmd === 'package') {
    const folder = (argv[argIndex] || '').trim();
    if (!folder) return null;
    return { command: 'package', folder };
  }
  if (cmd === 'register') return { command: 'register' };
  if (cmd === 'unregister') return { command: 'unregister' };
  if (cmd === 'help' || cmd === '-h' || cmd === '--help') return { command: 'help' };
  if (cmd === '--version' || cmd === '-V') return { command: 'version' };
  if (cmd === 'update') {
    const rest = argv.slice(argIndex);
    const globalOnly = rest.includes('-g');
    const localOnly = rest.includes('--local');
    let deleteBlocked;
    if (rest.includes('--delete-blocked')) deleteBlocked = true;
    else if (rest.includes('--no-delete-blocked')) deleteBlocked = false;
    return { command: 'update', globalOnly, localOnly, deleteBlocked };
  }
  if (cmd === 'upgrade') {
    const rest = argv.slice(argIndex);
    const globalOnly = rest.includes('-g');
    const localOnly = rest.includes('--local');
    const yes = rest.includes('-y');
    return { command: 'upgrade', globalOnly, localOnly, yes };
  }
  if (cmd === 'balance') return { command: 'balance' };
  if (cmd === 'files') {
    const rest = argv.slice(argIndex);
    const opts = { page: 1, per_page: 100 };
    rest.forEach((a) => {
      if (a.startsWith('--page=')) opts.page = parseInt(a.slice(7), 10) || 1;
      else if (a.startsWith('--per_page=')) opts.per_page = parseInt(a.slice(11), 10) || 100;
    });
    return { command: 'files', ...opts };
  }
  if (cmd === 'freeze') {
    const rest = argv.slice(argIndex);
    const nonFlags = rest.filter((a) => !a.startsWith('--'));
    const file = nonFlags.length ? nonFlags.join(' ').trim() : '';
    if (!file) return null;
    const opts = { file };
    rest.forEach((a) => {
      if (a.startsWith('--shortname=')) opts.shortname = a.slice(12).trim();
      else if (a.startsWith('--tags=')) opts.tags = a.slice(7).trim();
      else if (a.startsWith('--version=')) opts.version = a.slice(10).trim();
      else if (a.startsWith('--license_url=')) opts.license_url = a.slice(14).trim();
    });
    return { command: 'freeze', ...opts };
  }
  if (cmd === 'hash') {
    const sub = argv[argIndex];
    const file = (argv[argIndex + 1] || '').trim();
    if (sub === 'cidv0' && file) return { command: 'hash', subcommand: 'cidv0', file };
    return null;
  }
  if (cmd === 'init') {
    const directory = (argv[argIndex] || '').trim();
    if (!directory) return null;
    return { command: 'init', directory };
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

/** Get the hostname of the configured DSOUL provider (e.g. dsoul.org, donotreplace.com). */
async function getProviderHostname() {
  try {
    const base = await getDsoulProviderBase();
    const u = new URL(base);
    return u.hostname || null;
  } catch (_) {
    return null;
  }
}

/** URL template for CID lookup: base + /search_by_cid?cid={CID}.
 *  Server should return an array of entries; each entry must include the WordPress post ID
 *  so we can store it and call GET /file/{post_id}/graph for updates. Use id, ID, or post_id (number). */
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

const BLOCKLIST_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

function getBlocklistCachePath() {
  return path.join(userDataPath, 'blocklist.json');
}

async function fetchBlocklistFromApi() {
  try {
    const base = await getDsoulProviderBase();
    const url = `${base}/blocklist`;
    if (process.env.DSOUL_DEBUG) {
      process.stderr.write(`Blocklist API URL: ${url}\n`);
    }
    const res = await fetch(url);
    const text = await res.text();
    if (process.env.DSOUL_DEBUG) {
      process.stderr.write(`Blocklist API raw response (HTTP ${res.status}): ${text.slice(0, 2000)}${text.length > 2000 ? '...' : ''}\n`);
    }
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}: ${text || res.statusText}` };
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return { success: false, error: 'Invalid JSON from blocklist' };
    }
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.cids) ? data.cids : (data && data.cids ? [data.cids] : []));
    const cids = list
      .map((c) => (typeof c === 'string' ? c : (c && typeof c === 'object' && typeof c.cid === 'string' ? c.cid : null)))
      .filter((c) => c != null && c.trim())
      .map((c) => c.trim());
    if (process.env.DSOUL_DEBUG) {
      process.stderr.write(`Blocklist parsed: ${cids.length} CID(s) from keys: ${Array.isArray(data) ? 'root array' : Object.keys(data || {}).join(', ')}\n`);
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

/** Get set of blocked CIDs. Use forceRefresh to bypass cache (e.g. on dsoul update). */
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

/** Get all installed CIDs from global and local dsoul.json. Returns { cid, dir, label }[]. */
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

let mainWindow;
const userDataPath = app.getPath('userData');
const dataDir = path.join(userDataPath, 'ipfs-files');
const settingsPath = path.join(userDataPath, 'settings.json');
const wpCredentialsPath = path.join(userDataPath, 'wp-credentials.enc');

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

/** Load WordPress credentials from secure storage. Returns { username, applicationKey } or null. */
async function loadWpCredentials() {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const buf = await fs.readFile(wpCredentialsPath);
    const decrypted = safeStorage.decryptString(Buffer.from(buf));
    const data = JSON.parse(decrypted);
    if (data && typeof data.username === 'string' && typeof data.applicationKey === 'string') {
      return { username: data.username.trim(), applicationKey: data.applicationKey };
    }
  } catch (_) {
    // file missing, decrypt failed, or invalid JSON
  }
  return null;
}

/** Save WordPress credentials to secure storage. */
async function saveWpCredentials(credentials) {
  if (!safeStorage.isEncryptionAvailable()) {
    return { success: false, error: 'Secure storage is not available on this system' };
  }
  try {
    const plain = JSON.stringify({
      username: String(credentials.username || '').trim(),
      applicationKey: String(credentials.applicationKey || '').trim()
    });
    const encrypted = safeStorage.encryptString(plain);
    await fs.writeFile(wpCredentialsPath, Buffer.from(encrypted));
    return { success: true };
  } catch (err) {
    return { success: false, error: err && (err.message || String(err)) };
  }
}

/** Clear stored WordPress credentials. */
async function clearWpCredentials() {
  try {
    await fs.unlink(wpCredentialsPath);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

/** Record a file metric (view, download, favorite) via POST /file/{id}/metrics. Requires stored credentials. Non-fatal. */
async function recordFileMetric(fileId, type) {
  if (fileId == null || !['view', 'download', 'favorite'].includes(type)) return;
  const credentials = await loadWpCredentials();
  if (!credentials) return;
  try {
    const base = await getDsoulProviderBase();
    const url = `${base}/file/${encodeURIComponent(String(fileId))}/metrics`;
    const authHeader = 'Basic ' + Buffer.from(credentials.username + ':' + credentials.applicationKey).toString('base64');
    const body = new URLSearchParams({ type }).toString();
    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });
  } catch (_) {
    // best-effort; do not fail install or disambiguation
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

/** Get sortable timestamp from DSOUL entry for "oldest" ordering. Uses date, date_gmt, modified, post_date. */
function getEntryDateMs(entry) {
  const raw = entry?.date || entry?.date_gmt || entry?.modified || entry?.post_date;
  if (raw == null || raw === '') return 0;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/** URL keys used for "View skill on" link and for parsing post id. Same order as UI: wordpress_url, link. */
const ENTRY_LINK_KEYS = ['wordpress_url', 'link', 'guid', 'download_url', 'url', 'permalink', 'view_url', 'page_url', 'skill_url'];

/** Get the view/skill page URL from API entry (same link as "View skill on" in the UI). */
function getPostLinkFromEntry(entry) {
  if (!entry) return null;
  for (const key of ENTRY_LINK_KEYS) {
    const v = entry[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

/** Resolve WordPress post ID and view link from API entry. Returns { postId, postLink }. */
function resolvePostIdFromEntry(entry) {
  const postLink = getPostLinkFromEntry(entry);
  const fromField = (v) => {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : parseInt(String(v).trim(), 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  let postId = fromField(entry.id) ?? fromField(entry.ID) ?? fromField(entry.post_id);
  if (postId != null) return { postId, postLink: postLink || null };
  const urls = postLink ? [postLink] : ENTRY_LINK_KEYS.map((k) => entry[k]).filter(Boolean);
  for (const url of urls) {
    const s = String(url).trim();
    const m = s.match(/\/(?:file|post|posts|wp\/v2\/posts|skill|f|view)\/(\d+)(?:\/|$|\?)/i)
      || s.match(/[?&]p=(\d+)(?:&|$)/)
      || s.match(/[?&]post_id=(\d+)(?:&|$)/)
      || s.match(/\/(\d+)(?:\/|$|\?)/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isInteger(n) && n > 0) return { postId: n, postLink: postLink || null };
    }
  }
  return { postId: null, postLink };
}

/** Ask user for input via readline. Returns Promise<string>. */
function askLine(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer != null ? String(answer).trim() : '');
    });
  });
}

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
    let entry;
    if (entries.length === 1) {
      entry = entries[0];
    } else if (options.autoPickOldest) {
      const sorted = [...entries].sort((a, b) => getEntryDateMs(a) - getEntryDateMs(b));
      entry = sorted[0];
      console.log(`Multiple entries for CID; using oldest (${entry.name || entry.cid || cid}).`);
    } else {
      const sorted = [...entries].sort((a, b) => getEntryDateMs(a) - getEntryDateMs(b));
      console.log('\nMultiple Diamond Soul entries for this CID. Choose one:\n');
      sorted.forEach((e, i) => {
        const num = i + 1;
        const name = e.name || 'Unnamed';
        const author = e.author_name ? ` by ${e.author_name}` : '';
        const dateRaw = e.date || e.date_gmt || e.modified || e.post_date;
        const dateStr = dateRaw ? new Date(dateRaw).toISOString().slice(0, 10) : '';
        const tags = Array.isArray(e.tags) && e.tags.length ? ` [${e.tags.join(', ')}]` : '';
        const link = e.download_url || e.wordpress_url || e.link ? ' — ' + (e.download_url || e.wordpress_url || e.link) : '';
        console.log(`  ${num}) ${name}${author}${dateStr ? ` — ${dateStr}` : ''}${tags}${link}`);
      });
      console.log('');
      const isTty = process.stdin.isTTY && process.stdout.isTTY;
      if (!isTty) {
        entry = sorted[0];
        console.log('Non-interactive; using oldest (1).');
      } else {
        const answer = await askLine('Enter number (1-' + sorted.length + '): ');
        const idx = parseInt(answer, 10);
        if (Number.isNaN(idx) || idx < 1 || idx > sorted.length) {
          console.error('Invalid choice. Using oldest (1).');
          entry = sorted[0];
        } else {
          entry = sorted[idx - 1];
        }
      }
    }
    const { postId: metricsPostId } = resolvePostIdFromEntry(entry);
    if (metricsPostId) {
      recordFileMetric(metricsPostId, 'view').catch(() => { });
    }
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

    const { postId, postLink } = resolvePostIdFromEntry(entry);
    if (postId) {
      recordFileMetric(postId, 'download').catch(() => { });
    }
    try {
      const hostname = await getProviderHostname();
      await updateDsoulJson(skillsFolder, 'add', {
        cid,
        shortname: (installRef && installRef !== cid) ? installRef : null,
        post_id: postId,
        post_link: postLink || null,
        hostname: hostname || null
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

const PACKAGE_REQUIRED_FILES = ['license.txt', 'skill.md'];

function buildInitSkillMdContent(authorUsername) {
  const authorLine = typeof authorUsername === 'string' && authorUsername.trim()
    ? 'author: ' + authorUsername.trim()
    : 'author: ';
  return [
    '---',
    'name: ',
    'description: ',
    authorLine,
    '---',
    '',
    ''
  ].join('\n');
}

async function runCliInit(directoryArg) {
  try {
    const resolved = path.resolve(process.cwd(), directoryArg);
    const stat = await fs.stat(resolved).catch((e) => null);
    if (stat) {
      if (!stat.isDirectory()) {
        console.error('Init failed: path exists and is not a directory:', resolved);
        return false;
      }
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      if (entries.length > 0) {
        console.error('Init failed: directory is not empty:', resolved);
        return false;
      }
    } else {
      await fs.mkdir(resolved, { recursive: true });
    }
    const credentials = await loadWpCredentials();
    const skillMdContent = buildInitSkillMdContent(credentials ? credentials.username : null);
    const skillMdPath = path.join(resolved, 'skill.md');
    await fs.writeFile(skillMdPath, skillMdContent, 'utf-8');
    const licensePath = path.join(resolved, 'license.txt');
    await fs.writeFile(licensePath, 'No License', 'utf-8');
    console.log('Created:', resolved);
    console.log('  skill.md   (header template' + (credentials ? ', author: ' + credentials.username : '') + ')');
    console.log('  license.txt (No License)');
    return true;
  } catch (err) {
    console.error('Init failed:', err.message || String(err));
    return false;
  }
}

async function runCliPackage(folderArg) {
  try {
    const resolved = path.resolve(process.cwd(), folderArg);
    const stat = await fs.stat(resolved).catch((e) => null);
    if (!stat) {
      console.error('Package failed: folder not found:', resolved);
      return false;
    }
    if (!stat.isDirectory()) {
      console.error('Package failed: not a directory:', resolved);
      return false;
    }
    const folderName = path.basename(resolved);
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const fileNames = entries.filter((e) => e.isFile()).map((e) => e.name);
    const lowerToActual = {};
    fileNames.forEach((name) => {
      lowerToActual[name.toLowerCase()] = name;
    });
    const missing = [];
    for (const required of PACKAGE_REQUIRED_FILES) {
      if (!lowerToActual[required]) missing.push(required);
    }
    if (missing.length > 0) {
      console.error('Package failed: missing required file(s):', missing.join(', '));
      return false;
    }
    const zipName = folderName + '.zip';
    const zipPath = path.join(path.dirname(resolved), zipName);
    const output = fsSync.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', (err) => reject(err));
      archive.on('warning', (err) => {
        if (err.code !== 'ENOENT') reject(err);
      });
      archive.pipe(output);
      archive.directory(resolved, false);
      archive.finalize();
    });
    console.log('Created:', zipPath);
    return true;
  } catch (err) {
    console.error('Package failed:', err.message || String(err));
    return false;
  }
}

function getCliHelpText() {
  return [
    'Diamond Soul Downloader - dsoul CLI',
    '',
    'Usage: dsoul <command> [options] [args]',
    '',
    'Commands:',
    '  config [<key> [value]]     Set or view dsoul-provider, skills-folder, skills-folder-name',
    '  install [-g] [-y] <cid-or-shortname>   Install a skill by CID or shortname',
    '  uninstall <cid-or-shortname>           Uninstall a skill (CID or shortname)',
    '  update [-g] [--local] [--delete-blocked|--no-delete-blocked]  Check for upgrades; if blocked CIDs found, optionally delete them',
    '  upgrade [-g] [--local]                Upgrade skills to latest (uninstall old, install latest)',
    '  init <directory>          Create a folder with skill.md template and blank license.txt',
    '  package <folder>          Package a folder (license.txt + skill.md) as zip',
    '  hash cidv0 <file>         Print CIDv0 (IPFS) hash of a file to the console',
    '  freeze <file> [opts]      Stamp a file (zip/js/css/md/txt) via DSOUL freeze API',
    '  balance                   Check stamp/credit balance (uses stored credentials)',
    '  files [opts]              List your frozen files (uses stored credentials)',
    '  register                  Store WordPress username and application key (secure)',
    '  unregister                Clear stored WordPress credentials',
    '  help                      Show this help',
    '',
    'Options for install:',
    '  -g    Install to configured global skills folder',
    '  -y    Auto-pick oldest entry when multiple DSOUL entries exist',
    '',
    'Options for update / upgrade:',
    '  -g        Global skills folder only',
    '  --local   Local project skills folder only',
    '  --delete-blocked   (update only) Delete all blocked items without prompting',
    '  --no-delete-blocked  (update only) Do not delete blocked items, do not prompt',
    '',
    'Options for freeze:',
    '  --shortname=NAME   Register shortname (username@NAME:version); fails if taken',
    '  --tags=tag1,tag2   Comma-separated tags (or hashtags)',
    '  --version=X.Y.Z   Version (default: 1.0.0)',
    '  --license_url=URL   URL to a license file',
    '',
    'Options for files:',
    '  --page=N       Page number (default: 1)',
    '  --per_page=N   Items per page (default: 100, max: 500)',
    ''
  ].join('\n');
}

/** Fetch upgrade graph for a post. GET .../file/{post_id_or_link}/graph. postIdOrLink can be numeric id or the view URL. */
async function fetchUpgradeGraph(postIdOrLink) {
  if (postIdOrLink == null || String(postIdOrLink).trim() === '') return { success: false, error: 'Missing post_id or post_link' };
  const base = await getDsoulProviderBase();
  const url = `${base}/file/${encodeURIComponent(String(postIdOrLink))}/graph`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}: ${text || res.statusText}` };
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return { success: false, error: 'Invalid JSON from graph API' };
    }
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err && (err.message || String(err)) };
  }
}

/** Follow the next chain in nodes from startCid until the tail; returns that final cid or startCid if no next. */
function followNextChainToTail(nodes, startCid) {
  if (!nodes || !startCid) return startCid;
  let cid = String(startCid).trim();
  const seen = new Set();
  while (nodes[cid] && nodes[cid].next) {
    const nextCid = String(nodes[cid].next).trim();
    if (!nextCid || seen.has(nextCid)) break;
    seen.add(cid);
    cid = nextCid;
  }
  return cid;
}

/** From graph data, determine if an upgrade is available for installed cid. Returns { upgradeAvailable, latestCid?, reason }.
 *  Supports: (1) nodes/current_cid/next chain (latest = final node after following all nexts), (2) latest_cid or latest, (3) versions[]. */
function interpretGraphForUpgrade(graphData, installedCid) {
  if (!graphData || !installedCid) return { upgradeAvailable: false, latestCid: null, reason: 'no data' };

  const nodes = graphData.nodes && typeof graphData.nodes === 'object' ? graphData.nodes : null;
  const currentCid = graphData.current_cid && String(graphData.current_cid).trim();
  if (nodes && currentCid && nodes[currentCid]) {
    const latestCid = followNextChainToTail(nodes, currentCid);
    if (latestCid && latestCid !== installedCid) {
      return { upgradeAvailable: true, latestCid, reason: `Newer version: ${latestCid}` };
    }
    return { upgradeAvailable: false, latestCid: latestCid || currentCid, reason: 'Up to date' };
  }

  const latest = graphData.latest_cid ?? graphData.latest ?? (Array.isArray(graphData.versions) && graphData.versions.length > 0 ? graphData.versions[graphData.versions.length - 1] : null);
  const latestCid = typeof latest === 'string' ? latest.trim() : (latest && latest.cid ? latest.cid : null);
  if (latestCid && latestCid !== installedCid) {
    return { upgradeAvailable: true, latestCid, reason: `Newer version: ${latestCid}` };
  }
  if (latestCid && latestCid === installedCid) {
    return { upgradeAvailable: false, latestCid, reason: 'Up to date' };
  }
  return { upgradeAvailable: false, latestCid: null, reason: 'Unknown (no version info in graph)' };
}

/** True if both paths resolve to the same directory (case-sensitive; CIDs in paths are case-sensitive). */
function sameResolvedDir(dirA, dirB) {
  if (!dirA || !dirB) return false;
  return path.resolve(dirA) === path.resolve(dirB);
}

async function runCliUpdate(cliArgs, blocklist) {
  const settings = await loadSettings();
  const globalFolder = (settings.skillsFolder || process.env.DSOUL_SKILLS_FOLDER || '').trim();
  const folderName = (settings.skillsFolderName != null && String(settings.skillsFolderName).trim() !== '') ? String(settings.skillsFolderName).trim() : 'Skills';
  const localFolder = path.join(process.cwd(), folderName);

  const folders = [];
  if (cliArgs.globalOnly && globalFolder) folders.push({ dir: globalFolder, label: 'global' });
  else if (cliArgs.localOnly) folders.push({ dir: localFolder, label: 'local' });
  else {
    if (globalFolder) folders.push({ dir: globalFolder, label: 'global' });
    if (!globalFolder || !sameResolvedDir(globalFolder, localFolder)) {
      folders.push({ dir: localFolder, label: 'local' });
    }
  }

  let hadSkills = false;
  let hadError = false;
  for (const { dir, label } of folders) {
    let data;
    try {
      data = await readDsoulJson(dir);
    } catch (e) {
      console.error(`Failed to read ${label} dsoul.json (${dir}):`, e.message || e);
      hadError = true;
      continue;
    }
    const skills = Array.isArray(data.skills) ? data.skills : [];
    if (skills.length === 0) continue;
    hadSkills = true;
    console.log(`\n--- ${label} (${dir}) ---`);
    for (const skill of skills) {
      const cid = skill.cid || '';
      const name = skill.shortname || cid || '?';
      const postIdOrLink = skill.num != null ? skill.num : (skill.src && String(skill.src).trim()) || (skill.post_id != null ? skill.post_id : (skill.post_link && String(skill.post_link).trim()) || null);
      if (postIdOrLink == null) {
        console.log(`${name}: no num or src (reinstall to record for update check)`);
        continue;
      }
      const result = await fetchUpgradeGraph(postIdOrLink);
      if (!result.success) {
        console.log(`${name}: ${result.error}`);
        hadError = true;
        continue;
      }
      const { upgradeAvailable, latestCid, reason } = interpretGraphForUpgrade(result.data, cid);
      if (upgradeAvailable) {
        console.log(`${name}: upgrade available > ${latestCid}`);
      } else {
        console.log(`${name}: ${reason}`);
      }
    }
  }
  if (!hadSkills) {
    console.log('No installed skills found in global or local dsoul.json.');
  }

  // If any installed CIDs are blocked, ask whether to delete all blocked items (or use --delete-blocked / --no-delete-blocked)
  if (blocklist && blocklist.size > 0) {
    const installed = await getAllInstalledCids();
    const blocked = installed.filter((i) => blocklist.has(i.cid));
    if (blocked.length > 0) {
      let yes = false;
      if (cliArgs.deleteBlocked === true) {
        yes = true;
      } else if (cliArgs.deleteBlocked === false) {
        yes = false;
      } else {
        const answer = await askLine('Delete all blocked items? [y/N]: ');
        yes = /^y(es)?$/i.test(answer.trim());
      }
      if (yes) {
        const uniqueCids = [...new Set(blocked.map((b) => b.cid))];
        for (const cid of uniqueCids) {
          const dirs = blocked.filter((b) => b.cid === cid).map((b) => b.dir);
          for (const dir of dirs) {
            try {
              await updateDsoulJson(dir, 'remove', { cid });
            } catch (e) {
              console.error(`  Failed to remove ${cid} from dsoul.json:`, e.message || e);
              hadError = true;
            }
          }
          const deactivateResult = await doDeactivateFile(cid);
          if (!deactivateResult.success) {
            console.warn(`  Deactivate ${cid}:`, deactivateResult.error);
          }
          const deleteResult = await doDeleteFile(cid);
          if (!deleteResult.success) {
            console.error(`  Delete ${cid}:`, deleteResult.error);
            hadError = true;
          } else {
            console.log(`  Removed blocked: ${cid}`);
          }
        }
      }
    }
  }

  return !hadError;
}

async function runCliUpgrade(cliArgs, blocklist) {
  await ensureDataDir();
  const settings = await loadSettings();
  const globalFolder = (settings.skillsFolder || process.env.DSOUL_SKILLS_FOLDER || '').trim();
  const folderName = (settings.skillsFolderName != null && String(settings.skillsFolderName).trim() !== '') ? String(settings.skillsFolderName).trim() : 'Skills';
  const localFolder = path.join(process.cwd(), folderName);

  const folders = [];
  if (cliArgs.globalOnly && globalFolder) folders.push({ dir: globalFolder, label: 'global' });
  else if (cliArgs.localOnly) folders.push({ dir: localFolder, label: 'local' });
  else {
    if (globalFolder) folders.push({ dir: globalFolder, label: 'global' });
    if (!globalFolder || !sameResolvedDir(globalFolder, localFolder)) {
      folders.push({ dir: localFolder, label: 'local' });
    }
  }

  const toUpgrade = [];
  for (const { dir, label } of folders) {
    let data;
    try {
      data = await readDsoulJson(dir);
    } catch (e) {
      console.error(`Failed to read ${label} dsoul.json (${dir}):`, e.message || e);
      continue;
    }
    const skills = Array.isArray(data.skills) ? data.skills : [];
    for (const skill of skills) {
      const cid = skill.cid || '';
      const name = skill.shortname || cid || '?';
      const postIdOrLink = skill.num != null ? skill.num : (skill.src && String(skill.src).trim()) || (skill.post_id != null ? skill.post_id : (skill.post_link && String(skill.post_link).trim()) || null);
      if (postIdOrLink == null) continue;
      const result = await fetchUpgradeGraph(postIdOrLink);
      if (!result.success) continue;
      const { upgradeAvailable, latestCid } = interpretGraphForUpgrade(result.data, cid);
      if (upgradeAvailable && latestCid && (!blocklist || !blocklist.has(latestCid))) {
        toUpgrade.push({ currentCid: cid, latestCid, name, dir, label });
      }
    }
  }

  if (toUpgrade.length === 0) {
    console.log('No upgrades available.');
    return true;
  }

  let hadError = false;
  for (const { currentCid, latestCid, name, dir, label } of toUpgrade) {
    console.log(`\n--- ${label}: upgrading ${name} ${currentCid} > ${latestCid} ---`);
    try {
      await updateDsoulJson(dir, 'remove', { cid: currentCid });
    } catch (e) {
      console.error('  update dsoul.json remove:', e.message || e);
      hadError = true;
      continue;
    }
    const deactivateResult = await doDeactivateFile(currentCid);
    if (!deactivateResult.success) {
      console.warn('  deactivate (continuing):', deactivateResult.error);
    }
    const deleteResult = await doDeleteFile(currentCid);
    if (!deleteResult.success) {
      console.error('  delete failed:', deleteResult.error);
      hadError = true;
      continue;
    }
    const installOptions = { skillsFolder: dir, autoPickOldest: true };
    const ok = await runCliInstall(latestCid, installOptions, latestCid);
    if (!ok) hadError = true;
  }
  return !hadError;
}

async function runCliRegister() {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.error('Register failed: secure storage is not available on this system.');
      return false;
    }
    let username = (process.env.DSOUL_USER || '').trim();
    let applicationKey = (process.env.DSOUL_TOKEN || process.env.DSOUL_APPLICATION_KEY || '').trim();
    if (!username || !applicationKey) {
      if (!process.stdin.isTTY) {
        console.error('Register failed: no interactive terminal (Electron may not have stdin).');
        console.error('Set DSOUL_USER and DSOUL_TOKEN (or DSOUL_APPLICATION_KEY) and run again.');
        return false;
      }
      username = await askLine('WordPress username: ');
      if (!username) {
        console.error('Register failed: username is required.');
        return false;
      }
      applicationKey = await askLine('Application key: ');
      if (!applicationKey) {
        console.error('Register failed: application key is required.');
        return false;
      }
    }
    const result = await saveWpCredentials({ username, applicationKey });
    if (!result.success) {
      console.error('Register failed:', result.error);
      return false;
    }
    console.log('Credentials saved securely.');
    return true;
  } catch (err) {
    console.error('Register failed:', err.message || String(err));
    return false;
  }
}

async function runCliUnregister() {
  try {
    await clearWpCredentials();
    console.log('Credentials cleared.');
    return true;
  } catch (err) {
    console.error('Unregister failed:', err.message || String(err));
    return false;
  }
}

async function runCliHashCidv0(filePath) {
  try {
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    const buf = await fs.readFile(resolved);
    const cid = await Hash.of(buf, { cidVersion: 0 });
    console.log(cid);
    return true;
  } catch (err) {
    console.error('Hash failed:', err.message || String(err));
    return false;
  }
}

async function runCliBalance() {
  try {
    const credentials = await loadWpCredentials();
    if (!credentials) {
      console.error('Balance failed: no stored credentials. Run dsoul register first.');
      return false;
    }
    const base = await getDsoulProviderBase();
    const balanceUrl = base + '/balance';
    const authHeader = 'Basic ' + Buffer.from(credentials.username + ':' + credentials.applicationKey).toString('base64');
    const res = await fetch(balanceUrl, {
      method: 'GET',
      headers: { Authorization: authHeader }
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      console.error('Balance failed: invalid JSON response');
      return false;
    }
    if (!res.ok) {
      const msg = (data && data.message) || text || res.statusText;
      console.error('Balance failed:', res.status, msg);
      if (text && text.trim()) console.error('Server response:', text.trim());
      return false;
    }
    if (data && data.success) {
      const stamps = data.stamps != null ? data.stamps : (data.full_data && data.full_data.PMCREDIT);
      console.log('Stamps:', stamps);
      if (data.full_data) {
        console.log('Full data:', JSON.stringify(data.full_data, null, 2));
      }
      return true;
    }
    console.error('Balance failed: unexpected response', data);
    return false;
  } catch (err) {
    console.error('Balance failed:', err.message || String(err));
    return false;
  }
}

async function runCliFiles(opts) {
  try {
    const credentials = await loadWpCredentials();
    if (!credentials) {
      console.error('Files failed: no stored credentials. Run dsoul register first.');
      return false;
    }
    const base = await getDsoulProviderBase();
    const page = Math.max(1, parseInt(opts.page, 10) || 1);
    const perPage = Math.max(1, Math.min(500, parseInt(opts.per_page, 10) || 100));
    const filesUrl = `${base}/files?page=${encodeURIComponent(page)}&per_page=${encodeURIComponent(perPage)}`;
    const authHeader = 'Basic ' + Buffer.from(credentials.username + ':' + credentials.applicationKey).toString('base64');
    const res = await fetch(filesUrl, {
      method: 'GET',
      headers: { Authorization: authHeader }
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      console.error('Files failed: invalid JSON response');
      return false;
    }
    if (!res.ok) {
      const msg = (data && data.message) || text || res.statusText;
      console.error('Files failed:', res.status, msg);
      if (text && text.trim()) console.error('Server response:', text.trim());
      return false;
    }
    if (!data || !data.success) {
      console.error('Files failed: unexpected response', data);
      return false;
    }
    const files = Array.isArray(data.files) ? data.files : [];
    const total = data.total != null ? data.total : files.length;
    const pages = data.pages != null ? data.pages : 1;
    console.log(`Page ${page} of ${pages} (${data.count ?? files.length} shown, ${total} total)\n`);
    if (files.length === 0) {
      console.log('No files.');
      return true;
    }
    files.forEach((f) => {
      const title = f.title || f.cid || '(no title)';
      const cid = f.cid || '-';
      const date = f.date ? f.date.replace(/T.*/, '') : '-';
      const shortnames = Array.isArray(f.shortnames) && f.shortnames.length ? f.shortnames.join(', ') : '-';
      const tags = Array.isArray(f.tags) && f.tags.length ? f.tags.join(', ') : '-';
      const bundle = f.is_skill_bundle ? ' [bundle]' : '';
      console.log(`${title}${bundle}`);
      console.log(`  CID: ${cid}`);
      console.log(`  Date: ${date}  Shortnames: ${shortnames}`);
      console.log(`  Tags: ${tags}`);
      if (f.stats && typeof f.stats === 'object') {
        const s = f.stats;
        const v = s.views != null ? s.views : '-';
        const d = s.downloads != null ? s.downloads : '-';
        const fav = s.favorites != null ? s.favorites : '-';
        console.log(`  Stats: views ${v}, downloads ${d}, favorites ${fav}`);
      }
      if (f.url) console.log(`  URL: ${f.url}`);
      console.log('');
    });
    return true;
  } catch (err) {
    console.error('Files failed:', err.message || String(err));
    return false;
  }
}

/** Extensions sent as cl_file (multipart). .md sent as content+filename (urlencoded) so body reaches server on Windows/Electron. */
const FREEZE_FILE_UPLOAD_EXTS = ['.zip', '.js', '.css'];

/**
 * Returns true if the zip has a single folder at root (e.g. pkg-xxx/license.txt) instead of
 * files at root (license.txt, skill.md). Skill bundles must have license.txt and skill.md at root.
 */
function isZipMisconfigured(zipPath) {
  return new Promise((resolve) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        resolve(false);
        return;
      }
      const names = [];
      zipfile.on('entry', (entry) => {
        names.push(entry.fileName.replace(/\\/g, '/'));
        zipfile.readEntry();
      });
      zipfile.on('end', () => {
        zipfile.close();
        const topLevel = new Set();
        for (const n of names) {
          const idx = n.indexOf('/');
          if (idx === -1) topLevel.add(n);
          else topLevel.add(n.slice(0, idx));
        }
        const roots = [...topLevel];
        const singleRootDir = roots.length === 1 && names.some((n) => n.includes('/'));
        const allUnderOneDir = singleRootDir && names.every((n) => n.startsWith(roots[0] + '/') || n === roots[0] + '/');
        resolve(!!(singleRootDir && allUnderOneDir));
      });
      zipfile.readEntry();
    });
  });
}

async function runCliFreeze(opts) {
  try {
    const credentials = await loadWpCredentials();
    if (!credentials) {
      console.error('Freeze failed: no stored credentials. Run dsoul register first.');
      return false;
    }
    const filePath = path.resolve(process.cwd(), opts.file);
    const stat = await fs.stat(filePath).catch((e) => null);
    if (!stat || !stat.isFile()) {
      console.error('Freeze failed: file not found or not a file:', filePath);
      return false;
    }
    const filename = path.basename(filePath);
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.zip') {
      const misconfigured = await isZipMisconfigured(filePath);
      if (misconfigured) {
        console.error('Freeze failed: zip has a folder at root. skill.md and license.txt must be at the root of the zip.');
        console.error('Repackage with: dsoul package <folder>   (this puts the folder contents at the zip root).');
        return false;
      }
    }
    const base = await getDsoulProviderBase();
    const freezeUrl = base + '/freeze';
    const isFileUpload = FREEZE_FILE_UPLOAD_EXTS.includes(ext);
    const version = (opts.version && String(opts.version).trim()) || '1.0.0';
    const authHeader = 'Basic ' + Buffer.from(credentials.username + ':' + credentials.applicationKey).toString('base64');

    let res;
    if (isFileUpload) {
      const fileBuffer = await fs.readFile(filePath);
      const form = new FormData();
      form.append('cl_file', fileBuffer, { filename });
      form.append('filename', filename);
      form.append('version', version);
      if (opts.tags) form.append('tags', opts.tags);
      if (opts.shortname) form.append('shortname', opts.shortname.trim());
      if (opts.license_url) form.append('license_url', opts.license_url.trim());
      const formHeaders = form.getHeaders();
      const bodyBuffer = await new Promise((resolve, reject) => {
        const chunks = [];
        const collector = new Writable({
          write(chunk, enc, cb) {
            chunks.push(chunk);
            cb();
          }
        });
        collector.on('finish', () => resolve(Buffer.concat(chunks)));
        collector.on('error', reject);
        form.on('error', reject);
        form.pipe(collector);
      });
      res = await fetch(freezeUrl, {
        method: 'POST',
        headers: {
          ...formHeaders,
          Authorization: authHeader,
          'Content-Length': String(bodyBuffer.length)
        },
        body: bodyBuffer
      });
    } else {
      const content = await fs.readFile(filePath, 'utf-8');
      const params = new URLSearchParams();
      params.append('filename', filename);
      params.append('content', content);
      params.append('version', version);
      if (opts.tags) params.append('tags', opts.tags);
      if (opts.shortname) params.append('shortname', opts.shortname.trim());
      if (opts.license_url) params.append('license_url', opts.license_url.trim());
      res = await fetch(freezeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: authHeader
        },
        body: params.toString()
      });
    }
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      console.error('Freeze failed: invalid JSON response:', text.slice(0, 200));
      return false;
    }
    if (!res.ok) {
      const msg = (data && data.message) || data?.data?.message || text || res.statusText;
      console.error('Freeze failed:', res.status, msg);
      if (text && text.trim()) console.error('Server response:', text.trim());
      return false;
    }
    if (data && data.success && data.data) {
      console.log('CID:', data.data.cid);
      if (data.data.guid) console.log('URL:', data.data.guid);
      return true;
    }
    console.error('Freeze failed: unexpected response', data);
    return false;
  } catch (err) {
    console.error('Freeze failed:', err.message || String(err));
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
    const hostname = item.hostname != null && String(item.hostname).trim() ? String(item.hostname).trim() : null;
    const entry = {
      cid: item.cid,
      shortname: item.shortname ?? null,
      num: item.post_id != null ? item.post_id : null,
      src: item.post_link != null && String(item.post_link).trim() ? String(item.post_link).trim() : null,
      hostname: hostname
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
  if (cliArgs) {
    printCliDisclaimer();
    if (cliArgs.command === 'help') {
      console.log(getCliHelpText());
      process.exit(0);
      return;
    }
    if (cliArgs.command === 'version') {
      console.log(app.getVersion());
      process.exit(0);
      return;
    }
  }
  if (cliArgs && cliArgs.command === 'register') {
    const ok = await runCliRegister();
    process.exit(ok ? 0 : 1);
    return;
  }
  if (cliArgs && cliArgs.command === 'unregister') {
    const ok = await runCliUnregister();
    process.exit(ok ? 0 : 1);
    return;
  }
  // For all other CLI commands: load blocklist (refresh on 'update'), warn if any installed CIDs are blocked
  let blocklist = null;
  if (cliArgs && cliArgs.command !== 'help') {
    const forceRefresh = cliArgs.command === 'update';
    blocklist = await getBlocklist(forceRefresh);
    if (process.env.DSOUL_DEBUG) {
      const cids = [...blocklist];
      process.stderr.write(`Blocklist (${cids.length} CIDs): ${cids.join(', ') || '(none)'}\n`);
    }
    const installed = await getAllInstalledCids();
    const blocked = installed.filter((i) => blocklist.has(i.cid));
    if (blocked.length > 0) {
      printBlockedCidsWarning([...new Set(blocked.map((b) => b.cid))]);
    }
  }
  if (cliArgs && cliArgs.command === 'balance') {
    const ok = await runCliBalance();
    process.exit(ok ? 0 : 1);
    return;
  }
  if (cliArgs && cliArgs.command === 'files') {
    const ok = await runCliFiles(cliArgs);
    process.exit(ok ? 0 : 1);
    return;
  }
  if (cliArgs && cliArgs.command === 'config') {
    const settings = await loadSettings();
    const keyToSetting = { 'dsoul-provider': 'dsoulProviderUrl', 'skills-folder': 'skillsFolder', 'skills-folder-name': 'skillsFolderName' };
    const settingKey = keyToSetting[cliArgs.key];
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
    } catch (_) { }
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
    if (blocklist && blocklist.has(cid)) {
      console.error(`Cannot install: CID ${cid} is on the blocklist.`);
      process.exit(1);
      return;
    }
    const installBase = cliArgs.global ? null : (await loadSettings()).skillsFolderName || 'Skills';
    const installOptions = cliArgs.global ? {} : { skillsFolder: path.join(process.cwd(), installBase) };
    if (cliArgs.yes) installOptions.autoPickOldest = true;
    const ok = await runCliInstall(cid, installOptions, cliArgs.target);
    process.exit(ok ? 0 : 1);
    return;
  }
  if (cliArgs && cliArgs.command === 'init') {
    const ok = await runCliInit(cliArgs.directory);
    process.exit(ok ? 0 : 1);
    return;
  }
  if (cliArgs && cliArgs.command === 'package') {
    const ok = await runCliPackage(cliArgs.folder);
    process.exit(ok ? 0 : 1);
    return;
  }
  if (cliArgs && cliArgs.command === 'update') {
    const ok = await runCliUpdate(cliArgs, blocklist);
    process.exit(ok ? 0 : 1);
    return;
  }
  if (cliArgs && cliArgs.command === 'upgrade') {
    const ok = await runCliUpgrade(cliArgs, blocklist);
    process.exit(ok ? 0 : 1);
    return;
  }
  if (cliArgs && cliArgs.command === 'freeze') {
    const ok = await runCliFreeze(cliArgs);
    process.exit(ok ? 0 : 1);
    return;
  }
  if (cliArgs && cliArgs.command === 'hash' && cliArgs.subcommand === 'cidv0') {
    const ok = await runCliHashCidv0(cliArgs.file);
    process.exit(ok ? 0 : 1);
    return;
  }

  // User passed CLI args but they were invalid → print error and exit (do not open GUI)
  const hasCliArgs = app.isPackaged ? process.argv.length > 1 : process.argv.length > 2;
  if (hasCliArgs && !cliArgs) {
    printCliDisclaimer();
    console.error('Invalid command.');
    process.exit(1);
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
    } catch (_) { }
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
    settings.skillsFolderName = settings.skillsFolderName != null && String(settings.skillsFolderName).trim() !== '' ? String(settings.skillsFolderName).trim() : 'Skills';
    settings.dsoulProviderUrl = settings.dsoulProviderUrl ?? '';
    if (!Array.isArray(settings.ipfsGateways) || settings.ipfsGateways.length === 0) {
      settings.ipfsGateways = DEFAULT_IPFS_GATEWAYS.slice();
    }
    return settings;
  } catch (error) {
    return {
      skillsFolder: process.env.DSOUL_SKILLS_FOLDER || '',
      skillsFolderName: 'Skills',
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
              if (!resolved) { resolved = true; try { zipfile.close(); } catch (_) { } reject(e); }
            });
          });
          zipfile.on('end', () => {
            if (!resolved) { resolved = true; try { zipfile.close(); } catch (_) { } resolve(); }
          });
          zipfile.on('error', (e) => {
            if (e && (e.message === 'closed' || e.message === 'Closed')) return;
            if (!resolved) { resolved = true; try { zipfile.close(); } catch (_) { } reject(e); }
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
      const { postId, postLink } = resolvePostIdFromEntry(fileData.dsoulEntry);
      const hostname = await getProviderHostname();
      await updateDsoulJson(baseFolder, 'add', { cid, shortname: null, post_id: postId, post_link: postLink || null, hostname: hostname || null });
    } catch (_) { }

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
    await fs.unlink(tmpPath).catch(() => { });
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
    } catch (_) { }

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
