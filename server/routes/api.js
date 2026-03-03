const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const express = require('express');
const diff = require('diff');
const { getFilesDir } = require('../../lib/config');
const { ensureDataDir, loadSettings, saveSettings, readFileData, saveFileData, doDeleteFile, getAllFiles, updateFileTags } = require('../../lib/storage');
const { calculateCid } = require('../../lib/hash');
const { fetchDsoulByCid } = require('../../lib/dsoul-api');
const { doActivateFile, doDeactivateFile } = require('../../lib/skills');
const { fetchByCid } = require('../../lib/ipfs');
const { getZipBundleInfo, readEntryFromZip, readFirstEntryFromZipWhere, readAllZipFileEntries, listZipEntryNames, getZipSingleRootFolderName, mapZipEntryToLocalPath, isLikelyText } = require('../../lib/zip');

const router = express.Router();

router.use(async (_req, _res, next) => {
  await ensureDataDir();
  next();
});

// GET /api/files - list all files
router.get('/files', async (_req, res) => {
  const files = await getAllFiles();
  res.json(files);
});

// POST /api/files - save file
router.post('/files', async (req, res) => {
  const { fileData, zipBuffer } = req.body;
  let buf = undefined;
  if (zipBuffer) {
    if (typeof zipBuffer === 'string') {
      buf = Buffer.from(zipBuffer, 'base64');
    } else if (zipBuffer.type === 'Buffer' && Array.isArray(zipBuffer.data)) {
      buf = Buffer.from(zipBuffer.data);
    }
  }
  const result = await saveFileData(fileData, buf);
  res.json(result);
});

// GET /api/files/:cid - read single file
router.get('/files/:cid', async (req, res) => {
  try {
    const data = await readFileData(req.params.cid);
    res.json(data);
  } catch (error) {
    if (error.code === 'ENOENT') return res.json(null);
    console.error('Error reading file:', error);
    res.json(null);
  }
});

// DELETE /api/files/:cid - delete file
router.delete('/files/:cid', async (req, res) => {
  const result = await doDeleteFile(req.params.cid);
  res.json(result);
});

// PUT /api/files/:cid/tags - update tags
router.put('/files/:cid/tags', async (req, res) => {
  const { tags } = req.body;
  const result = await updateFileTags(req.params.cid, tags);
  res.json(result);
});

// POST /api/hash - calculate hash
router.post('/hash', async (req, res) => {
  try {
    const { content } = req.body;
    if (content == null) return res.json({ success: false, error: 'No content to hash' });
    let input;
    if (typeof content === 'string') {
      input = content;
    } else if (content.type === 'Buffer' && Array.isArray(content.data)) {
      input = Buffer.from(content.data);
    } else {
      input = content;
    }
    const hash = await calculateCid(input);
    res.json({ success: true, hash });
  } catch (error) {
    res.json({ success: false, error: error.message || String(error) });
  }
});

// GET /api/dsoul/:cid - fetch dsoul by cid
router.get('/dsoul/:cid', async (req, res) => {
  const result = await fetchDsoulByCid(req.params.cid);
  res.json(result);
});

// GET /api/settings
router.get('/settings', async (_req, res) => {
  const settings = await loadSettings();
  res.json(settings);
});

// PUT /api/settings
router.put('/settings', async (req, res) => {
  const result = await saveSettings(req.body);
  res.json(result);
});

// POST /api/files/:cid/activate
router.post('/files/:cid/activate', async (req, res) => {
  const result = await doActivateFile(req.params.cid);
  res.json(result);
});

// POST /api/files/:cid/deactivate
router.post('/files/:cid/deactivate', async (req, res) => {
  const result = await doDeactivateFile(req.params.cid);
  res.json(result);
});

// GET /api/files/:cid/hash-from-path
router.get('/files/:cid/hash-from-path', async (req, res) => {
  const dataDir = getFilesDir();
  try {
    const zipPath = path.join(dataDir, `${req.params.cid}.zip`);
    const buf = await fs.readFile(zipPath);
    const hash = await calculateCid(buf);
    res.json({ success: true, hash });
  } catch (error) {
    console.error('Error hashing file from path:', error);
    res.json({ success: false, error: error.message });
  }
});

