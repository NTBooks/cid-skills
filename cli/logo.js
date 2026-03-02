const { c } = require('./log');

const TITLE_LINES = [
  `${c.bold}${c.brightCyan} ____  _                                 _`,
  `${c.bold}${c.brightCyan}|  _ \\(_) __ _ _ __ ___   ___  _ __   __| |`,
  `${c.bold}${c.cyan}| | | | |/ _\` | '_ \` _ \\ / _ \\| '_ \\ / _\` |`,
  `${c.bold}${c.cyan}| |_| | | (_| | | | | | | (_) | | | | (_| |`,
  `${c.bold}${c.blue}|____/|_|\\__,_|_| |_| |_|\\___/|_| |_|\\__,_|`,
  `${c.bold}${c.blue}  ____              _`,
  `${c.bold}${c.blue} / ___|  ___  _   _| |`,
  `${c.bold}${c.brightCyan} \\___ \\ / _ \\| | | | |`,
  `${c.bold}${c.brightCyan}  ___) | (_) | |_| | |`,
  `${c.bold}${c.cyan} |____/ \\___/ \\__,_|_|`,
];

// Plain ASCII text matching each TITLE_LINE (no ANSI)
const TITLE_PLAIN = [
  ' ____  _                                 _',
  '|  _ \\(_) __ _ _ __ ___   ___  _ __   __| |',
  '| | | | |/ _` | \'_ ` _ \\ / _ \\| \'_ \\ / _` |',
  '| |_| | | (_| | | | | | | (_) | | | | (_| |',
  '|____/|_|\\__,_|_| |_| |_|\\___/|_| |_|\\__,_|',
  '  ____              _',
  ' / ___|  ___  _   _| |',
  ' \\___ \\ / _ \\| | | | |',
  '  ___) | (_) | |_| | |',
  ' |____/ \\___/ \\__,_|_|',
];

// Base colors per row matching TITLE_LINES
const ROW_COLORS = [
  '\x1b[96m', // brightCyan
  '\x1b[96m',
  '\x1b[36m', // cyan
  '\x1b[36m',
  '\x1b[34m', // blue
  '\x1b[34m',
  '\x1b[34m',
  '\x1b[96m', // brightCyan
  '\x1b[96m',
  '\x1b[36m', // cyan
];

function printTitle() {
  for (const line of TITLE_LINES) {
    console.log(`  ${line}${c.reset}`);
  }
}

function printStatic() {
  console.log('');
  printTitle();
  console.log('');
}

async function animateFloat() {
  printStatic();
}

// Render one title row with a left-to-right gradient wave.
// waveFront: x-position of the bright peak. gradWidth: falloff width.
function renderGradientLine(row, waveFront, gradWidth) {
  const plain = TITLE_PLAIN[row];
  const base = ROW_COLORS[row];
  const dim = '\x1b[2m' + base;
  // Color stops from wave-front outward (dist 0 = peak)
  const stops = ['\x1b[97m', '\x1b[96m', '\x1b[36m', base, dim];
  const step = gradWidth / stops.length;
  let out = '\x1b[1m';
  for (let x = 0; x < plain.length; x++) {
    const dist = waveFront - x;
    if (dist < 0) {
      out += dim + plain[x];
    } else {
      const idx = Math.min(stops.length - 1, Math.floor(dist / step));
      out += stops[idx] + plain[x];
    }
  }
  return out + '\x1b[0m';
}

// Render one title row with sparkle chars overlaid at sparkleCols (Set of col indices).
function renderSparkleLine(row, sparkleCols) {
  const plain = TITLE_PLAIN[row];
  const base = ROW_COLORS[row];
  let out = '\x1b[1m';
  for (let x = 0; x < plain.length; x++) {
    if (sparkleCols.has(x) && plain[x] !== ' ') {
      out += '\x1b[93m\u2736'; // bright yellow ✶
    } else {
      out += base + plain[x];
    }
  }
  return out + '\x1b[0m';
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function animateHelpTitle() {
  if (!process.stdout.isTTY) return;
  printStatic();
}

module.exports = { printTitle, printStatic, animateFloat, animateHelpTitle, TITLE_LINES, TITLE_PLAIN };
