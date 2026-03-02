const { loadDsoulProviderFromEnv, buildProviderBaseFromHostOrUrl, DSOUL_API_PATH } = require('./config');
const { loadSettings } = require('./storage');

const ENTRY_LINK_KEYS = ['wordpress_url', 'link', 'guid', 'download_url', 'url', 'permalink', 'view_url', 'page_url', 'skill_url'];

async function getDsoulProviderBase() {
  const settings = await loadSettings();
  const url = settings.dsoulProviderUrl && String(settings.dsoulProviderUrl).trim();
  const raw = url || await loadDsoulProviderFromEnv();
  let origin = (raw || '').trim().replace(/\/+$/, '');
  if (!origin) origin = 'https://dsoul.org';
  if (origin.endsWith(DSOUL_API_PATH)) return origin;
  return origin + DSOUL_API_PATH;
}

async function getProviderHostname() {
  try {
    const base = await getDsoulProviderBase();
    const u = new URL(base);
    return u.hostname || null;
  } catch (_) {
    return null;
  }
}

async function getDsoulUrlTemplate(providerBaseOverride) {
  const base = providerBaseOverride != null && String(providerBaseOverride).trim()
    ? buildProviderBaseFromHostOrUrl(providerBaseOverride) || await getDsoulProviderBase()
    : await getDsoulProviderBase();
  return `${base}/search_by_cid?cid={CID}`;
}

async function resolveShortname(shortname, providerBaseOverride) {
  const base = providerBaseOverride != null && String(providerBaseOverride).trim()
    ? (buildProviderBaseFromHostOrUrl(providerBaseOverride) || await getDsoulProviderBase())
    : await getDsoulProviderBase();
  const url = `${base}/resolve_shortname?shortname=${encodeURIComponent(shortname)}`;
  console.error('Calling DSoul API:', url);
  try {
    const res = await fetch(url);
    const text = await res.text();
    if (res.status === 404) return { success: false, error: `Shortname not found: ${shortname}` };
    if (res.status === 400) return { success: false, error: text || 'Bad request (missing shortname)' };
    if (!res.ok) return { success: false, error: `HTTP ${res.status}: ${text || res.statusText}` };
    let data;
    try { data = JSON.parse(text); } catch (_) { return { success: false, error: 'Invalid JSON from shortname resolution' }; }
    const cid = data && data.cid;
    if (!cid || typeof cid !== 'string') return { success: false, error: 'Response missing cid' };
    return { success: true, cid: cid.trim(), data };
  } catch (err) {
    return { success: false, error: err && (err.message || String(err)) };
  }
}

async function fetchDsoulByCid(cid) {
  try {
    const template = await getDsoulUrlTemplate();
    const url = template.replace(/\{CID\}/g, encodeURIComponent(cid));
    console.error('Calling DSoul API:', url);
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) return { success: false, error: `HTTP ${res.status}: ${text || res.statusText}` };
    let data;
    try { data = JSON.parse(text); } catch (_) { return { success: false, error: `Invalid JSON: ${text.slice(0, 200)}` }; }
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error && (error.message || String(error)) };
  }
}

async function recordFileMetric(fileId, type) {
  if (fileId == null || !['view', 'download', 'favorite'].includes(type)) return;
  const { loadWpCredentials } = require('./credentials');
  const credentials = await loadWpCredentials();
  if (!credentials) return;
  try {
    const base = await getDsoulProviderBase();
    const url = `${base}/file/${encodeURIComponent(String(fileId))}/metrics`;
    const authHeader = 'Basic ' + Buffer.from(credentials.username + ':' + credentials.applicationKey).toString('base64');
    const body = new URLSearchParams({ type }).toString();
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
  } catch (_) {
    // best-effort
  }
}

async function fetchUpgradeGraph(postIdOrLink) {
  if (postIdOrLink == null || String(postIdOrLink).trim() === '') return { success: false, error: 'Missing post_id or post_link' };
  const base = await getDsoulProviderBase();
  const url = `${base}/file/${encodeURIComponent(String(postIdOrLink))}/graph`;
  try {
    console.error('Calling DSoul API:', url);
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) return { success: false, error: `HTTP ${res.status}: ${text || res.statusText}` };
    let data;
    try { data = JSON.parse(text); } catch (_) { return { success: false, error: 'Invalid JSON from graph API' }; }
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err && (err.message || String(err)) };
  }
}

function getPostLinkFromEntry(entry) {
  if (!entry) return null;
  for (const key of ENTRY_LINK_KEYS) {
    const v = entry[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

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

function getEntryDateMs(entry) {
  const raw = entry?.date || entry?.date_gmt || entry?.modified || entry?.post_date;
  if (raw == null || raw === '') return 0;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function pickEntryByPostIdOrLink(entries, postId, postLink) {
  if (!entries || entries.length === 0) return undefined;
  if (entries.length === 1) return entries[0];
  const wantId = postId != null && Number.isInteger(postId) ? postId : null;
  const wantLink = (postLink != null && String(postLink).trim()) ? String(postLink).trim() : null;
  for (const e of entries) {
    if (wantId != null) {
      const { postId: entryId } = resolvePostIdFromEntry(e);
      if (entryId === wantId) return e;
    }
    if (wantLink) {
      const link = getPostLinkFromEntry(e);
      if (link && (link === wantLink || link.replace(/\/+$/, '') === wantLink.replace(/\/+$/, ''))) return e;
    }
  }
  return undefined;
}

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

function interpretGraphForUpgrade(graphData, installedCid) {
  if (!graphData || !installedCid) return { upgradeAvailable: false, latestCid: null, reason: 'no data' };
  const nodes = graphData.nodes && typeof graphData.nodes === 'object' ? graphData.nodes : null;
  const currentCid = graphData.current_cid && String(graphData.current_cid).trim();
  if (nodes && currentCid && nodes[currentCid]) {
    const latestCid = followNextChainToTail(nodes, currentCid);
    if (latestCid && latestCid !== installedCid) return { upgradeAvailable: true, latestCid, reason: `Newer version: ${latestCid}` };
    return { upgradeAvailable: false, latestCid: latestCid || currentCid, reason: 'Up to date' };
  }
  const latest = graphData.latest_cid ?? graphData.latest ?? (Array.isArray(graphData.versions) && graphData.versions.length > 0 ? graphData.versions[graphData.versions.length - 1] : null);
  const latestCid = typeof latest === 'string' ? latest.trim() : (latest && latest.cid ? latest.cid : null);
  if (latestCid && latestCid !== installedCid) return { upgradeAvailable: true, latestCid, reason: `Newer version: ${latestCid}` };
  if (latestCid && latestCid === installedCid) return { upgradeAvailable: false, latestCid, reason: 'Up to date' };
  return { upgradeAvailable: false, latestCid: null, reason: 'Unknown (no version info in graph)' };
}

module.exports = {
  ENTRY_LINK_KEYS,
  getDsoulProviderBase,
  getProviderHostname,
  getDsoulUrlTemplate,
  resolveShortname,
  fetchDsoulByCid,
  recordFileMetric,
  fetchUpgradeGraph,
  getPostLinkFromEntry,
  resolvePostIdFromEntry,
  getEntryDateMs,
  pickEntryByPostIdOrLink,
  followNextChainToTail,
  interpretGraphForUpgrade
};
