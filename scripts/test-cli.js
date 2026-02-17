#!/usr/bin/env node
/**
 * End-to-end CLI test: config, register, balance, freeze (md + zip), files, unregister,
 * install the frozen zip, verify skill folder, uninstall, verify removed.
 * Plus LLM test suite: Diamond Soul API validation (freeze supercede, shortname dedupe/filter).
 * Run from project root: node scripts/test-cli.js
 * Requires test.config (copy from test.config.example and add user + token).
 * Optional: other_user_cid = CID or Post ID of a file owned by another user (for Test A).
 */

const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const testDir = path.join(projectRoot, '.cli-test');
const skillsDir = path.join(testDir, 'Skills');
const binPath = path.join(projectRoot, 'bin', 'dsoul.js');
const DSOUL_API_PATH = '/wp-json/diamond-soul/v1';
const CLI_TIMEOUT_MS = 5000;
const FREEZE_CLI_TIMEOUT_MS = 30000;
const INSTALL_WAIT_MS = 5000;
const API_REQUEST_TIMEOUT_MS = 15000;

function loadTestConfig() {
  const configPath = path.join(projectRoot, 'test.config');
  try {
    const raw = require('fs').readFileSync(configPath, 'utf-8');
    const out = {};
    raw.split('\n').forEach((line) => {
      const trimmed = line.replace(/#.*$/, '').trim();
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (key) out[key] = value;
      }
    });
    return out;
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.error('Missing test.config. Copy test.config.example to test.config and set user= and token=.');
    } else {
      console.error('Failed to read test.config:', e.message);
    }
    process.exit(1);
  }
}

function getApiBase(provider) {
  const origin = (provider || '').trim().replace(/\/+$/, '');
  if (!origin) return null;
  return origin.endsWith(DSOUL_API_PATH) ? origin : origin + DSOUL_API_PATH;
}

/**
 * POST to Diamond Soul /freeze API with Basic auth. options: filename, content, shortname, supercede, version, tags.
 * Returns { status, ok, data, text }.
 */
async function apiFreezePost(apiBase, user, token, options = {}) {
  const authHeader = 'Basic ' + Buffer.from(user + ':' + token).toString('base64');
  const form = new URLSearchParams();
  form.append('filename', options.filename || 'api-test.md');
  form.append('content', options.content != null ? String(options.content) : 'API test content');
  if (options.version) form.append('version', options.version);
  if (options.tags) form.append('tags', options.tags);
  if (options.shortname != null) form.append('shortname', String(options.shortname).trim());
  if (options.supercede != null) form.append('supercede', String(options.supercede).trim());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(apiBase + '/freeze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: authHeader
      },
      body: form.toString(),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {}
    return { status: res.status, ok: res.ok, data, text };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

function runDsoul(args, options = {}) {
  const { stdin = null, cwd = projectRoot } = options;
  return new Promise((resolve) => {
    const child = spawn('node', [binPath, ...args], {
      cwd,
      stdio: stdin != null ? ['pipe', 'pipe', 'pipe'] : 'inherit',
      shell: false
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (code, out, err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 0, stdout: out, stderr: err });
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      finish(1, stdout, stderr + '\nCLI timed out after ' + CLI_TIMEOUT_MS / 1000 + 's.');
    }, CLI_TIMEOUT_MS);
    if (stdin != null) {
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.stdin.write(stdin);
      child.stdin.end();
    }
    child.on('close', (code) => {
      finish(code ?? 0, stdout, stderr);
    });
  });
}

function runDsoulCapture(args, options = {}) {
  return new Promise((resolve) => {
    const spawnOpts = {
      cwd: options.cwd || projectRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    };
    if (options.env) spawnOpts.env = { ...process.env, ...options.env };
    const child = spawn('node', [binPath, ...args], spawnOpts);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const isFreeze = args[0] === 'freeze' && args[1] && String(args[1]).toLowerCase().endsWith('.zip');
    const timeoutMs = isFreeze ? FREEZE_CLI_TIMEOUT_MS : CLI_TIMEOUT_MS;
    const finish = (code, out, err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 0, stdout: out, stderr: err });
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      finish(1, stdout, stderr + '\nCLI timed out after ' + timeoutMs / 1000 + 's.');
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      finish(code ?? 0, stdout, stderr);
    });
  });
}

