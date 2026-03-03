const { loadWpCredentials } = require('../../lib/credentials');
const { getDsoulProviderBase } = require('../../lib/dsoul-api');

async function runCliBalance(ui) {
  try {
    const credentials = await loadWpCredentials();
    if (!credentials) { ui.fail('No stored credentials. Run dsoul register first.'); return false; }

    ui.step('Checking balance', ui.name(credentials.username));
    const base = await getDsoulProviderBase();
    const balanceUrl = base + '/balance';
    ui.detail('endpoint', ui.url(balanceUrl));
    const authHeader = 'Basic ' + Buffer.from(credentials.username + ':' + credentials.applicationKey).toString('base64');
    const res = await fetch(balanceUrl, { method: 'GET', headers: { Authorization: authHeader } });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { ui.fail('Invalid JSON response'); return false; }
    if (!res.ok) {
      const msg = (data && data.message) || text || res.statusText;
      ui.fail('HTTP ' + res.status + ': ' + msg);
      return false;
    }
    if (data && data.success) {
      const stamps = data.stamps != null ? data.stamps : (data.full_data && data.full_data.PMCREDIT);
      const c = ui.c || {};
      ui.ok('Stamps: ' + (c.bold || '') + (c.brightCyan || '') + stamps + (c.reset || ''));
      if (data.full_data) {
        Object.entries(data.full_data).forEach(([k, v]) => {
          ui.detail(k, v);
        });
      }
      return true;
    }
    ui.fail('Unexpected response');
    return false;
  } catch (err) { ui.fail('Balance failed: ' + (err.message || String(err))); return false; }
}

module.exports = { runCliBalance };
