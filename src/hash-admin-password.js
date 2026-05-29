const { hashPassword } = require('./adminAuth');

const password = process.argv.slice(2).join(' ');
if (!password) {
  console.error('Usage: node src/hash-admin-password.js "your password"');
  process.exit(1);
}

console.log(hashPassword(password));
