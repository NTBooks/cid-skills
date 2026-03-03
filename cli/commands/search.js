const { getDsoulProviderBase } = require('../../lib/dsoul-api');
const { DSOUL_API_PATH } = require('../../lib/config');

async function getProviderOrigin() {
  const base = await getDsoulProviderBase();
  return base.endsWith(DSOUL_API_PATH) ? base.slice(0, -DSOUL_API_PATH.length) : base;
}

function buildSearchUrl(origin, query, page) {
  const params = new URLSearchParams({ ds_mode: 'json' });
  if (query) params.set('s', query);
  if (page && page > 1) params.set('paged', String(page));
  return origin + '/?' + params.toString();
}

function isHomepageResponse(data) {
  return data && (data.site != null || data.recent_files != null || data.endpoints != null);
}

function isListEntry(entry) {
  return entry && typeof entry.item_count !== 'undefined';
}

function isFileEntry(entry) {
  return entry && typeof entry.cid !== 'undefined';
}

function truncate(str, max) {
  if (!str) return '';
  const s = String(str).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatFileEntry(entry, ui, rank) {
  const c = ui.c || {};
  const title = entry.title || '(untitled)';
  const bundle = entry.is_bundle ? '  ' + c.yellow + '[bundle]' + c.reset : '';
  const prefix = rank != null ? rankColor(rank, c) + '  ' : '  ';

  ui.raw(prefix + c.bold + title + c.reset + bundle);
  if (entry.shortname) ui.raw('     ' + c.cyan + entry.shortname + c.reset);

  const author = entry.author && entry.author.name ? c.cyan + entry.author.name + c.reset : '';
  const date = entry.date ? c.gray + String(entry.date).slice(0, 10) + c.reset : '';
  const meta = [author, date].filter(Boolean).join(c.gray + '  ·  ' + c.reset);
  if (meta) ui.raw('     ' + meta);

  if (Array.isArray(entry.tags) && entry.tags.length) {
    ui.raw('     ' + entry.tags.map((t) => c.magenta + t + c.reset).join(c.gray + ' · ' + c.reset));
  }
  if (entry.cid) ui.raw('     ' + c.dim + entry.cid + c.reset);
  if (entry.summary) ui.raw('     ' + c.dim + truncate(entry.summary, 120) + c.reset);
  if (entry.gateway_url) {
    ui.raw('     ' + c.green + '↓' + c.reset + ' ' + c.cyan + c.underline + entry.gateway_url + c.reset);
  } else if (entry.permalink) {
    ui.raw('     ' + c.gray + '→' + c.reset + ' ' + c.dim + entry.permalink + c.reset);
  }
  if (entry.cid) {
    const installTarget = entry.shortname || entry.cid;
    ui.raw('     ' + c.dim + 'dsoul install ' + installTarget + c.reset);
  }
}

function formatListEntry(entry, ui, rank) {
  const c = ui.c || {};
  const title = entry.title || '(untitled)';
  const prefix = rank != null ? rankColor(rank, c) + '  ' : '  ';
  const ownerRaw = entry.owner
    ? (typeof entry.owner === 'string' ? entry.owner : (entry.owner.name || ''))
    : '';

  ui.raw(prefix + c.bold + title + c.reset + '  ' + c.magenta + '[list]' + c.reset);
  if (ownerRaw) ui.raw('     ' + c.cyan + ownerRaw + c.reset);
  if (entry.item_count != null) ui.raw('     ' + c.gray + entry.item_count + ' items' + c.reset);
  if (entry.summary) ui.raw('     ' + c.dim + truncate(entry.summary, 120) + c.reset);
  if (entry.permalink) ui.raw('     ' + c.gray + '→' + c.reset + ' ' + c.dim + entry.permalink + c.reset);
}

function rankColor(n, c) {
  if (n === 1) return c.bold + c.brightYellow + '1' + c.reset;
  if (n === 2) return c.bold + c.white + '2' + c.reset;
  if (n === 3) return c.bold + c.yellow + '3' + c.reset;
  return c.gray + String(n) + c.reset;
}

function formatHomepage(data, ui) {
  const c = ui.c || {};
  const DIV = c.gray + '─'.repeat(62) + c.reset;
  const D = c.cyan + '◆' + c.reset;

  // ── Header ──────────────────────────────────────────────────
  const site = data.site || {};
  const siteName = (site.name || 'Diamond Soul').toUpperCase();
  const siteDesc = site.description || '';
  const siteUrl = (site.url || '').replace(/\/+$/, '');

  ui.raw('');
  ui.raw(DIV);
  ui.raw('  ' + D + '  ' + c.bold + c.brightCyan + siteName + c.reset +
    (siteDesc ? '  ' + c.dim + '· ' + siteDesc + c.reset : ''));
  if (siteUrl) ui.raw('     ' + c.dim + siteUrl + c.reset);

  // ── Stats ────────────────────────────────────────────────────
  const stats = data.stats || {};
  const statParts = [];
  if (stats.total_files != null) {
    statParts.push(c.bold + c.brightCyan + stats.total_files + c.reset + c.cyan + ' files' + c.reset);
  }
  if (stats.total_lists != null) {
    statParts.push(c.bold + c.magenta + stats.total_lists + c.reset + c.magenta + ' lists' + c.reset);
  }
  if (statParts.length) {
    ui.raw('  ' + statParts.join('  ' + c.gray + '·' + c.reset + '  '));
  }
  ui.raw(DIV);

  // ── Recent Files ─────────────────────────────────────────────
  const recentFiles = Array.isArray(data.recent_files)
    ? data.recent_files.filter((f) => !(f.is_bad || f.is_deactivated))
    : [];
  if (recentFiles.length) {
    ui.raw('');
    ui.raw('  ' + c.bold + c.brightCyan + '◆ RECENT FILES' + c.reset);
    ui.raw('');
    recentFiles.forEach((f, i) => {
      const title = f.title || '(untitled)';
      const bundle = f.is_bundle ? '  ' + c.yellow + '[bundle]' + c.reset : '';
      const author = f.author && f.author.name ? f.author.name : '';
      const date = f.date ? String(f.date).slice(0, 10) : '';
      const meta = [author && c.cyan + author + c.reset, date && c.gray + date + c.reset]
        .filter(Boolean).join(c.gray + '  ·  ' + c.reset);

      ui.raw('  ' + rankColor(i + 1, c) + '  ' + c.bold + title + c.reset + bundle);
      if (f.shortname) ui.raw('     ' + c.cyan + f.shortname + c.reset);
      if (meta) ui.raw('     ' + meta);
      if (Array.isArray(f.tags) && f.tags.length) {
        ui.raw('     ' + f.tags.map((t) => c.magenta + t + c.reset).join(c.gray + ' · ' + c.reset));
      }
      if (f.summary) {
        ui.raw('     ' + c.dim + truncate(f.summary, 100) + c.reset);
      }
      if (f.gateway_url) {
        ui.raw('     ' + c.green + '↓' + c.reset + ' ' + c.cyan + c.underline + f.gateway_url + c.reset);
      } else if (f.permalink) {
        ui.raw('     ' + c.gray + '→' + c.reset + ' ' + c.dim + f.permalink + c.reset);
      }
      ui.raw('');
    });
  }

  // ── Top Charts (3-column) ────────────────────────────────────
  const topFiles = data.top_files || {};
  const topSections = [
    { key: 'views',     label: '▲ VIEWS'     },
    { key: 'hearts',    label: '♥ HEARTS'    },
    { key: 'downloads', label: '↓ DOWNLOADS' },
  ];
  const topLists = topSections.map((s) => ({
    label: s.label,
    items: (Array.isArray(topFiles[s.key])
      ? topFiles[s.key].filter((f) => !(f.is_bad || f.is_deactivated))
      : []).slice(0, 5),
  }));
  const hasTop = topLists.some((t) => t.items.length > 0);

  if (hasTop) {
    ui.raw(DIV);
    ui.raw('  ' + c.bold + c.brightCyan + '◆ TOP CHARTS' + c.reset);
    ui.raw('');

    const COL = 20;       // visible chars per column cell
    const SEP = '   ';    // 3-space column separator

    // Header
    ui.raw('  ' + topLists.map((t) => c.bold + c.cyan + t.label.padEnd(COL) + c.reset).join(SEP));
    ui.raw('  ' + topLists.map(() => c.gray + '─'.repeat(COL) + c.reset).join(SEP));

    const maxRows = Math.max(...topLists.map((t) => t.items.length));
    for (let row = 0; row < maxRows; row++) {
      const cells = topLists.map(({ items }) => {
        if (row >= items.length) return ' '.repeat(COL);
        const item = items[row];
        const title = truncate(item.title || '(untitled)', COL - 3).padEnd(COL - 3);
        // rank = 1 visible char, '  ' = 2 visible chars, title = COL-3 visible chars → COL total
        return rankColor(row + 1, c) + '  ' + title;
      });
      ui.raw('  ' + cells.join(SEP));
    }
    ui.raw('');
  }

  // ── Recent Lists ─────────────────────────────────────────────
  const recentLists = Array.isArray(data.recent_lists) ? data.recent_lists : [];
  if (recentLists.length) {
    ui.raw(DIV);
    ui.raw('  ' + c.bold + c.brightCyan + '◆ RECENT LISTS' + c.reset);
    ui.raw('');
    recentLists.forEach((l) => {
      const title = l.title || '(untitled)';
      const ownerRaw = l.owner
        ? (typeof l.owner === 'string' ? l.owner : (l.owner.name || ''))
        : '';
      const owner = ownerRaw ? '  ' + c.gray + '(' + ownerRaw + ')' + c.reset : '';
      ui.raw('  ' + D + '  ' + c.bold + c.magenta + title + c.reset + owner);
      if (l.permalink) ui.raw('       ' + c.dim + l.permalink + c.reset);
    });
    ui.raw('');
  }

  // ── Footer ───────────────────────────────────────────────────
  ui.raw(DIV);
  ui.raw(
    '  ' + c.gray + 'dsoul search <query>' + c.reset +
    '  to search  ' + c.gray + '·' + c.reset + '  ' +
    c.gray + 'dsoul install <shortname>' + c.reset + '  to install'
  );
  ui.raw(DIV);
  ui.raw('');
}

async function runCliSearch(opts, ui) {
  try {
    const query = opts.query ? String(opts.query).trim() : '';
    const page = Math.max(1, parseInt(opts.page, 10) || 1);
    const limit = opts.limit != null ? Math.max(1, parseInt(opts.limit, 10) || 10) : null;
    const origin = await getProviderOrigin();
    const url = buildSearchUrl(origin, query, page);

    if (query) {
      ui.step('Searching', '"' + query + '"' + (page > 1 ? '  page ' + page : '') + (limit ? '  limit ' + limit : ''));
    } else {
      ui.step('Fetching homepage', origin);
    }
    ui.detail('endpoint', ui.url(url));

    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      ui.fail('Network error: ' + (err.message || String(err)));
      return false;
    }

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) {
      ui.fail('Invalid JSON response from ' + url);
      return false;
    }
    if (!res.ok) {
      ui.fail('HTTP ' + res.status + ': ' + ((data && data.message) || text.slice(0, 200)));
      return false;
    }

    // Homepage shape (no query sent)
    if (!query && isHomepageResponse(data)) {
      formatHomepage(data, ui);
      return true;
    }

    // Search results shape
    const c = ui.c || {};
    const DIV = c.gray + '─'.repeat(62) + c.reset;
    const allResults = Array.isArray(data.results) ? data.results : [];
    const totalFound = data.total_found != null ? data.total_found : allResults.length;
    const totalPages = data.total_pages != null ? data.total_pages : 1;

    const visible = allResults.filter((r) => !(r.is_bad || r.is_deactivated));
    const skipped = allResults.length - visible.length;
    const shown = limit != null ? visible.slice(0, limit) : visible;

    ui.raw('');
    ui.raw(DIV);
    ui.raw(
      '  ' + c.cyan + '◆' + c.reset + '  ' +
      c.bold + c.brightCyan + 'SEARCH' + c.reset + '  ' +
      c.dim + '"' + query + '"' + c.reset +
      (totalFound > 0
        ? '  ' + c.bold + totalFound + c.reset + ' result' + (totalFound === 1 ? '' : 's') +
          '  ' + c.gray + 'page ' + page + ' of ' + totalPages + c.reset
        : '')
    );
    ui.raw(DIV);

    if (shown.length === 0) {
      ui.raw('');
      ui.raw('  ' + c.dim + (query ? 'No results found.' : 'No items found.') + c.reset);
      if (skipped > 0) ui.raw('  ' + c.gray + '(' + skipped + ' unavailable hidden)' + c.reset);
      ui.raw('');
      return true;
    }

    ui.raw('');
    shown.forEach((entry, i) => {
      const rank = i + 1;
      if (isListEntry(entry)) {
        formatListEntry(entry, ui, rank);
      } else if (isFileEntry(entry)) {
        formatFileEntry(entry, ui, rank);
      } else {
        ui.raw('  ' + rankColor(rank, c) + '  ' + c.bold + (entry.title || String(entry.id || i)) + c.reset);
        if (entry.permalink) ui.raw('     ' + c.dim + entry.permalink + c.reset);
      }
      ui.raw('');
    });

    ui.raw(DIV);
    const footerParts = [];
    if (skipped > 0) footerParts.push(c.gray + skipped + ' unavailable hidden' + c.reset);
    if (limit != null && visible.length > shown.length) {
      footerParts.push(c.gray + (visible.length - shown.length) + ' more (remove -n to see all)' + c.reset);
    }
    if (page < totalPages) {
      footerParts.push(c.gray + 'use --page=' + (page + 1) + ' for next page' + c.reset);
    }
    if (footerParts.length) ui.raw('  ' + footerParts.join('  ' + c.gray + '·' + c.reset + '  '));
    else ui.raw('  ' + c.dim + shown.length + ' of ' + totalFound + ' shown' + c.reset);
    ui.raw(DIV);
    ui.raw('');

    return true;
  } catch (err) {
    ui.fail('Search failed: ' + (err.message || String(err)));
    return false;
  }
}

module.exports = { runCliSearch };
