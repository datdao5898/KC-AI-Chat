const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE_FILE = path.join(ROOT, 'data', 'products.csv');
const FACEBOOK_DIR = path.join(ROOT, 'data', 'sources', 'facebook');
const DEFAULT_PAGE_BRANDS = [
  ['1184640711390003', 'Synco'],
  ['260016447958834', 'Ulanzi']
];

function parseCsvLine(line) {
  const out = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      out.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  out.push(current);
  return out;
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function parsePageBrands(args) {
  if (!args.length) return DEFAULT_PAGE_BRANDS;
  return args.map(entry => {
    const separator = entry.indexOf(':');
    if (separator <= 0 || separator === entry.length - 1) {
      throw new Error(`Invalid page mapping "${entry}". Use pageId:brand.`);
    }
    return [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()];
  });
}

function main() {
  if (!fs.existsSync(SOURCE_FILE)) throw new Error(`Missing source file: ${SOURCE_FILE}`);

  const lines = fs.readFileSync(SOURCE_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error(`Source file has no products: ${SOURCE_FILE}`);

  const header = lines[0];
  const columns = parseCsvLine(header).map(normalize);
  const vendorIndex = columns.indexOf('vendor');
  if (vendorIndex < 0) throw new Error('CSV must include a vendor column.');

  const products = lines.slice(1).map(line => {
    const fields = parseCsvLine(line);
    return { line, vendor: normalize(fields[vendorIndex]) };
  });

  const mappings = parsePageBrands(process.argv.slice(2));
  for (const [pageId, brand] of mappings) {
    const rows = products.filter(product => product.vendor === normalize(brand)).map(product => product.line);
    const outputDir = path.join(FACEBOOK_DIR, pageId);
    const outputFile = path.join(outputDir, 'products.csv');
    const configFile = path.join(outputDir, 'source.json');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(outputFile, `${[header, ...rows].join('\n')}\n`, 'utf8');
    if (!fs.existsSync(configFile)) {
      fs.writeFileSync(configFile, `${JSON.stringify({ brand, strictProducts: true }, null, 2)}\n`, 'utf8');
    }
    console.log(`${pageId} -> ${brand}: ${rows.length} products`);
  }
}

main();
