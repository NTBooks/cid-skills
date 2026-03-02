const path = require('path');
const fs = require('fs').promises;
const { Writable } = require('stream');
const FormData = require('form-data');
const { loadWpCredentials } = require('../../lib/credentials');
const { getDsoulProviderBase } = require('../../lib/dsoul-api');
const { isZipMisconfigured } = require('../../lib/zip');
const log = require('../log');

const FREEZE_FILE_UPLOAD_EXTS = ['.zip', '.js', '.css'];

async function runCliFreeze(opts) {
  const t0 = Date.now();
  try {
    const credentials = await loadWpCredentials();
    if (!credentials) { log.fail('No stored credentials. Run dsoul register first.'); return false; }

    const filePath = path.resolve(process.cwd(), opts.file);
    log.header(`Freezing ${log.name(path.basename(filePath))}`);
    log.detail('path', filePath);

    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) { log.fail('File not found or not a file:', filePath); return false; }

    const filename = path.basename(filePath);
    const ext = path.extname(filename).toLowerCase();

    if (ext === '.zip') {
      log.step('Validating zip structure');
      const misconfigured = await isZipMisconfigured(filePath);
      if (misconfigured) {
        log.fail('Zip has a folder at root. skill.md and license.txt must be at the root of the zip.');
        return false;
      }
      log.ok('Zip structure valid');
    }

    const base = await getDsoulProviderBase();
    const freezeUrl = base + '/freeze';
    log.step('Uploading to DSOUL');
    log.detail('endpoint', log.url(freezeUrl));
    log.detail('user', log.name(credentials.username));

    const isFileUpload = FREEZE_FILE_UPLOAD_EXTS.includes(ext);
    const version = (opts.version && String(opts.version).trim()) || '1.0.0';
    const authHeader = 'Basic ' + Buffer.from(credentials.username + ':' + credentials.applicationKey).toString('base64');

    if (opts.shortname) log.detail('shortname', opts.shortname);
    if (opts.tags) log.detail('tags', opts.tags);
    log.detail('version', version);

    let res;
    if (isFileUpload) {
      const fileBuffer = await fs.readFile(filePath);
      log.detail('size', `${(fileBuffer.length / 1024).toFixed(1)} KB`);
      const form = new FormData();
      form.append('cl_file', fileBuffer, { filename });
      form.append('filename', filename);
      form.append('version', version);
      if (opts.tags) form.append('tags', opts.tags);
      if (opts.shortname) form.append('shortname', opts.shortname.trim());
      if (opts.license_url) form.append('license_url', opts.license_url.trim());
      const formHeaders = form.getHeaders();
      const bodyBuffer = await new Promise((resolve, reject) => {
        const chunks = [];
        const collector = new Writable({ write(chunk, enc, cb) { chunks.push(chunk); cb(); } });
        collector.on('finish', () => resolve(Buffer.concat(chunks)));
        collector.on('error', reject);
        form.on('error', reject);
        form.pipe(collector);
      });
      res = await fetch(freezeUrl, {
        method: 'POST',
        headers: { ...formHeaders, Authorization: authHeader, 'Content-Length': String(bodyBuffer.length) },
        body: bodyBuffer
      });
    } else {
      const content = await fs.readFile(filePath, 'utf-8');
      log.detail('size', `${(Buffer.byteLength(content, 'utf-8') / 1024).toFixed(1)} KB`);
      const params = new URLSearchParams();
      params.append('filename', filename);
      params.append('content', content);
      params.append('version', version);
      if (opts.tags) params.append('tags', opts.tags);
      if (opts.shortname) params.append('shortname', opts.shortname.trim());
      if (opts.license_url) params.append('license_url', opts.license_url.trim());
      res = await fetch(freezeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: authHeader },
        body: params.toString()
      });
    }

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { log.fail('Invalid JSON response:', text.slice(0, 200)); return false; }
    if (!res.ok) { log.fail(`HTTP ${res.status}: ${(data && data.message) || data?.data?.message || text}`); return false; }

    if (data && data.success && data.data) {
      log.ok('Frozen successfully');
      log.detail('CID', log.cid(data.data.cid));
      if (data.data.guid) log.detail('URL', log.url(data.data.guid));
      log.timing('Done', Date.now() - t0);
      return true;
    }
    log.fail('Unexpected response');
    return false;
  } catch (err) { log.fail('Freeze failed:', err.message || String(err)); return false; }
}

module.exports = { runCliFreeze };
