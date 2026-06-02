# PostgreSQL Setup

The app runtime now uses PostgreSQL. The old SQLite file is kept as a migration source and rollback backup.

## 1. Create database

Create a PostgreSQL database and user. Example:

```sql
CREATE USER kingcom WITH PASSWORD 'replace-with-a-strong-password';
CREATE DATABASE kingcom_ai_agent OWNER kingcom;
```

## 2. Configure `.env`

```env
DATABASE_URL=postgresql://kingcom:replace-with-a-strong-password@127.0.0.1:5432/kingcom_ai_agent
PGSSL=false
```

Use `PGSSL=true` only when the PostgreSQL provider requires TLS.

## 3. Install dependencies

```bash
npm install
```

## 4. Migrate the existing SQLite data

Keep the original `kingcom_ai_agent.db` file, then run:

```bash
npm run migrate-sqlite-to-postgres
```

The migration is idempotent: existing rows are skipped.

## 5. Start the app

```bash
npm start
```

Check:

```bash
curl http://localhost:8650/health
```

## Backup

Use PostgreSQL backups after migration:

```bash
pg_dump -Fc "$DATABASE_URL" > kingcom_ai_agent.dump
```
