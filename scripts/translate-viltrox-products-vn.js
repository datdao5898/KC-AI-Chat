require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'data', 'sources', 'facebook', '260016447958834');
const SOURCE_FILE = path.join(SOURCE_DIR, 'products.csv');
const TEMP_FILE = path.join(SOURCE_DIR, 'products.csv.vn.part');
const BACKUP_ROOT = path.join(ROOT, 'backups', 'training');
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const API_KEY = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || '';

function parseCsv(text) {
  const input = String(text || '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      if (row.some(value => String(value || '').trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }

  row.push(cell);
  if (row.some(value => String(value || '').trim() !== '')) rows.push(row);
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map(h => h.trim());
  const parsedRows = rows.slice(1).map(vals => {
    const row = {};
    headers.forEach((h, index) => { row[h] = vals[index] || ''; });
    return row;
  });
  return { headers, rows: parsedRows };
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeCsv(headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(header => csvEscape(row[header] ?? '')).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

async function translateRow(row) {
  if (!API_KEY) throw new Error('Missing OPENAI_API_KEY / OPENROUTER_API_KEY');
  const prompt = `Bạn là công cụ dịch dữ liệu sản phẩm sang tiếng Việt cho hệ thống CSKH Viltrox.

Yêu cầu:
- Chỉ dịch các trường "product_type" và "description" sang tiếng Việt tự nhiên.
- Giữ nguyên "sku", "name", "vendor", "price", "url", "tags" vì đó là mã định danh và dữ liệu catalog.
- Giữ nguyên số, đơn vị, tên model, thương hiệu, đường link và thông số kỹ thuật.
- Không thêm bình luận.
- Trả về đúng định dạng sau, không thêm gì khác:
sku: <giữ nguyên sku>
product_type: <bản dịch tiếng Việt của product_type>
[[DESC_BEGIN]]
<bản dịch tiếng Việt của description>
[[DESC_END]]

Dữ liệu:
${JSON.stringify(row, null, 2)}`;

  const body = {
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1
  };
  body[BASE_URL.includes('openrouter') ? 'max_tokens' : 'max_completion_tokens'] = 6000;

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
      ...(BASE_URL.includes('openrouter') && process.env.OPENROUTER_HTTP_REFERER ? { 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER } : {}),
      ...(BASE_URL.includes('openrouter') && process.env.OPENROUTER_TITLE ? { 'X-Title': process.env.OPENROUTER_TITLE } : {})
    },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Translation request failed ${res.status}: ${raw.slice(0, 1000)}`);

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Translation API returned invalid JSON');
  }
  const content = data?.choices?.[0]?.message?.content || '';
  const match = content.match(/sku:\s*(.*?)\s*product_type:\s*([^\n\r]+)\s*\[\[DESC_BEGIN\]\]\s*([\s\S]*?)\s*\[\[DESC_END\]\]/i);
  if (!match) throw new Error(`Could not parse translation text: ${content.slice(0, 500)}`);
  return {
    sku: match[1].trim(),
    product_type: match[2].trim(),
    description: match[3].trim()
  };
}

async function main() {
  const source = fs.readFileSync(SOURCE_FILE, 'utf8');
  const { headers, rows } = parseCsv(source);
  if (!headers.length || !rows.length) throw new Error('products.csv is empty');

  const backupDir = path.join(BACKUP_ROOT, `facebook-260016447958834-before-vn-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(SOURCE_FILE, path.join(backupDir, 'products.csv'));

  let translatedRows = [];
  let startIndex = 0;
  if (fs.existsSync(TEMP_FILE)) {
    const tempParsed = parseCsv(fs.readFileSync(TEMP_FILE, 'utf8'));
    if (tempParsed.rows.length) {
      translatedRows = tempParsed.rows;
      startIndex = translatedRows.length;
      console.log(`[resume] continuing from row ${startIndex + 1}`);
    }
  }

  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i];
    const payload = {
      sku: row.sku || '',
      name: row.name || '',
      product_type: row.product_type || '',
      description: row.description || '',
      vendor: row.vendor || '',
      tags: row.tags || ''
    };
    const translated = await translateRow(payload);
    translatedRows.push({
      ...row,
      product_type: translated.product_type || row.product_type || '',
      description: translated.description || row.description || ''
    });
    fs.writeFileSync(TEMP_FILE, writeCsv(headers, translatedRows), 'utf8');
    console.log(`[${i + 1}/${rows.length}] translated ${row.sku || row.name || ''}`);
  }

  fs.writeFileSync(SOURCE_FILE, writeCsv(headers, translatedRows), 'utf8');
  if (fs.existsSync(TEMP_FILE)) fs.unlinkSync(TEMP_FILE);
  console.log(JSON.stringify({ ok: true, backupDir, rows: translatedRows.length }, null, 2));
}

main().catch(err => {
  console.error('[translate-viltrox-products-vn] failed:', err.message);
  process.exit(1);
});
