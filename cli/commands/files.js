const { loadWpCredentials } = require('../../lib/credentials');
const { getDsoulProviderBase } = require('../../lib/dsoul-api');

async function runCliFiles(opts, ui) {
  try {
    const credentials = await loadWpCredentials();
    if (!credentials) { ui.fail('No stored credentials. Run dsoul register first.'); return false; }

    const base = await getDsoulProviderBase();
    const page = Math.max(1, parseInt(opts.page, 10) || 1);
    const perPage = Math.max(1, Math.min(500, parseInt(opts.per_page, 10) || 100));
    const filesUrl = base + '/files?page=' + encodeURIComponent(page) + '&per_page=' + encodeURIComponent(perPage);

    ui.step('Fetching files', 'page ' + page);
    ui.detail('endpoint', ui.url(filesUrl));
    const authHeader = 'Basic ' + Buffer.from(credentials.username + ':' + credentials.applicationKey).toString('base64');
    const res = await fetch(filesUrl, { method: 'GET', headers: { Authorization: authHeader } });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { ui.fail('Invalid JSON response'); return false; }
    if (!res.ok) { ui.fail('HTTP ' + res.status + ': ' + ((data && data.message) || text)); return false; }
    if (!data || !data.success) { ui.fail('Unexpected response'); return false; }

    const files = Array.isArray(data.files) ? data.files : [];
    const total = data.total != null ? data.total : files.length;
    const pages = data.pages != null ? data.pages : 1;
    const c = ui.c || {};
    ui.info('Page ' + (c.bold || '') + page + (c.reset || '') + ' of ' + pages + ' (' + (data.count ?? files.length) + ' shown, ' + total + ' total)');

    if (files.length === 0) { ui.dim('No files.'); return true; }

    ui.raw('');
    files.forEach((f) => {
      const title = f.title || f.cid || '(no title)';
      const cidStr = f.cid || '-';
      const date = f.date ? f.date.replace(/T.*/, '') : '-';
      const shortnames = Array.isArray(f.shortnames) && f.shortnames.length ? f.shortnames.join(', ') : '';
      const tags = Array.isArray(f.tags) && f.tags.length ? f.tags.map(ui.tag).join(', ') : '';
      const bundle = f.is_skill_bundle ? ' ' + (ui.c && ui.c.yellow || '') + '[bundle]' + (ui.c && ui.c.reset || '') : '';
      ui.raw('  ' + (ui.c && ui.c.bold || '') + title + (ui.c && ui.c.reset || '') + bundle);
      ui.detail('CID', ui.cid(cidStr));
      const postId = f.id ?? f.ID ?? f.post_id;
      if (postId != null) ui.detail('Post ID', String(postId));
      ui.detail('Date', date);
      if (shortnames) ui.detail('Shortnames', shortnames);
      if (tags) ui.detail('Tags', tags);
      if (f.stats && typeof f.stats === 'object') {
        const s = f.stats;
        const c = ui.c || {};
        ui.detail('Stats', (c.green || '') + (s.views ?? 0) + ' views' + (c.reset || '') + ', ' + (c.cyan || '') + (s.downloads ?? 0) + ' downloads' + (c.reset || '') + ', ' + (c.magenta || '') + (s.favorites ?? 0) + ' favorites' + (c.reset || ''));
      }
      if (f.url) ui.detail('URL', ui.url(f.url));
      ui.raw('');
    });
    return true;
  } catch (err) { ui.fail('Files failed: ' + (err.message || String(err))); return false; }
}

module.exports = { runCliFiles };
