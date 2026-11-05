// Repairs customer profiles saved before tax codes and company words were told apart from
// phones and names. Lists the changes by default; pass --apply to write them.
//   node scripts/repair-misparsed-customers.js [--apply]
require('dotenv').config();
const { db } = require('../src/db');
const { extractCustomerInfo, isValidVnPhone, digitsOf } = require('../src/customerInfo');

// Names the old parser made from "Địa chỉ ...", "Cổ phần" and similar words. Every entry was
// seen in real messages; a real person's name is never matched by a pattern here.
const MISREAD_NAME = /^(?:chi (?:cong|moi|tru|so|xuat|giao|nhan|lien|hoat)|co (?:phan|the|tuy)|chu the|anh (?:co|vua)|chị nha|gì ạ)$/i;

function changesFor(customer, inboundTexts) {
  const infos = inboundTexts.map(extractCustomerInfo);
  const invoice = [...infos].reverse().find(info => info.isInvoiceInfo);
  const changes = {};

  const phone = digitsOf(customer.phone);
  const taxCodes = new Set(infos.map(info => digitsOf(info.taxCode)).filter(Boolean));
  const phoneIsTaxCode = phone && [...taxCodes].some(code => code.startsWith(phone));
  if (phone && (phoneIsTaxCode || !isValidVnPhone(phone))) {
    // A number the customer explicitly gave as a phone stays, whatever its prefix.
    if (phoneIsTaxCode || !infos.some(info => digitsOf(info.phone) === phone)) changes.phone = '';
  }
  if (MISREAD_NAME.test(String(customer.name || '').trim())) changes.name = '';

  if (invoice) {
    if (!customer.company_name && invoice.companyName) changes.company_name = invoice.companyName;
    if (!customer.tax_code && invoice.taxCode) changes.tax_code = invoice.taxCode;
    if (!customer.company_address && invoice.companyAddress) changes.company_address = invoice.companyAddress;
    if (!customer.invoice_email && invoice.invoiceEmail) changes.invoice_email = invoice.invoiceEmail;
  }
  return changes;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { rows: customers } = await db.query(`
    SELECT id, channel, external_id, name, phone, company_name, tax_code, company_address, invoice_email FROM customers
  `);
  let changed = 0;
  for (const customer of customers) {
    const { rows } = await db.query(
      `SELECT text FROM messages WHERE customer_id=$1 AND direction='in' AND deleted_at IS NULL ORDER BY created_at`,
      [customer.id]
    );
    const changes = changesFor(customer, rows.map(row => row.text));
    const columns = Object.keys(changes);
    if (!columns.length) continue;
    changed += 1;
    console.log(`${customer.channel}/${customer.external_id} (name: ${customer.name || '-'}, phone: ${customer.phone || '-'})`);
    for (const column of columns) console.log(`  ${column}: ${JSON.stringify(customer[column] || '')} -> ${JSON.stringify(changes[column])}`);
    if (apply) {
      const assignments = columns.map((column, index) => `${column}=$${index + 2}`).join(', ');
      await db.query(`UPDATE customers SET ${assignments}, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [customer.id, ...columns.map(column => changes[column])]);
    }
  }
  console.log(`${apply ? 'Updated' : 'Would update'} ${changed} of ${customers.length} customers.`);
  await db.end();
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { changesFor };
