const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  underline: '\x1b[4m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightCyan: '\x1b[96m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgCyan: '\x1b[46m',
};

const SYM = {
  ok: `${c.green}✓${c.reset}`,
  fail: `${c.red}✗${c.reset}`,
  warn: `${c.yellow}⚠${c.reset}`,
  arrow: `${c.cyan}→${c.reset}`,
  bullet: `${c.gray}•${c.reset}`,
  plus: `${c.green}+${c.reset}`,
  minus: `${c.red}-${c.reset}`,
  diamond: `${c.cyan}◆${c.reset}`,
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
};

function info(...args) {
  console.log(`${c.cyan}info${c.reset}`, ...args);
}

function ok(...args) {
  console.log(`${SYM.ok}`, ...args);
}

function warn(...args) {
  console.log(`${SYM.warn} ${c.yellow}warn${c.reset}`, ...args);
}

function fail(...args) {
  console.error(`${SYM.fail} ${c.red}ERR!${c.reset}`, ...args);
}

function step(label, detail) {
  if (detail !== undefined) {
    console.log(`${SYM.arrow} ${c.bold}${label}${c.reset} ${c.gray}${detail}${c.reset}`);
  } else {
    console.log(`${SYM.arrow} ${c.bold}${label}${c.reset}`);
  }
}

function detail(label, value) {
  console.log(`  ${SYM.bullet} ${c.gray}${label}:${c.reset} ${value}`);
}

function added(name) {
  console.log(`${SYM.plus} ${c.green}${name}${c.reset}`);
}

function removed(name) {
  console.log(`${SYM.minus} ${c.red}${name}${c.reset}`);
}

function header(text) {
  console.log('');
  console.log(`${c.bold}${c.cyan}${text}${c.reset}`);
}

function dim(...args) {
  console.log(`${c.gray}${args.join(' ')}${c.reset}`);
}

function banner(text) {
  console.log(`${c.bold}${c.brightCyan}${text}${c.reset}`);
}

function progress(current, total, label) {
  const pct = Math.round((current / total) * 100);
  const barLen = 20;
  const filled = Math.round((current / total) * barLen);
  const empty = barLen - filled;
  const bar = `${c.cyan}${'█'.repeat(filled)}${c.gray}${'░'.repeat(empty)}${c.reset}`;
  process.stdout.write(`\r  ${bar} ${pct}% ${label || ''}`);
  if (current >= total) process.stdout.write('\n');
}

function summary(stats) {
  console.log('');
  const parts = [];
  if (stats.added != null) parts.push(`${c.green}${stats.added} added${c.reset}`);
  if (stats.updated != null) parts.push(`${c.cyan}${stats.updated} updated${c.reset}`);
  if (stats.removed != null) parts.push(`${c.red}${stats.removed} removed${c.reset}`);
  if (stats.failed != null) parts.push(`${c.red}${stats.failed} failed${c.reset}`);
  if (stats.skipped != null) parts.push(`${c.yellow}${stats.skipped} skipped${c.reset}`);
  if (stats.unchanged != null) parts.push(`${c.gray}${stats.unchanged} unchanged${c.reset}`);
  console.log(parts.join(', '));
}

function timing(label, ms) {
  const sec = (ms / 1000).toFixed(1);
  console.log(`${c.gray}${label} in ${sec}s${c.reset}`);
}

function cid(cidStr) {
  return `${c.cyan}${cidStr}${c.reset}`;
}

function name(nameStr) {
  return `${c.bold}${c.white}${nameStr}${c.reset}`;
}

function url(urlStr) {
  return `${c.underline}${c.cyan}${urlStr}${c.reset}`;
}

function tag(tagStr) {
  return `${c.magenta}${tagStr}${c.reset}`;
}

module.exports = { c, SYM, info, ok, warn, fail, step, detail, added, removed, header, dim, banner, progress, summary, timing, cid, name, url, tag };
