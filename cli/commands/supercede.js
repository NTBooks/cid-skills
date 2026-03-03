const { loadWpCredentials } = require('../../lib/credentials');
const { getDsoulProviderBase } = require('../../lib/dsoul-api');

async function runCliSupercede(opts, ui) {
  const t0 = Date.now();
  try {
    const credentials = await loadWpCredentials();
    if (!credentials) { ui.fail('No stored credentials. Run dsoul register first.'); return false; }

    const postId = opts.postId && String(opts.postId).trim();
    const supercedeCid = opts.supercedeCid && String(opts.supercedeCid).trim();

    if (!postId) { ui.fail('Missing post ID. Usage: dsoul supercede <post-id> <supercede-cid>'); return false; }
    if (!supercedeCid) { ui.fail('Missing supercede CID. Usage: dsoul supercede <post-id> <supercede-cid>'); return false; }

    const base = await getDsoulProviderBase();
    const url = `${base}/file/${encodeURIComponent(postId)}/supercede`;

    ui.header('Setting supercede on post ' + ui.name(postId));
    ui.detail('endpoint', ui.url(url));
    ui.detail('user', ui.name(credentials.username));
    ui.detail('supercede_cid', ui.cid(supercedeCid));

    ui.step('Updating supercede');
    const authHeader = 'Basic ' + Buffer.from(credentials.username + ':' + credentials.applicationKey).toString('base64');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ supercede_cid: supercedeCid })
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { ui.fail('Invalid JSON response: ' + text.slice(0, 200)); return false; }

    if (res.status === 403) { ui.fail('Permission denied: ' + ((data && data.message) || 'you do not own this file')); return false; }
    if (res.status === 404) { ui.fail('File not found: post ID ' + postId); return false; }
    if (!res.ok) { ui.fail('HTTP ' + res.status + ': ' + ((data && data.message) || text)); return false; }

    if (data && data.success) {
      ui.ok('Supercede updated');
      ui.timing('Done', Date.now() - t0);
      return true;
    }
    ui.fail('Unexpected response: ' + text.slice(0, 200));
    return false;
  } catch (err) { ui.fail('Supercede failed: ' + (err.message || String(err))); return false; }
}

module.exports = { runCliSupercede };
