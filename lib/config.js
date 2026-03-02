const path = require('path');
const fs = require('fs').promises;
const os = require('os');

const defaultDsoulProviderOrigin = 'https://dsoul.org';
const DSOUL_API_PATH = '/wp-json/diamond-soul/v1';

function getDataDir() {
  return path.join(os.homedir(), '.dsoul');
}

function getFilesDir() {
  return path.join(getDataDir(), 'ipfs-files');
}

function getSettingsPath() {
  return path.join(getDataDir(), 'settings.json');
}

function getCredentialsPath() {
  return path.join(getDataDir(), 'credentials.json');
}

function getBlocklistCachePath() {
  return path.join(getDataDir(), 'blocklist.json');
}

function getVersion() {
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  return pkg.version;
}

async function loadDotEnv() {
  const envPaths = [
    path.join(getDataDir(), '.env'),
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '..', '.env')
  ];
  const result = {};
  for (const envPath of envPaths) {
    try {
      const content = await fs.readFile(envPath, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
        if (m) {
          const key = m[1];
          const val = m[2].replace(/^["']|["']$/g, '').trim();
          if (val && !result[key]) result[key] = val;
        }
      }
      break;
    } catch (_) {
      // file missing or unreadable, try next
    }
  }
  return result;
}

async function loadDsoulProviderFromEnv() {
  const env = await loadDotEnv();
  return env.DSOUL || defaultDsoulProviderOrigin;
}

function buildProviderBaseFromHostOrUrl(hostOrUrl) {
  const s = (hostOrUrl || '').trim();
  if (!s) return null;
  let origin;
  if (s.startsWith('http://') || s.startsWith('https://')) {
    try {
      const u = new URL(s);
      origin = u.origin;
    } catch (_) {
      origin = 'https://' + s.replace(/^\/+|\/+$/g, '');
    }
  } else {
    origin = 'https://' + s.replace(/^\/+|\/+$/g, '');
  }
  if (origin.endsWith(DSOUL_API_PATH)) return origin;
  return origin + DSOUL_API_PATH;
}

function getHostnameFromProviderBase(providerBase) {
  if (providerBase == null || !String(providerBase).trim()) return null;
  const base = buildProviderBaseFromHostOrUrl(providerBase);
  if (!base) return null;
  try {
    const u = new URL(base);
    return u.hostname || null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  defaultDsoulProviderOrigin,
  DSOUL_API_PATH,
  getDataDir,
  getFilesDir,
  getSettingsPath,
  getCredentialsPath,
  getBlocklistCachePath,
  getVersion,
  loadDotEnv,
  loadDsoulProviderFromEnv,
  buildProviderBaseFromHostOrUrl,
  getHostnameFromProviderBase
};
