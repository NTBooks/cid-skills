/**
 * Archives the Windows exe into a zip for distribution.
 * Usage: node scripts/zip-exe.js <version>
 * Output: dist/dsoul-<version>-win.zip containing dsoul-<version>.exe + README.txt
 */
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/zip-exe.js <version>');
  process.exit(1);
}

const DIST = path.join(__dirname, '..', 'dist');
const exeName = `dsoul-${version}.exe`;
const exePath = path.join(DIST, exeName);
const zipPath = path.join(DIST, `dsoul-${version}-win.zip`);

if (!fs.existsSync(exePath)) {
  console.error(`Exe not found: ${exePath}`);
  process.exit(1);
}

const readme = `Diamond Soul Downloader v${version} — Windows
=============================================

QUICK START
-----------
1. Extract dsoul.exe to a folder of your choice, e.g.:
     C:\\Program Files\\dsoul\\dsoul.exe

   Or somewhere simpler, like:
     C:\\Users\\YourName\\bin\\dsoul.exe

2. Add that folder to your PATH so you can run "dsoul" from any terminal.


ADDING TO PATH (Windows 11 / 10)
---------------------------------
Option A — GUI:
  1. Open Start and search for "Edit the system environment variables"
  2. Click "Environment Variables..."
  3. Under "User variables", select "Path" and click Edit
  4. Click New and paste the folder path where you placed dsoul.exe
  5. Click OK on all dialogs
  6. Open a new terminal and run: dsoul --version

Option B — PowerShell (one-liner):
  Run this in an Administrator PowerShell, replacing the path as needed:

    $folder = "C:\\Users\\YourName\\bin"
    $current = [Environment]::GetEnvironmentVariable("Path", "User")
    [Environment]::SetEnvironmentVariable("Path", "$current;$folder", "User")

  Then open a new terminal and run: dsoul --version


USAGE
-----
  dsoul install <cid-or-shortname>   Install a skill
  dsoul search [query]               Browse the registry
  dsoul freeze <file>                Stamp a file on the blockchain
  dsoul help                         Show all commands

  Full documentation: https://dsoul.org
`;

const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  const mb = (archive.pointer() / 1024 / 1024).toFixed(1);
  console.log(`Zipped → ${path.basename(zipPath)} (${mb} MB)`);
});

archive.on('error', (err) => {
  console.error('zip-exe failed:', err.message);
  process.exit(1);
});

archive.pipe(output);
archive.file(exePath, { name: 'dsoul.exe' });
archive.append(readme, { name: 'README.txt' });
archive.finalize();
