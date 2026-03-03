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

function formatInfo(message) {
  return `${c.cyan}info${c.reset} ${message}`;
}

function formatOk(message) {
  return `${SYM.ok} ${message}`;
}

function formatWarn(message) {
  return `${SYM.warn} ${c.yellow}warn${c.reset} ${message}`;
}

function formatFail(message) {
  return `${SYM.fail} ${c.red}ERR!${c.reset} ${message}`;
}

function formatStep(label, detail) {
  if (detail !== undefined) {
    return `${SYM.arrow} ${c.bold}${label}${c.reset} ${c.gray}${detail}${c.reset}`;
  }
  return `${SYM.arrow} ${c.bold}${label}${c.reset}`;
}

function formatDetail(label, value) {
  return `  ${SYM.bullet} ${c.gray}${label}:${c.reset} ${value}`;
}

function formatAdded(nameStr) {
  return `${SYM.plus} ${c.green}${nameStr}${c.reset}`;
}

function formatRemoved(nameStr) {
  return `${SYM.minus} ${c.red}${nameStr}${c.reset}`;
}

function formatHeader(text) {
  return `${c.bold}${c.cyan}${text}${c.reset}`;
}

function formatDim(message) {
  return `${c.gray}${message}${c.reset}`;
}

function formatBanner(text) {
  return `${c.bold}${c.brightCyan}${text}${c.reset}`;
}

function formatProgressLine(current, total, label) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const barLen = 20;
  const ratio = total > 0 ? current / total : 0;
  const filled = Math.max(0, Math.min(barLen, Math.round(ratio * barLen)));
  const empty = barLen - filled;
  const bar = `${c.cyan}${'█'.repeat(filled)}${c.gray}${'░'.repeat(empty)}${c.reset}`;
  return `  ${bar} ${pct}% ${label || ''}`;
}

function formatSummary(stats) {
  const parts = [];
  if (stats.added != null) parts.push(`${c.green}${stats.added} added${c.reset}`);
  if (stats.updated != null) parts.push(`${c.cyan}${stats.updated} updated${c.reset}`);
  if (stats.removed != null) parts.push(`${c.red}${stats.removed} removed${c.reset}`);
  if (stats.failed != null) parts.push(`${c.red}${stats.failed} failed${c.reset}`);
  if (stats.skipped != null) parts.push(`${c.yellow}${stats.skipped} skipped${c.reset}`);
  if (stats.unchanged != null) parts.push(`${c.gray}${stats.unchanged} unchanged${c.reset}`);
  return parts.join(', ');
}

function formatTiming(label, ms) {
  const sec = (ms / 1000).toFixed(1);
  return `${c.gray}${label} in ${sec}s${c.reset}`;
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

module.exports = {
  c,
  SYM,
  // formatting helpers
  formatInfo,
  formatOk,
  formatWarn,
  formatFail,
  formatStep,
  formatDetail,
  formatAdded,
  formatRemoved,
  formatHeader,
  formatDim,
  formatBanner,
  formatProgressLine,
  formatSummary,
  formatTiming,
  // value formatters
  cid,
  name,
  url,
  tag,
  // legacy-style helpers used by existing command code.
  // These wrap console output so older call sites keep working
  // while we migrate to the ui-adapter interface.
  info(...args) {
    const msg = args.join(' ');
    console.log(formatInfo(msg));
  },
  ok(...args) {
    const msg = args.join(' ');
    console.log(formatOk(msg));
  },
  warn(...args) {
    const msg = args.join(' ');
    console.log(formatWarn(msg));
  },
  fail(...args) {
    const msg = args.join(' ');
    console.error(formatFail(msg));
  },
  step(label, detail) {
    console.log(formatStep(label, detail));
  },
  detail(label, value) {
    console.log(formatDetail(label, value));
  },
  added(nameStr) {
    console.log(formatAdded(nameStr));
  },
  removed(nameStr) {
    console.log(formatRemoved(nameStr));
  },
  header(text) {
    console.log('');
    console.log(formatHeader(text));
  },
  dim(...args) {
    const msg = args.join(' ');
    console.log(formatDim(msg));
  },
  banner(text) {
    console.log(formatBanner(text));
  },
  progress(current, total, label) {
    const line = formatProgressLine(current, total, label);
    process.stdout.write(`\r${line}`);
    if (total > 0 && current >= total) process.stdout.write('\n');
  },
  summary(stats) {
    console.log('');
    console.log(formatSummary(stats));
  },
  timing(label, ms) {
    console.log(formatTiming(label, ms));
  },
};
