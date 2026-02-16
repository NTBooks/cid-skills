#!/usr/bin/env node
/**
 * End-to-end CLI test: config, register, balance, freeze (md + zip), files, unregister,
 * install the frozen zip, verify skill folder, uninstall, verify removed.
 * Run from project root: node scripts/test-cli.js
 * Requires test.config (copy from test.config.example and add user + token).
 */

const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const testDir = path.join(projectRoot, '.cli-test');
const skillsDir = path.join(testDir, 'Skills');
const binPath = path.join(projectRoot, 'bin', 'dsoul.js');
const CLI_TIMEOUT_MS = 5000;
const FREEZE_CLI_TIMEOUT_MS = 30000;
const INSTALL_WAIT_MS = 5000;

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
