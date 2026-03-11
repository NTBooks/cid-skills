const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const readline = require('readline');
const { loadSettings, readFileData, saveFileData, ensureDataDir, readDsoulJson, getDsoulJsonPath, updateDsoulJson } = require('../../lib/storage');
const { parseCID, parseSkillHeaderForCli, doActivateFile } = require('../../lib/skills');
const { resolveShortname, getDsoulUrlTemplate, recordFileMetric, resolvePostIdFromEntry, getPostLinkFromEntry, getEntryDateMs, pickEntryByPostIdOrLink, getProviderHostname, getDsoulProviderBase } = require('../../lib/dsoul-api');
const { getHostnameFromProviderBase, buildProviderBaseFromHostOrUrl } = require('../../lib/config');
const { fetchByCid, MAX_FILE_SIZE } = require('../../lib/ipfs');
const { calculateCid } = require('../../lib/hash');
const { getZipBundleInfo } = require('../../lib/zip');

function askLine(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => { rl.close(); resolve(answer != null ? String(answer).trim() : ''); });
  });
}

async function runCliInstallDirectIpfs(cid, options = {}, installRef, ui) {
  const t0 = Date.now();
  try {
    const settings = await loadSettings();
    const gateways = (Array.isArray(settings.ipfsGateways) && settings.ipfsGateways.length > 0 ? settings.ipfsGateways : ['https://ipfs.io/ipfs/', 'https://gateway.pinata.cloud/ipfs/', 'https://dweb.link/ipfs/', 'https://gateway.ipfs.io/ipfs/'])
      .map((u) => { const s = (u || '').trim(); return s.endsWith('/') ? s : s + '/'; });
    ui.step('Fetching from IPFS', gateways.length + ' gateways');
    let content = null;
    for (let i = 0; i < gateways.length; i++) {
      const gateway = gateways[i];
      ui.detail('trying', ui.url(gateway + cid));
      try {
        const response = await fetch(gateway + cid);
        if (!response.ok) { ui.dim(`  HTTP ${response.status}, skipping`); continue; }
        const cl = response.headers.get('Content-Length');
        if (cl && parseInt(cl, 10) > MAX_FILE_SIZE) { ui.dim('  too large, skipping'); continue; }
        const ab = await response.arrayBuffer();
        if (ab.byteLength > MAX_FILE_SIZE) { ui.dim('  too large, skipping'); continue; }
        content = ab;
        ui.ok(`Downloaded from gateway ${i + 1}/${gateways.length}`);
        break;
      } catch (_) { ui.dim('  failed, trying next'); }
    }
    if (!content) { ui.fail('Failed to download from all IPFS gateways'); return false; }
    const buf = Buffer.from(content);
    ui.step('Verifying integrity');
    const hashResult = await calculateCid(buf);
    if (hashResult !== cid) { ui.fail(`Hash mismatch: expected ${ui.cid(cid)}, got ${ui.cid(hashResult)}`); return false; }
    ui.ok('CID verified');

    const isZip = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4B;
    let isBundle = false;
    let skillMetadata = null;
    let zipRootFolderName = null;
    if (isZip) {
      ui.step('Processing skill bundle');
      const tmpPath = path.join(os.tmpdir(), `dsoul-install-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
      try {
        await fs.writeFile(tmpPath, buf);
        const info = await getZipBundleInfo(tmpPath);
        if (!info.hasSkillMd) { ui.fail('Zip does not contain Skill.MD'); return false; }
        isBundle = true;
        zipRootFolderName = info.singleRootFolderName || undefined;
        if (info.skillContent) skillMetadata = parseSkillHeaderForCli(info.skillContent);
        ui.ok('Bundle validated');
      } finally { await fs.unlink(tmpPath).catch(() => {}); }
    } else {
      skillMetadata = parseSkillHeaderForCli(buf.toString('utf-8'));
    }

    ui.step('Saving to local store');
    const existing = await readFileData(cid).catch(() => null);
    const fileData = {
      cid, content: isBundle ? undefined : buf.toString('utf-8'),
      is_skill_bundle: isBundle || undefined, zipRootFolderName: zipRootFolderName || undefined,
      tags: existing?.tags ?? [], active: false, skillMetadata: skillMetadata || null, dsoulEntry: null,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      activatedFolderName: existing?.activatedFolderName, activatedSkillsFolder: existing?.activatedSkillsFolder
    };
    const saveResult = await saveFileData(fileData, isBundle ? buf : undefined);
    if (!saveResult.success) { ui.fail('Save failed:', saveResult.error); return false; }

    const skillsFolder = options.skillsFolder != null ? options.skillsFolder : (settings.skillsFolder || process.env.DSOUL_SKILLS_FOLDER || '');
    if (!skillsFolder) { ui.fail('Skills folder not set. Use -g and set it in Options, or set DSOUL_SKILLS_FOLDER.'); return false; }
    if (options.skillsFolder != null) await fs.mkdir(skillsFolder, { recursive: true });

    ui.step('Activating skill');
    const activateOptions = options.skillsFolder != null ? { skillsFolderOverride: skillsFolder } : {};
    const shortnameRef = (installRef && installRef !== cid) ? installRef : null;
    if (shortnameRef) activateOptions.shortname = shortnameRef;
    const activateResult = await doActivateFile(cid, activateOptions);
    if (!activateResult.success) { ui.fail('Activate failed:', activateResult.error); return false; }

    try {
      const hostname = await getProviderHostname();
      await updateDsoulJson(skillsFolder, 'add', { cid, shortname: shortnameRef, post_id: null, post_link: null, hostname: hostname || null });
    } catch (_) { }

    const skillName = skillMetadata?.name || cid;
    ui.ok(`Installed ${ui.name(skillName)}`);
    ui.detail('cid', ui.cid(cid));
    if (isBundle) ui.detail('type', 'skill bundle');
    ui.timing('Done', Date.now() - t0);
    return true;
  } catch (err) { ui.fail('Install failed:', err.message || String(err)); return false; }
}

async function runCliInstall(cid, options = {}, installRef, ui) {
  const t0 = Date.now();
  try {
    ui.header('Installing ' + ui.cid(cid));
    ui.step('Resolving via DSOUL API');
    const template = await getDsoulUrlTemplate(options.providerBase);
    const url = template.replace(/\{CID\}/g, encodeURIComponent(cid));
    ui.detail('endpoint', ui.url(url));
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) { ui.fail(`DSOUL API error: HTTP ${res.status}: ${text || res.statusText}`); return false; }
    let data;
    try { data = JSON.parse(text); } catch (_) { ui.fail('Invalid JSON from DSOUL API'); return false; }
    const entries = Array.isArray(data) ? data : [];
    if (entries.length === 0) {
      ui.info('No DSOUL entries found, trying direct IPFS download');
      return await runCliInstallDirectIpfs(cid, options, installRef, ui);
    }
    ui.ok(`Found ${entries.length} DSOUL entr${entries.length === 1 ? 'y' : 'ies'}`);

    let entry;
    const disambiguated = pickEntryByPostIdOrLink(entries, options.postId, options.postLink);
    if (disambiguated) { entry = disambiguated; }
    else if (entries.length === 1) { entry = entries[0]; }
    else if (options.autoPickOldest) {
      const sorted = [...entries].sort((a, b) => getEntryDateMs(a) - getEntryDateMs(b));
      entry = sorted[0];
      ui.info(`Multiple entries — auto-selecting oldest: ${ui.name(entry.name || cid)}`);
    } else {
      const sorted = [...entries].sort((a, b) => getEntryDateMs(a) - getEntryDateMs(b));
      ui.header('Multiple entries for this CID');
      ui.raw('');
      sorted.forEach((e, i) => {
        const name = e.name || 'Unnamed';
        const author = e.author_name ? ' by ' + e.author_name : '';
        const dateRaw = e.date || e.date_gmt || e.modified || e.post_date;
        const dateStr = dateRaw ? new Date(dateRaw).toISOString().slice(0, 10) : '';
        const tags = Array.isArray(e.tags) && e.tags.length ? ' ' + e.tags.map(ui.tag).join(', ') : '';
        const link = e.download_url || e.wordpress_url || e.link ? ' — ' + ui.url(e.download_url || e.wordpress_url || e.link) : '';
        const c = ui.c || {};
        ui.raw('  ' + (c.bold || '') + (i + 1) + ')' + (c.reset || '') + ' ' + ui.name(name) + author + (dateStr ? ' ' + (c.gray || '') + '(' + dateStr + ')' + (c.reset || '') : '') + tags + link);
      });
      ui.raw('');
      const isTty = process.stdin.isTTY && process.stdout.isTTY;
      if (!isTty) { entry = sorted[0]; ui.info('Non-interactive; using oldest (1).'); }
      else {
        const c = ui.c || {};
        const answer = await askLine('  ' + (c.cyan || '') + '?' + (c.reset || '') + ' Enter number (1-' + sorted.length + '): ');
        const idx = parseInt(answer, 10);
        if (Number.isNaN(idx) || idx < 1 || idx > sorted.length) { ui.warn('Invalid choice. Using oldest (1).'); entry = sorted[0]; }
        else { entry = sorted[idx - 1]; }
      }
    }

    const { postId: metricsPostId } = resolvePostIdFromEntry(entry);
    if (metricsPostId) recordFileMetric(metricsPostId, 'view').catch(() => {});
    const isBundle = !!(entry.is_skill_bundle ?? entry.is_bundle);

    const settings = await loadSettings();
    const gateways = (Array.isArray(settings.ipfsGateways) && settings.ipfsGateways.length > 0 ? settings.ipfsGateways : ['https://ipfs.io/ipfs/', 'https://gateway.pinata.cloud/ipfs/', 'https://dweb.link/ipfs/', 'https://gateway.ipfs.io/ipfs/'])
      .map((u) => { const s = (u || '').trim(); return s.endsWith('/') ? s : s + '/'; });

    ui.step('Downloading from IPFS', `${gateways.length} gateways`);
    let content = null;
    for (let i = 0; i < gateways.length; i++) {
      const gateway = gateways[i];
      ui.detail('trying', ui.url(gateway + cid));
      try {
        const response = await fetch(gateway + cid);
        if (!response.ok) { ui.dim(`  HTTP ${response.status}, skipping`); continue; }
        const cl = response.headers.get('Content-Length');
        if (cl && parseInt(cl, 10) > MAX_FILE_SIZE) { ui.dim('  too large, skipping'); continue; }
        const ab = await response.arrayBuffer();
        if (ab.byteLength > MAX_FILE_SIZE) { ui.dim('  too large, skipping'); continue; }
        content = ab;
        ui.ok(`Downloaded ${(ab.byteLength / 1024).toFixed(1)} KB from gateway ${i + 1}/${gateways.length}`);
        break;
      } catch (_) { ui.dim('  failed, trying next'); }
    }
    if (!content) { ui.fail('Failed to download from all IPFS gateways'); return false; }

    const buf = Buffer.from(content);
    ui.step('Verifying integrity');
    const hashResult = await calculateCid(buf);
    if (hashResult !== cid) { ui.fail(`Hash mismatch: expected ${ui.cid(cid)}, got ${ui.cid(hashResult)}`); return false; }
    ui.ok('CID verified');

    const contentStr = buf.toString('utf-8');
    let skillMetadata = isBundle ? null : parseSkillHeaderForCli(contentStr);
    if (isBundle && !skillMetadata) {
      const tmpPath = path.join(os.tmpdir(), `dsoul-meta-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
      try {
        await fs.writeFile(tmpPath, buf);
        const info = await getZipBundleInfo(tmpPath);
        if (info.skillContent) skillMetadata = parseSkillHeaderForCli(info.skillContent);
      } catch (_) { } finally { await fs.unlink(tmpPath).catch(() => {}); }
    }

    ui.step('Saving to local store');
    const existing = await readFileData(cid).catch(() => null);
    const fileData = {
      cid, content: isBundle ? undefined : contentStr,
      is_skill_bundle: isBundle || undefined,
      tags: existing?.tags ?? [], active: false, skillMetadata: skillMetadata || null, dsoulEntry: entry,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      activatedFolderName: existing?.activatedFolderName, activatedSkillsFolder: existing?.activatedSkillsFolder
    };
    const saveResult = await saveFileData(fileData, isBundle ? buf : undefined);
    if (!saveResult.success) { ui.fail('Save failed:', saveResult.error); return false; }

    const skillsFolder = options.skillsFolder != null ? options.skillsFolder : (settings.skillsFolder || process.env.DSOUL_SKILLS_FOLDER || '');
    if (!skillsFolder) { ui.fail('Skills folder not set.'); return false; }
    if (options.skillsFolder != null) await fs.mkdir(skillsFolder, { recursive: true });

    ui.step('Activating skill');
    const activateOptions = options.skillsFolder != null ? { skillsFolderOverride: skillsFolder } : {};
    const shortnameRef = (installRef && installRef !== cid) ? installRef : null;
    if (shortnameRef) activateOptions.shortname = shortnameRef;
    const activateResult = await doActivateFile(cid, activateOptions);
    if (!activateResult.success) { ui.fail('Activate failed:', activateResult.error); return false; }

    const { postId, postLink } = resolvePostIdFromEntry(entry);
    if (postId) recordFileMetric(postId, 'download').catch(() => {});
    try {
      const hostname = options.providerBase ? getHostnameFromProviderBase(options.providerBase) : await getProviderHostname();
      await updateDsoulJson(skillsFolder, 'add', {
        cid, shortname: shortnameRef,
        post_id: postId, post_link: postLink || null, hostname: hostname || null
      });
    } catch (_) { }

    const skillName = skillMetadata?.name || entry.name || cid;
    ui.added(skillName);
    ui.detail('cid', ui.cid(cid));
    if (isBundle) ui.detail('type', 'skill bundle');
    if (entry.author_name) ui.detail('author', entry.author_name);
    ui.timing('Done', Date.now() - t0);
    return true;
  } catch (err) { ui.fail('Install failed:', err.message || String(err)); return false; }
}

async function runCliInstallFromList(skillsFolder, options = {}, ui) {
  const t0 = Date.now();
  const filepath = getDsoulJsonPath(skillsFolder);
  ui.header('Installing from dsoul.json');
  ui.detail('path', filepath);
  let data;
  try {
    const content = await fs.readFile(filepath, 'utf-8');
    data = JSON.parse(content);
  } catch (e) {
    if (e.code === 'ENOENT') { ui.fail(`dsoul.json not found at ${filepath}`); return false; }
    ui.fail(`Failed to read dsoul.json: ${e.message || String(e)}`); return false;
  }
  const skills = Array.isArray(data.skills) ? data.skills : [];
  if (skills.length === 0) { ui.info('No skills listed in dsoul.json.'); return true; }
  ui.info('Found ' + skills.length + ' skill' + (skills.length === 1 ? '' : 's') + ' in manifest');
  ui.raw('');

  let okCount = 0, failCount = 0;
  for (let idx = 0; idx < skills.length; idx++) {
    const skill = skills[idx];
    const cidStr = (skill.cid && String(skill.cid).trim()) ? String(skill.cid).trim() : null;
    const shortname = (skill.shortname && String(skill.shortname).trim()) ? String(skill.shortname).trim() : null;
    const postId = skill.num != null ? (Number(skill.num) || null) : (skill.post_id != null ? (Number(skill.post_id) || null) : null);
    const postLink = (skill.src && String(skill.src).trim()) ? String(skill.src).trim() : (skill.post_link && String(skill.post_link).trim()) ? String(skill.post_link).trim() : null;
    const hostOrUrl = (skill.hostname && String(skill.hostname).trim()) ? String(skill.hostname).trim() : (postLink ? postLink : null);
    const providerBase = hostOrUrl ? hostOrUrl : null;
    let resolvedCid = parseCID(cidStr);
    let installRef = shortname || cidStr;

    const label = shortname || cidStr || '?';
    ui.step(`[${idx + 1}/${skills.length}]`, ui.name(label));

    if (!resolvedCid && shortname) {
      ui.dim(`  resolving shortname...`);
      const resolved = await resolveShortname(shortname, providerBase);
      if (!resolved.success) { ui.fail(`Skip ${label}: ${resolved.error}`); failCount++; continue; }
      resolvedCid = resolved.cid;
    }
    if (!resolvedCid) { ui.fail(`Skip: no valid cid or shortname`); failCount++; continue; }
    if (options.blocklist && options.blocklist.has(resolvedCid)) { ui.warn(`Skip ${ui.cid(resolvedCid)}: blocklisted`); failCount++; continue; }
    const installOptions = { skillsFolder, providerBase: providerBase || undefined, postId: postId || undefined, postLink: postLink || undefined, autoPickOldest: options.autoPickOldest === true };
    const ok = await runCliInstall(resolvedCid, installOptions, installRef, ui);
    if (ok) okCount++; else failCount++;
  }
  ui.raw('');
  ui.summary({ added: okCount, failed: failCount || undefined });
  ui.timing('List install complete', Date.now() - t0);
  return failCount === 0;
}

module.exports = { runCliInstall, runCliInstallFromList, runCliInstallDirectIpfs };