// GET /api/files/:cid/verify-integrity
router.get('/files/:cid/verify-integrity', async (req, res) => {
  const cid = req.params.cid;
  const consoleLines = [];
  const log = (msg) => {
    const line = typeof msg === 'string' ? msg : JSON.stringify(msg);
    consoleLines.push(line);
  };
  try {
    const fileData = await readFileData(cid).catch(() => null);
    if (!fileData || (!fileData.is_skill_bundle && !fileData.is_bundle)) {
      return res.json({ success: false, error: 'Not a bundle or file not found' });
    }
    const settings = await loadSettings();
    const baseFolder = fileData.activatedSkillsFolder || settings.skillsFolder || process.env.DSOUL_SKILLS_FOLDER || '';
    if (!fileData.activatedFolderName || !baseFolder) {
      return res.json({ success: false, error: 'Bundle has no activated folder to verify' });
    }
    const skillDir = path.join(baseFolder, fileData.activatedFolderName);
    const downloadResult = await fetchByCid(cid);
    if (downloadResult.error) return res.json({ success: false, error: downloadResult.error });
    const zipBuffer = downloadResult.buffer;
    const zipHash = await calculateCid(zipBuffer);
    if (zipHash !== cid) return res.json({ success: false, error: `Downloaded zip hash ${zipHash} does not match CID ${cid}` });

    const tmpZipPath = path.join(os.tmpdir(), `dsoul-verify-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
    try {
      await fs.writeFile(tmpZipPath, zipBuffer);
      const entryNames = await listZipEntryNames(tmpZipPath);
      const stripPrefix = fileData.zipRootFolderName || getZipSingleRootFolderName(entryNames) || null;
      const zipEntries = await readAllZipFileEntries(tmpZipPath);

      const matched = [];
      const mismatched = [];
      const missing = [];
      const diffs = [];

      for (const { fileName, buffer: zipBuf } of zipEntries) {
        const localPath = mapZipEntryToLocalPath(fileName, stripPrefix, skillDir);
        if (localPath == null) continue;
        let localBuf;
        try {
          localBuf = await fs.readFile(localPath);
        } catch (e) {
          if (e.code === 'ENOENT') { missing.push(fileName); log(`Missing: ${fileName}`); continue; }
          throw e;
        }
        const zipHashEntry = await calculateCid(zipBuf);
        const localHashEntry = await calculateCid(localBuf);
        if (zipHashEntry === localHashEntry) {
          matched.push(fileName);
        } else {
          mismatched.push(fileName);
          let diffText = null;
          if (isLikelyText(zipBuf) && isLikelyText(localBuf)) {
            diffText = diff.createTwoFilesPatch(fileName, fileName, zipBuf.toString('utf-8'), localBuf.toString('utf-8'), 'original', 'working copy');
            log(`--- ${fileName} (diff) ---`);
            log(diffText);
          } else {
            log(`Mismatch (binary): ${fileName}`);
          }
          diffs.push({ fileName, diff: diffText });
        }
      }

      const allMatch = mismatched.length === 0 && missing.length === 0;
      const summary = `Bundle integrity: ${matched.length} matched, ${mismatched.length} mismatched, ${missing.length} missing`;
      log(summary);

      res.json({
        success: true,
        cidMatchesZip: true,
        report: { matched, mismatched, missing, allMatch },
        diffs,
        consoleOutput: consoleLines.join('\n')
      });
    } finally {
      await fs.unlink(tmpZipPath).catch(() => {});
    }
  } catch (error) {
    console.error('Verify bundle integrity error:', error);
    res.json({ success: false, error: error.message || String(error) });
  }
});

// GET /api/files/:cid/bundle/skill
router.get('/files/:cid/bundle/skill', async (req, res) => {
  const dataDir = getFilesDir();
  try {
    const zipPath = path.join(dataDir, `${req.params.cid}.zip`);
    const content = await readEntryFromZip(zipPath, 'Skill.MD');
    res.json({ success: true, content });
  } catch (error) {
    console.error('Error reading bundle skill content:', error);
    res.json({ success: false, error: error.message });
  }
});

// GET /api/files/:cid/bundle/license
router.get('/files/:cid/bundle/license', async (req, res) => {
  const dataDir = getFilesDir();
  const LICENSE_ENTRY_NAMES = ['license.md', 'license', 'license.txt'];
  try {
    const zipPath = path.join(dataDir, `${req.params.cid}.zip`);
    for (const name of LICENSE_ENTRY_NAMES) {
      const content = await readEntryFromZip(zipPath, name);
      if (content) return res.json({ success: true, content });
    }
    const content = await readFirstEntryFromZipWhere(zipPath, (_fileName, baseLower) => baseLower.includes('license'));
    res.json({ success: true, content });
  } catch (error) {
    console.error('Error reading bundle license content:', error);
    res.json({ success: false, error: error.message });
  }
});

// POST /api/validate-zip-bundle
router.post('/validate-zip-bundle', async (req, res) => {
  const { buffer } = req.body;
  if (!buffer) return res.json({ success: false, error: 'No buffer provided' });
  let buf;
  if (typeof buffer === 'string') {
    buf = Buffer.from(buffer, 'base64');
  } else if (buffer.type === 'Buffer' && Array.isArray(buffer.data)) {
    buf = Buffer.from(buffer.data);
  } else {
    return res.json({ success: false, error: 'Invalid buffer format' });
  }
  const tmpPath = path.join(os.tmpdir(), `dsoul-verify-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
  try {
    await fs.writeFile(tmpPath, buf);
    const info = await getZipBundleInfo(tmpPath);
    res.json({
      success: true,
      valid: info.hasSkillMd,
      skillContent: info.skillContent,
      rootFolderName: info.singleRootFolderName || null
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
});

// GET /api/default-skills-folders — platform-specific default paths for Cursor, Claude, VS Code (Copilot)
// Cursor: https://cursor.com/docs/context/skills | Claude: ~/.claude/skills | VS Code: https://code.visualstudio.com/docs/copilot/customization/agent-skills
router.get('/default-skills-folders', (_req, res) => {
  const home = os.homedir();
  const cursor = path.join(home, '.cursor', 'skills');
  const claude = path.join(home, '.claude', 'skills');
  const vscode = path.join(home, '.copilot', 'skills');
  res.json({ cursor, claude, vscode });
});

// POST /api/open-skills-folder
router.post('/open-skills-folder', async (_req, res) => {
  const settings = await loadSettings();
  if (!settings.skillsFolder) {
    return res.json({ success: false, error: 'Skills folder not set. Please configure it in Options.' });
  }
  try {
    const open = (await import('open')).default;
    await open(settings.skillsFolder);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message || String(err) });
  }
});

// GET /api/plugins — list available (bundled) plugins and their install status
router.get('/plugins', async (_req, res) => {
  try {
    const { getPluginsDir, listBundledPluginNames } = require('../../cli/commands/plugin');
    const packagesDir = path.resolve(__dirname, '..', '..', 'packages');
    const pluginsDir = getPluginsDir();

    const seen = new Set();
    const plugins = [];

    let pluginBundles = {};
    try { pluginBundles = require('../../packages/bundles'); } catch (_) {}

    const bundled = listBundledPluginNames();

    for (const name of bundled) {
      seen.add(name);
      const meta = pluginBundles[name] || {};
      let version = meta.version || '?';
      let description = meta.description || '';
      if (!meta.version) {
        try {
          const pkg = JSON.parse(await fs.readFile(path.join(packagesDir, name, 'package.json'), 'utf8'));
          version = pkg.version || '?';
          description = pkg.description || '';
        } catch (_) {}
      }
      let activated = false;
      try { await fs.access(path.join(pluginsDir, name, 'node_modules')); activated = true; } catch (_) {}
      plugins.push({ name, version, description, activated, bundled: true });
    }

    let installed = [];
    try {
      installed = (await fs.readdir(pluginsDir, { withFileTypes: true }))
        .filter(e => e.isDirectory()).map(e => e.name);
    } catch (_) {}

    for (const name of installed) {
      if (seen.has(name)) continue;
      let version = '?', description = '';
      try {
        const pkg = JSON.parse(await fs.readFile(path.join(pluginsDir, name, 'package.json'), 'utf8'));
        version = pkg.version || '?';
        description = pkg.description || '';
      } catch (_) {}
      plugins.push({ name, version, description, activated: true, bundled: false });
    }

    res.json({ success: true, plugins, pluginsDir });
  } catch (err) {
    res.json({ success: false, error: err.message, plugins: [], pluginsDir: '' });
  }
});

// GET /api/plugins/installer-status — check whether npm or bun is available
router.get('/plugins/installer-status', (_req, res) => {
  for (const cmd of ['bun', 'npm']) {
    const r = spawnSync(cmd, ['--version'], { stdio: 'pipe', shell: process.platform === 'win32' });
    if (!r.error && r.status === 0) return res.json({ available: true, installer: cmd });
  }
  res.json({ available: false, installer: null });
});

// POST /api/exec — stream CLI command output as NDJSON
const EXEC_ALLOWED = new Set([
  'install', 'uninstall', 'update', 'upgrade', 'init',
  'package', 'hash', 'freeze', 'balance', 'files',
  'register', 'unregister', 'config',
  'rehydrate', 'plugin',
]);

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
}

function makeLineBuf(onLine) {
  let buf = '';
  return {
    push(chunk) {
      buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) onLine(l);
    },
    flush() { if (buf) { onLine(buf); buf = ''; } },
  };
}

router.post('/exec', (req, res) => {
  const { command, args = [] } = req.body || {};
  if (!command || !EXEC_ALLOWED.has(command)) {
    return res.status(400).json({ error: 'Invalid command' });
  }
  if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) {
    return res.status(400).json({ error: 'Invalid args' });
  }

  const dsoulBin = path.join(__dirname, '..', '..', 'bin', 'dsoul.js');
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const send = (obj) => res.write(JSON.stringify(obj) + '\n');

  const child = spawn(process.execPath, [dsoulBin, command, ...args], {
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', TERM: 'dumb' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const outBuf = makeLineBuf(line => send({ type: 'out', data: stripAnsi(line) }));
  const errBuf = makeLineBuf(line => send({ type: 'err', data: stripAnsi(line) }));

  child.stdout.on('data', chunk => outBuf.push(chunk));
  child.stderr.on('data', chunk => errBuf.push(chunk));

  child.on('close', code => {
    outBuf.flush();
    errBuf.flush();
    send({ type: 'exit', code: code ?? 1 });
    res.end();
  });

  child.on('error', err => {
    send({ type: 'err', data: 'Failed to start process: ' + err.message });
    send({ type: 'exit', code: 1 });
    res.end();
  });

  req.on('close', () => child.kill());
});

module.exports = router;
