'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const readline = require('readline');

// Files extracted from the bundle into the plugin folder on install.
const PLUGIN_FILES = ['package.json', 'index.js'];

// In pkg builds, plugin files are inlined into packages/bundles.js to avoid
// pkg's broken asset path handling for directories with spaces in the name.
// Falls back to filesystem reads in dev mode.
const getPluginBundles = () => {
  try { return require('../../packages/bundles'); } catch (_) { return null; }
};

const BUNDLED_PLUGINS_SRC = path.resolve(__dirname, '..', '..', 'packages');

const readPluginFile = (pluginName, filename) => {
  const bundles = getPluginBundles();
  if (bundles && bundles[pluginName] && bundles[pluginName].files[filename]) {
    return bundles[pluginName].files[filename];
  }
  return fs.readFileSync(path.join(BUNDLED_PLUGINS_SRC, pluginName, filename));
};

const pluginFileExists = (pluginName, filename) => {
  try { readPluginFile(pluginName, filename); return true; } catch (_) { return false; }
};

const listBundledPluginNames = () => {
  const bundles = getPluginBundles();
  if (bundles) return Object.keys(bundles);
  try {
    return fs.readdirSync(BUNDLED_PLUGINS_SRC)
      .filter(e => { try { return fs.statSync(path.join(BUNDLED_PLUGINS_SRC, e)).isDirectory(); } catch (_) { return false; } });
  } catch (_) { return []; }
};

function getPluginsDir() {
  if (process.env.DSOUL_PLUGINS_DIR) return process.env.DSOUL_PLUGINS_DIR;
  // Compiled binary: next to the exe. Dev (node script): project root.
  const isScript = !process.pkg && !process.versions.bun;
  if (isScript) return path.resolve(path.dirname(process.argv[1] || ''), '..', 'plugins');
  return path.join(path.dirname(process.execPath), 'plugins');
}

function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

function detectInstaller() {
  for (const cmd of ['bun', 'npm']) {
    const r = spawnSync(cmd, ['--version'], { stdio: 'pipe', shell: process.platform === 'win32' });
    if (!r.error && r.status === 0) return cmd;
  }
  return null;
}

async function runCliPlugin(cliArgs, ui) {
  const pluginsDir = getPluginsDir();

  // ── LIST ─────────────────────────────────────────────────────────────────
  if (cliArgs.subcommand === 'list') {
    let entries = [];
    try { entries = fs.readdirSync(pluginsDir); } catch (_) {}

    const plugins = entries.filter((e) => {
      try { return fs.statSync(path.join(pluginsDir, e)).isDirectory(); } catch (_) { return false; }
    });

    if (plugins.length === 0) {
      ui.info('No plugins installed.');
      ui.dim(`Plugins folder: ${pluginsDir}`);
      return true;
    }

    ui.header('Plugins');
    for (const name of plugins) {
      const pkgPath = path.join(pluginsDir, name, 'package.json');
      const activated = fs.existsSync(path.join(pluginsDir, name, 'node_modules'));
      let version = '?';
      try { version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || '?'; } catch (_) {}
      const status = activated ? `${ui.c.green}activated${ui.c.reset}` : `${ui.c.yellow}not installed${ui.c.reset}`;
      ui.raw(`  ${ui.name(name)}  v${version}  [${status}]`);
    }
    ui.dim(`Plugins folder: ${pluginsDir}`);
    return true;
  }

  // ── INSTALL ───────────────────────────────────────────────────────────────
  if (cliArgs.subcommand === 'install') {
    const pluginName = cliArgs.target;
    const pluginDir = path.join(pluginsDir, pluginName);
    const alreadyActivated = fs.existsSync(path.join(pluginDir, 'node_modules'));

    if (alreadyActivated && !cliArgs.force) {
      ui.ok(`${pluginName} is already activated.`);
      ui.dim('Use --force to reinstall.');
      return true;
    }

    // Check we have the source bundled for this plugin
    const hasSrc = PLUGIN_FILES.every(f => pluginFileExists(pluginName, f));
    if (!hasSrc) {
      ui.fail(`No bundled source found for plugin: ${pluginName}`);
      return false;
    }

    // Confirm before writing files next to the binary
    ui.info(`This will create files next to dsoul:`);
    ui.dim(`  ${pluginDir}`);
    ui.dim(`  ${pluginDir}${path.sep}node_modules${path.sep}  (after dependency install)`);

    if (!cliArgs.yes) {
      const ok = await confirm('Proceed?');
      if (!ok) {
        ui.info('Cancelled.');
        return false;
      }
    }

    // Extract bundled source to real filesystem
    ui.step('Extracting plugin', ui.name(pluginName));
    try {
      fs.mkdirSync(pluginDir, { recursive: true });
      for (const file of PLUGIN_FILES) {
        const content = readPluginFile(pluginName, file);
        fs.writeFileSync(path.join(pluginDir, file), content);
      }
    } catch (err) {
      ui.fail('Failed to extract plugin: ' + err.message);
      return false;
    }
    ui.ok('Plugin files extracted');

    // Install dependencies
    const installer = detectInstaller();
    if (!installer) {
      ui.fail('npm (or bun) not found. Install Node.js from https://nodejs.org then retry.');
      return false;
    }
    ui.step('Installing dependencies', `using ${installer}`);
    const result = spawnSync(installer, ['install'], {
      cwd: pluginDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    if (result.error || result.status !== 0) {
      ui.fail(`Dependency install failed. Try manually: cd "${pluginDir}" && ${installer} install`);
      return false;
    }

    ui.ok(`${pluginName} activated`);
    return true;
  }

  ui.fail('Usage: dsoul plugin list | dsoul plugin install <name> [-y]');
  return false;
}

module.exports = { runCliPlugin, getPluginsDir, listBundledPluginNames };
