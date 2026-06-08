const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOG_FILES = [
  'ai_responses.log',
  'staff_alerts.log'
];

function maxBytes() {
  return Math.max(1024 * 1024, Number(process.env.LOG_ROTATE_MAX_BYTES || 10 * 1024 * 1024));
}

function keepCount() {
  return Math.max(1, Number(process.env.LOG_ROTATE_KEEP || 5));
}

function formatTimestamp(date = new Date()) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}`;
}

function rotatedPattern(baseName) {
  const safe = baseName.replace(/\.log$/i, '');
  return new RegExp(`^${safe}\\.\\d{8}T\\d{6}\\.log$`);
}

function currentLogPath(name) {
  return path.join(DATA_DIR, name);
}

function rotatedPath(baseName, stamp) {
  const stem = baseName.replace(/\.log$/i, '');
  return path.join(DATA_DIR, `${stem}.${stamp}.log`);
}

function cleanupRotatedFiles(baseName, keep, dryRun) {
  const dir = DATA_DIR;
  const pattern = rotatedPattern(baseName);
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(file => pattern.test(file)).sort().reverse()
    : [];
  const removed = [];
  for (const file of files.slice(keep)) {
    const fullPath = path.join(dir, file);
    removed.push(file);
    if (!dryRun) fs.rmSync(fullPath, { force: true });
  }
  return removed;
}

function rotateOne(baseName, dryRun) {
  const filePath = currentLogPath(baseName);
  const summary = {
    file: baseName,
    exists: false,
    size: 0,
    rotatedTo: null,
    removed: []
  };

  if (!fs.existsSync(filePath)) {
    summary.removed = cleanupRotatedFiles(baseName, keepCount(), dryRun);
    return summary;
  }

  const stat = fs.statSync(filePath);
  summary.exists = true;
  summary.size = stat.size;

  if (stat.size <= maxBytes()) {
    summary.removed = cleanupRotatedFiles(baseName, keepCount(), dryRun);
    return summary;
  }

  const stamp = formatTimestamp();
  const target = rotatedPath(baseName, stamp);
  summary.rotatedTo = path.basename(target);
  if (!dryRun) {
    fs.renameSync(filePath, target);
    fs.writeFileSync(filePath, '', 'utf8');
  }
  summary.removed = cleanupRotatedFiles(baseName, keepCount(), dryRun);
  return summary;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const summary = {
    dryRun,
    maxBytes: maxBytes(),
    keep: keepCount(),
    files: LOG_FILES.map(name => rotateOne(name, dryRun))
  };
  console.log(JSON.stringify(summary));
}

main();
