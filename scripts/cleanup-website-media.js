const fs = require('fs');
const path = require('path');

const MEDIA_DIR = path.join(__dirname, '..', 'data', 'website-media');
const UUID_RE = /^[a-f0-9-]{36}$/i;
const FILE_RE = /^[a-f0-9-]{36}\.(json|jpg|png|webp)$/i;

function retentionDays() {
  return Math.max(1, Number(process.env.WEBSITE_MEDIA_RETENTION_DAYS || 14));
}

function cutoffTime() {
  return Date.now() - retentionDays() * 24 * 60 * 60 * 1000;
}

function isOldEnough(metadataPath, metadata) {
  const fromMetadata = metadata?.createdAt ? Date.parse(metadata.createdAt) : NaN;
  if (Number.isFinite(fromMetadata)) return fromMetadata < cutoffTime();
  const stat = fs.statSync(metadataPath);
  return stat.mtimeMs < cutoffTime();
}

function safeJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function deleteFile(filePath, dryRun) {
  if (!fs.existsSync(filePath)) return 0;
  const size = fs.statSync(filePath).size;
  if (!dryRun) fs.rmSync(filePath, { force: true });
  return size;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  fs.mkdirSync(MEDIA_DIR, { recursive: true });

  const entries = fs.readdirSync(MEDIA_DIR).filter(name => FILE_RE.test(name));
  const jsonFiles = entries.filter(name => name.toLowerCase().endsWith('.json'));
  let scanned = 0;
  let deleted = 0;
  let bytesFreed = 0;

  for (const name of jsonFiles) {
    scanned++;
    const metadataPath = path.join(MEDIA_DIR, name);
    const metadata = safeJson(metadataPath);
    if (!metadata || !UUID_RE.test(String(metadata.id || '').trim())) continue;
    if (!isOldEnough(metadataPath, metadata)) continue;

    const imageCandidates = ['jpg', 'png', 'webp'].map(ext => path.join(MEDIA_DIR, `${metadata.id}.${ext}`));
    bytesFreed += deleteFile(metadataPath, dryRun);
    for (const filePath of imageCandidates) {
      bytesFreed += deleteFile(filePath, dryRun);
    }
    deleted++;
  }

  console.log(JSON.stringify({ scanned, deleted, bytesFreed, dryRun }));
}

main();
