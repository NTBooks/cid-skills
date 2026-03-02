const { loadWpCredentials } = require('../../lib/credentials');
const { getDsoulProviderBase } = require('../../lib/dsoul-api');
const log = require('../log');

async function runCliFiles(opts) {
  try {
    const credentials = await loadWpCredentials();
    if (!credentials) { log.fail('No stored credentials. Run dsoul register first.'); return false; }

    const base = await getDsoulProviderBase();
    const page = Math.max(1, parseInt(opts.page, 10) || 1);
    const perPage = Math.max(1, Math.min(500, parseInt(opts.per_page, 10) || 100));
    const filesUrl = `${base}/files?page=${encodeURIComponent(page)}&per_page=${encodeURIComponent(perPage)}`;

    log.step('Fetching files', `page ${page}`);
    log.detail('endpoint', log.url(filesUrl));
    const authHeader = 'Basic ' + Buffer.from(credentials.username + ':' + credentials.applicationKey).toString('base64');
    const res = await fetch(filesUrl, { method: 'GET', headers: { Authorization: authHeader } });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { log.fail('Invalid JSON response'); return false; }
    if (!res.ok) { log.fail(`HTTP ${res.status}: ${(data && data.message) || text}`); return false; }
    if (!data || !data.success) { log.fail('Unexpected response'); return false; }

    const files = Array.isArray(data.files) ? data.files : [];
    const total = data.total != null ? data.total : files.length;
    const pages = data.pages != null ? data.pages : 1;
    log.info(`Page ${log.c.bold}${page}${log.c.reset} of ${pages} (${data.count ?? files.length} shown, ${total} total)`);

    if (files.length === 0) { log.dim('No files.'); return true; }

    console.log('');
    files.forEach((f) => {
      const title = f.title || f.cid || '(no title)';
      const cidStr = f.cid || '-';
      const date = f.date ? f.date.replace(/T.*/, '') : '-';
      const shortnames = Array.isArray(f.shortnames) && f.shortnames.length ? f.shortnames.join(', ') : '';
      const tags = Array.isArray(f.tags) && f.tags.length ? f.tags.map(log.tag).join(', ') : '';
      const bundle = f.is_skill_bundle ? ` ${log.c.yellow}[bundle]${log.c.reset}` : '';

      console.log(`  ${log.c.bold}${title}${log.c.reset}${bundle}`);
      log.detail('CID', log.cid(cidStr));
      log.detail('Date', date);
      if (shortnames) log.detail('Shortnames', shortnames);
      if (tags) log.detail('Tags', tags);
      if (f.stats && typeof f.stats === 'object') {
        const s = f.stats;
        log.detail('Stats', `${log.c.green}${s.views ?? 0} views${log.c.reset}, ${log.c.cyan}${s.downloads ?? 0} downloads${log.c.reset}, ${log.c.magenta}${s.favorites ?? 0} favorites${log.c.reset}`);
      }
      if (f.url) log.detail('URL', log.url(f.url));
      console.log('');
    });
    return true;
  } catch (err) { log.fail('Files failed:', err.message || String(err)); return false; }
}

module.exports = { runCliFiles };
