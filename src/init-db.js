require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { initDb } = require('./db');
initDb()
  .then(() => {
    console.log('✅ KingCom AI Agent PostgreSQL DB ready');
    process.exit(0);
  })
  .catch(err => {
    console.error('PostgreSQL init failed:', err.message);
    process.exit(1);
  });
