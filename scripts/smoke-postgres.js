require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('pg');

function postgresConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'true'
        ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' }
        : undefined
    };
  }

  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: process.env.PGSSL === 'true'
      ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' }
      : undefined
  };
}

async function tableSummary(client, table) {
  const exists = await client.query('SELECT to_regclass($1) AS regclass', [`public.${table}`]);
  const present = Boolean(exists.rows[0]?.regclass);
  if (!present) return { exists: false, count: null };
  const count = await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
  return { exists: true, count: Number(count.rows[0]?.count || 0) };
}

async function main() {
  const client = new Client(postgresConfig());
  await client.connect();
  try {
    const connection = await client.query('SELECT 1 AS ok, version() AS version');
    const tables = {};
    for (const table of ['customers', 'conversations', 'messages', 'staff_alerts']) {
      tables[table] = await tableSummary(client, table);
    }

    const payload = {
      ok: Number(connection.rows[0]?.ok || 0) === 1,
      database: {
        connected: true,
        version: String(connection.rows[0]?.version || '')
      },
      tables
    };

    console.log(JSON.stringify(payload));
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch(err => {
  console.error('[SMOKE] failed:', err.message);
  process.exit(1);
});
