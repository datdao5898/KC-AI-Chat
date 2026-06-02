require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { db, initDb } = require('../src/db');

const sqlitePath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'kingcom_ai_agent.db'));
const tables = [
  'customers',
  'conversations',
  'messages',
  'intents',
  'knowledge_items',
  'processed_events',
  'staff_alerts'
];

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(String(value || ''))) throw new Error(`Invalid SQL identifier: ${value}`);
  return `"${value}"`;
}

async function targetColumns(table) {
  const { rows } = await db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1
    ORDER BY ordinal_position
  `, [table]);
  return new Set(rows.map(row => row.column_name));
}

async function migrateTable(sqlite, table) {
  const sourceColumns = sqlite.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map(row => row.name);
  const allowed = await targetColumns(table);
  const columns = sourceColumns.filter(column => allowed.has(column));
  const rows = sqlite.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all();
  if (!columns.length || !rows.length) {
    console.log(`[MIGRATE] ${table}: 0 rows`);
    return;
  }

  const names = columns.map(quoteIdentifier).join(', ');
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
  const sql = `INSERT INTO ${quoteIdentifier(table)} (${names}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
  const client = await db.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      const result = await client.query(sql, columns.map(column => row[column]));
      inserted += result.rowCount;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  console.log(`[MIGRATE] ${table}: ${inserted}/${rows.length} inserted`);
}

async function migrateSqliteToPostgres({ sourcePath = sqlitePath, closePool = true } = {}) {
  if (!fs.existsSync(sourcePath)) throw new Error(`SQLite file not found: ${sourcePath}`);
  console.log(`[MIGRATE] source: ${sourcePath}`);
  await initDb();
  const sqlite = new Database(sourcePath, { readonly: true });
  try {
    for (const table of tables) await migrateTable(sqlite, table);
  } finally {
    sqlite.close();
    if (closePool) await db.end();
  }
  console.log('[MIGRATE] SQLite data copied to PostgreSQL successfully');
}

if (require.main === module) {
  migrateSqliteToPostgres().catch(async err => {
    console.error('[MIGRATE] failed:', err.message);
    await db.end().catch(() => {});
    process.exit(1);
  });
}

module.exports = { migrateSqliteToPostgres, migrateTable };