function parseCidFromOutput(output) {
  const m = output.match(/CID:\s*(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z0-9]{58,})/i);
  return m ? m[1] : null;
}

/** Parse "upgrade available > CID" from dsoul update output. Returns null if not found. */
function parseUpgradeAvailableCid(output) {
  const m = output.match(/upgrade available\s*[>→]\s*(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z0-9]{58,})/i);
  return m ? m[1] : null;
}

function printCmd(args) {
  console.log('  $ dsoul', args.join(' '));
}

function printCliOutput(r) {
  if (r.stdout && r.stdout.trim()) console.log('  --- stdout ---\n' + r.stdout.trim() + '\n  ---');
  if (r.stderr && r.stderr.trim()) console.log('  --- stderr ---\n' + r.stderr.trim() + '\n  ---');
}

function printStepOutput(stdout) {
  if (stdout && stdout.trim()) {
    stdout.trim().split('\n').forEach((line) => console.log('  ', line));
  }
}

async function main() {
  const config = loadTestConfig();
  const user = config.user && config.user.trim();
  const token = config.token && config.token.trim();
  const provider = (config.dsoul_provider && config.dsoul_provider.trim()) || 'https://dsoul.org';

  if (!user || !token) {
    console.error('test.config must set user= and token=.');
    process.exit(1);
  }

  console.log('Using provider:', provider);
  console.log('Test dir:', testDir);

  const steps = [];
  function step(name, fn) {
    steps.push({ name, fn });
  }

  step('clean .cli-test from previous run', async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (_) {}
    await fs.mkdir(skillsDir, { recursive: true });
    console.log('  ', testDir, 'cleaned and ready');
  });

  step('config dsoul-provider', async () => {
    const args = ['config', 'dsoul-provider', provider];
    printCmd(args);
    const r = await runDsoulCapture(args);
    if (r.code !== 0) {
      printCliOutput(r);
      throw new Error(`config dsoul-provider failed (exit ${r.code})`);
    }
    printStepOutput(r.stdout);
  });

  step('config skills-folder', async () => {
    const args = ['config', 'skills-folder', skillsDir];
    printCmd(args);
    const r = await runDsoulCapture(args);
    if (r.code !== 0) {
      printCliOutput(r);
      throw new Error(`config skills-folder failed (exit ${r.code})`);
    }
    printStepOutput(r.stdout);
  });

  step('register', async () => {
    printCmd(['register', '(using DSOUL_USER + DSOUL_TOKEN from test.config)']);
    const env = { ...process.env, DSOUL_USER: user, DSOUL_TOKEN: token };
    const r = await runDsoulCapture(['register'], { env });
    if (r.code !== 0) {
      printCliOutput(r);
      throw new Error(`register failed (exit ${r.code})`);
    }
    if (!/Credentials saved|saved securely/i.test(r.stdout)) {
      printCliOutput(r);
      throw new Error('register may have failed: expected "Credentials saved" in output');
    }
    printStepOutput(r.stdout);
  });

  step('balance (after register)', async () => {
    printCmd(['balance']);
    const r = await runDsoulCapture(['balance']);
    if (r.code !== 0) {
      printCliOutput(r);
      throw new Error(`balance failed (exit ${r.code})`);
    }
    if (!/Stamps:/i.test(r.stdout)) {
      printCliOutput(r);
      throw new Error('balance output missing Stamps');
    }
    printStepOutput(r.stdout);
  });

  let frozenZipCid = null;
  let lastPkgZipPath = null;
  let firstFrozenMdCid = null;
  let apiTestV2Cid = null;
  let apiTestC1Cid = null;
  let apiTestC2Cid = null;

  step('create random .md and freeze', async () => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const mdPath = path.join(testDir, `random-${id}.md`);
    const content = `# Test skill ${id}\n\nRandom content: ${Math.random().toString(36)}\n`;
    await fs.writeFile(mdPath, content, 'utf-8');
    console.log('  created', mdPath);
    const args = ['freeze', mdPath, '--tags=cli,test'];
    printCmd(args);
    const r = await runDsoulCapture(args);
    if (r.code !== 0) {
      printCliOutput(r);
      throw new Error(`freeze .md failed (exit ${r.code})`);
    }
    firstFrozenMdCid = parseCidFromOutput(r.stdout);
    if (firstFrozenMdCid) console.log('  captured CID for API tests:', firstFrozenMdCid);
    printStepOutput(r.stdout);
  });

  step('balance (after freeze md)', async () => {
    printCmd(['balance']);
    const r = await runDsoulCapture(['balance']);
    if (r.code !== 0) {
      printCliOutput(r);
      throw new Error(`balance failed (exit ${r.code})`);
    }
    printStepOutput(r.stdout);
  });

  step('create test folder and package', async () => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const pkgDir = path.join(testDir, `pkg-${id}`);
    await fs.mkdir(pkgDir, { recursive: true });
    await fs.writeFile(path.join(pkgDir, 'license.txt'), 'MIT\n', 'utf-8');
    await fs.writeFile(path.join(pkgDir, 'skill.md'), `# Test Package ${id}\n\nTest skill for CLI.\n`, 'utf-8');
    console.log('  created', pkgDir, '(license.txt, skill.md)');
    const args = ['package', pkgDir];
    printCmd(args);
    const r = await runDsoulCapture(args);
    if (r.code !== 0) {
      printCliOutput(r);
      throw new Error(`package failed (exit ${r.code})`);
    }
    printStepOutput(r.stdout);
    lastPkgZipPath = path.join(path.dirname(pkgDir), path.basename(pkgDir) + '.zip');
  });

  step('freeze the packaged zip', async () => {
    if (!lastPkgZipPath) throw new Error('No packaged zip from previous step');
    const zipPath = lastPkgZipPath;
    console.log('  using zip', zipPath);
    const args = ['freeze', zipPath, '--tags=cli,test,zip'];
    printCmd(args);
    const r = await runDsoulCapture(args);
    if (r.code !== 0) {
      printCliOutput(r);
      throw new Error(`freeze zip failed (exit ${r.code})`);
    }
    frozenZipCid = parseCidFromOutput(r.stdout);
    if (!frozenZipCid) {
      printCliOutput(r);
      throw new Error('Could not parse CID from freeze output');
    }
    printStepOutput(r.stdout);
  });

  // --- LLM Test Suite: Diamond Soul API Validation ---
  const apiBase = getApiBase(provider);
  if (apiBase && user && token) {
    step('API Test A: supercede ownership (fail) – cannot supercede another user\'s file', async () => {
      const otherCid = (config.other_user_cid && config.other_user_cid.trim()) || null;
      if (!otherCid) {
        console.log('  skip (set other_user_cid in test.config to run)');
        return;
      }
      const res = await apiFreezePost(apiBase, user, token, {
        filename: 'security_test.md',
        content: 'Testing unauthorized supercede',
        supercede: otherCid
      });
      if (res.status !== 400) {
        console.log('  response:', res.status, res.text || (res.data && JSON.stringify(res.data)));
        throw new Error(`Expected HTTP 400, got ${res.status}`);
      }
      const code = (res.data && (res.data.code || res.data.data && res.data.data.code)) || '';
      const msg = (res.data && (res.data.message || res.data.data && res.data.data.message)) || res.text || '';
      if (!/not_owner_supercede/i.test(code) && !/not_owner_supercede/i.test(String(res.data))) {
        throw new Error(`Expected error code not_owner_supercede, got: ${code || JSON.stringify(res.data)}`);
      }
      if (!/permission to supercede|do not have permission/i.test(msg)) {
        throw new Error(`Expected ownership/permission message, got: ${msg.slice(0, 120)}`);
      }
      console.log('  ok – 400 with not_owner_supercede');
    });

    step('API Test B: supercede ownership (success) – link new version to own file', async () => {
      if (!firstFrozenMdCid) throw new Error('No first-frozen CID from earlier step');
      const res = await apiFreezePost(apiBase, user, token, {
        filename: 'v2.md',
        content: 'New content',
        supercede: firstFrozenMdCid
      });
      if (res.status !== 200 || !res.ok) {
        console.log('  response:', res.status, res.text || (res.data && JSON.stringify(res.data)));
        throw new Error(`Expected HTTP 200, got ${res.status}`);
      }
      const data = res.data && (res.data.data || res.data);
      const cid = data && data.cid;
      if (!cid) throw new Error(`Expected response to include cid, got: ${JSON.stringify(data).slice(0, 200)}`);
      apiTestV2Cid = cid;
      const supercedeVal = data && (data.supercede || (data.meta && data.meta.supercede));
      if (supercedeVal != null && supercedeVal !== firstFrozenMdCid) {
        throw new Error(`Expected response supercede=${firstFrozenMdCid}, got: ${supercedeVal}`);
      }
      console.log('  ok – 200, new file created with supercede link');
    });

    step('API Test C1: shortname prefix – send only project name', async () => {
      const id = Date.now().toString(36);
      const shortname = 'my-cool-project-' + id;
      const res = await apiFreezePost(apiBase, user, token, {
        filename: 'c1.md',
        content: 'C1',
        shortname
      });
      if (!res.ok) {
        console.log('  response:', res.status, res.text);
        throw new Error(`Expected 200 for shortname="${shortname}", got ${res.status}`);
      }
      const data = res.data && (res.data.data || res.data);
      const normalized = data && data.shortname || (res.data && res.data.shortname);
      const expectedPrefix = user + '@' + shortname;
      if (normalized && normalized !== expectedPrefix && !normalized.startsWith(user + '@')) {
        throw new Error(`Expected normalized shortname like ${expectedPrefix}, got: ${normalized}`);
      }
      if (data && data.cid) apiTestC1Cid = data.cid;
      console.log('  ok – shortname normalized to', normalized || expectedPrefix);
    });

    step('API Test C2: shortname prefix – send namespaced name (no double prefix)', async () => {
      const id = Date.now().toString(36);
      const shortname = user + '@dedupe-project-' + id;
      const res = await apiFreezePost(apiBase, user, token, {
        filename: 'c2.md',
        content: 'C2',
        shortname
      });
      if (!res.ok) {
        console.log('  response:', res.status, res.text);
        throw new Error(`Expected 200 for shortname="${shortname}", got ${res.status}`);
      }
      const data = res.data && (res.data.data || res.data);
      const normalized = data && data.shortname || (res.data && res.data.shortname);
      if (normalized && /@.*@/.test(normalized)) {
        throw new Error(`Double prefix in shortname: ${normalized}`);
      }
      if (data && data.cid) apiTestC2Cid = data.cid;
      console.log('  ok – no double prefix');
    });

    step('API Test C3: shortname – wrong user prefix returns 400', async () => {
      const shortname = 'wrong_user@project';
      const res = await apiFreezePost(apiBase, user, token, {
        filename: 'c3.md',
        content: 'C3',
        shortname
      });
      if (res.status !== 400) {
        console.log('  response:', res.status, res.text);
        throw new Error(`Expected HTTP 400 for wrong prefix, got ${res.status}`);
      }
      const msg = (res.data && (res.data.message || res.data.data && res.data.data.message)) || res.text || '';
      if (!/prefix.*does not match|Username Prefix Error/i.test(msg)) {
        throw new Error(`Expected prefix/username error message, got: ${msg.slice(0, 120)}`);
      }
      console.log('  ok – 400 with prefix error');
    });

    step('API Test D1: shortname – too many @ rejected', async () => {
      const shortname = user + '@project@extra';
      const res = await apiFreezePost(apiBase, user, token, {
        filename: 'd1.md',
        content: 'D1',
        shortname
      });
      if (res.status !== 400) {
        console.log('  response:', res.status, res.text);
        throw new Error(`Expected HTTP 400 for multiple @, got ${res.status}`);
      }
      const msg = (res.data && (res.data.message || res.data.data && res.data.data.message)) || res.text || '';
      if (!/only contain one\s*["']?@["']?\s*character/i.test(msg)) {
        throw new Error(`Expected "only one @" message, got: ${msg.slice(0, 120)}`);
      }
      console.log('  ok – 400, one @ only');
    });

    step('API Test D2: shortname – invalid characters rejected', async () => {
      const shortname = 'project$name';
      const res = await apiFreezePost(apiBase, user, token, {
        filename: 'd2.md',
        content: 'D2',
        shortname
      });
      if (res.status !== 400) {
        console.log('  response:', res.status, res.text);
        throw new Error(`Expected HTTP 400 for invalid characters, got ${res.status}`);
      }
      const msg = (res.data && (res.data.message || res.data.data && res.data.data.message)) || res.text || '';
      if (!/invalid character|letters, numbers/i.test(msg)) {
        throw new Error(`Expected invalid-characters message, got: ${msg.slice(0, 120)}`);
      }
      console.log('  ok – 400, invalid characters');
    });
  }

  step('files (list frozen files)', async () => {
    printCmd(['files']);
    const r = await runDsoulCapture(['files']);
    if (r.code !== 0) {
      printCliOutput(r);
      throw new Error(`files failed (exit ${r.code})`);
    }
    if (!/Page \d+ of \d+/i.test(r.stdout) && !/No files/i.test(r.stdout)) {
      printCliOutput(r);
      throw new Error('files output expected "Page N of M" or "No files"');
    }
    printStepOutput(r.stdout);
  });

  step('verify file list contains test run artifacts (before unregister)', async () => {
    printCmd(['files']);
    const r = await runDsoulCapture(['files']);
    if (r.code !== 0) {
      printCliOutput(r);
      throw new Error(`files failed (exit ${r.code})`);
    }
    const list = (r.stdout + '\n' + r.stderr);
    if (!firstFrozenMdCid || !list.includes(firstFrozenMdCid)) {
      throw new Error(`File list should contain first frozen .md CID: ${firstFrozenMdCid}`);
    }
    if (!frozenZipCid || !list.includes(frozenZipCid)) {
      throw new Error(`File list should contain frozen zip CID: ${frozenZipCid}`);
    }
    if (apiBase && user && token) {
      for (const [label, cid] of [['v2', apiTestV2Cid], ['c1', apiTestC1Cid], ['c2', apiTestC2Cid]]) {
        if (!cid || !list.includes(cid)) {
          throw new Error(`File list should contain API test ${label} CID: ${cid || '(missing)'}`);
        }
      }
      console.log('  ok – list contains all 5 CIDs (random .md, zip, v2, c1, c2)');
    } else {
      console.log('  ok – list contains random .md and zip CIDs');
    }
  });

  step('unregister', async () => {
    printCmd(['unregister']);
    const r = await runDsoulCapture(['unregister']);
    if (r.code !== 0) {
      printCliOutput(r);
      throw new Error(`unregister failed (exit ${r.code})`);
    }
    printStepOutput(r.stdout);
  });

  step('install frozen zip (by CID)', async () => {
    if (!frozenZipCid) throw new Error('No frozen zip CID from earlier step');
    console.log('  waiting', INSTALL_WAIT_MS / 1000, 's for server to have CID...');
    await new Promise((r) => setTimeout(r, INSTALL_WAIT_MS));
    const args = ['install', '-g', frozenZipCid];
    printCmd(args);
    const r = await runDsoulCapture(args);
    if (r.code !== 0) {
      printCliOutput(r);
      throw new Error(`install failed (exit ${r.code})`);
    }
    printStepOutput(r.stdout);
  });

  step('check skill folder for installed skill', async () => {
    const entries = await fs.readdir(skillsDir);
    const skillEntries = entries.filter((e) => e !== 'dsoul.json');
    console.log('  skills dir contents:', entries.join(', '));
    if (skillEntries.length === 0) throw new Error(`Skills folder missing expected skill: ${entries.join(', ')}`);
  });

  step('uninstall', async () => {
    if (!frozenZipCid) throw new Error('No CID');
    const args = ['uninstall', frozenZipCid];
    printCmd(args);
    const r = await runDsoulCapture(args);
    if (r.code !== 0) {
      printCliOutput(r);
      throw new Error(`uninstall failed (exit ${r.code})`);
    }
    printStepOutput(r.stdout);
  });

  step('verify skill removed from skills folder', async () => {
    const entries = await fs.readdir(skillsDir);
    const skillEntries = entries.filter((e) => e !== 'dsoul.json');
    console.log('  skills dir contents:', entries.join(', '));
    if (skillEntries.length > 0) throw new Error(`Skills folder should be empty of skills after uninstall: ${skillEntries.join(', ')}`);
  });

  const historyTestCid = (config.history_test && config.history_test.trim()) || null;
  if (historyTestCid) {
    step('history test: install history_test CID', async () => {
      console.log('  waiting', INSTALL_WAIT_MS / 1000, 's for server...');
      await new Promise((r) => setTimeout(r, INSTALL_WAIT_MS));
      const args = ['install', '-g', '-y', historyTestCid];
      printCmd(args);
      const r = await runDsoulCapture(args);
      if (r.code !== 0) {
        printCliOutput(r);
        throw new Error(`history_test install failed (exit ${r.code})`);
      }
      printStepOutput(r.stdout);
    });

    step('history test: check for upgrade (dsoul update -g)', async () => {
      const args = ['update', '-g'];
      printCmd(args);
      const r = await runDsoulCapture(args);
      if (r.code !== 0) {
        printCliOutput(r);
        throw new Error(`update failed (exit ${r.code})`);
      }
      const combined = (r.stdout + '\n' + r.stderr).trim();
      if (!combined.includes(historyTestCid) && !combined.includes('Up to date') && !combined.includes('upgrade available')) {
        printCliOutput(r);
        throw new Error('update output should mention the skill (CID, "Up to date", or "upgrade available")');
      }
      printStepOutput(r.stdout);
      printStepOutput(r.stderr);
    });

    step('history test: upgrade if available (dsoul upgrade -g)', async () => {
      const args = ['upgrade', '-g'];
      printCmd(args);
      const r = await runDsoulCapture(args);
      if (r.code !== 0) {
        printCliOutput(r);
        throw new Error(`upgrade failed (exit ${r.code})`);
      }
      printStepOutput(r.stdout);
      printStepOutput(r.stderr);
    });

    step('history test: uninstall', async () => {
      const dsoulPath = path.join(skillsDir, 'dsoul.json');
      let cidsToUninstall = [historyTestCid];
      try {
        const raw = await fs.readFile(dsoulPath, 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.skills) && data.skills.length > 0) {
          cidsToUninstall = data.skills.map((s) => s.cid).filter(Boolean);
        }
      } catch (_) {}
      for (const cid of cidsToUninstall) {
        const args = ['uninstall', cid];
        printCmd(args);
        const r = await runDsoulCapture(args);
        if (r.code !== 0) {
          printCliOutput(r);
          throw new Error(`history_test uninstall ${cid} failed (exit ${r.code})`);
        }
        printStepOutput(r.stdout);
      }
    });

    step('history test: verify skill removed', async () => {
      const entries = await fs.readdir(skillsDir);
      const skillEntries = entries.filter((e) => e !== 'dsoul.json');
      console.log('  skills dir contents:', entries.join(', '));
      if (skillEntries.length > 0) throw new Error(`Skills folder should be empty after history_test uninstall: ${skillEntries.join(', ')}`);
    });
  }

  console.log('\n--- Running', steps.length, 'steps ---\n');
  for (let i = 0; i < steps.length; i++) {
    const { name, fn } = steps[i];
    console.log(`[${i + 1}/${steps.length}] ${name}`);
    try {
      await fn();
      console.log('  ok\n');
    } catch (err) {
      console.log('\n  >>> STEP FAILED:', err.message);
      process.exit(1);
    }
  }
  console.log('--- All steps passed ---\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
