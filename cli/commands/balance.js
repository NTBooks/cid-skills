const { loadWpCredentials } = require('../../lib/credentials');
const { getDsoulProviderBase } = require('../../lib/dsoul-api');
const log = require('../log');

async function runCliBalance() {
  try {
    const credentials = await loadWpCredentials();
    if (!credentials) { log.fail('No stored credentials. Run dsoul register first.'); return false; }

    log.step('Checking balance', log.name(credentials.username));
    const base = await getDsoulProviderBase();
    const balanceUrl = base + '/balance';
    log.detail('endpoint', log.url(balanceUrl));
    const authHeader = 'Basic ' + Buffer.from(credentials.username + ':' + credentials.applicationKey).toString('base64');
    const res = await fetch(balanceUrl, { method: 'GET', headers: { Authorization: authHeader } });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { log.fail('Invalid JSON response'); return false; }
    if (!res.ok) {
      const msg = (data && data.message) || text || res.statusText;
      log.fail(`HTTP ${res.status}: ${msg}`);
      return false;
    }
    if (data && data.success) {
      const stamps = data.stamps != null ? data.stamps : (data.full_data && data.full_data.PMCREDIT);
      log.ok(`Stamps: ${log.c.bold}${log.c.brightCyan}${stamps}${log.c.reset}`);
      if (data.full_data) {
        Object.entries(data.full_data).forEach(([k, v]) => {
          log.detail(k, v);
        });
      }
      return true;
    }
    log.fail('Unexpected response');
    return false;
  } catch (err) { log.fail('Balance failed:', err.message || String(err)); return false; }
}

module.exports = { runCliBalance };
