const fs = require('fs');
const path = require('path');
const { SOURCES_DIR } = require('../../src/sourceRegistry');

// A website source frozen as NewLite looked before its policies, contacts and catalog
// sync were set up: the crawled products.csv (with per-branch stock) plus FAQ/policies
// that have no contacts, warranty or technical section. Tests that pin catalog prices
// or "no data, hand off" behaviour run against it instead of the live website/newlite.
const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'newlite-unverified');
const CRAWLED_CATALOG = path.join(SOURCES_DIR, 'website', 'newlite', 'products.csv');

let counter = 0;

async function withNewliteFixture(fn) {
  const sourceId = `newlite-fixture-${process.pid}-${counter += 1}`;
  const dir = path.join(SOURCES_DIR, 'website', sourceId);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(CRAWLED_CATALOG, path.join(dir, 'products.csv'));
  for (const name of ['faq.md', 'policies.md']) fs.copyFileSync(path.join(FIXTURE_DIR, name), path.join(dir, name));
  try {
    return await fn(`website/${sourceId}`, sourceId);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { withNewliteFixture };
