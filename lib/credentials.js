const fs = require('fs').promises;
const path = require('path');
const { getCredentialsPath } = require('./config');

async function loadWpCredentials() {
  try {
    const content = await fs.readFile(getCredentialsPath(), 'utf-8');
    const data = JSON.parse(content);
    if (data && typeof data.username === 'string' && typeof data.applicationKey === 'string') {
      return { username: data.username.trim(), applicationKey: data.applicationKey };
    }
  } catch (_) {
    // file missing or invalid
  }
  return null;
}

async function saveWpCredentials(credentials) {
  try {
    const data = JSON.stringify({
      username: String(credentials.username || '').trim(),
      applicationKey: String(credentials.applicationKey || '').trim()
    }, null, 2);
    const credPath = getCredentialsPath();
    await fs.mkdir(path.dirname(credPath), { recursive: true });
    await fs.writeFile(credPath, data, { encoding: 'utf-8', mode: 0o600 });
    return { success: true };
  } catch (err) {
    return { success: false, error: err && (err.message || String(err)) };
  }
}

async function clearWpCredentials() {
  try {
    await fs.unlink(getCredentialsPath());
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

module.exports = { loadWpCredentials, saveWpCredentials, clearWpCredentials };
