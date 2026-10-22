const fs = require('fs');
const { resolveSourcePaths } = require('./sourceRegistry');

// Customer-facing answers are quoted from "## <heading>" sections of the source's
// markdown knowledge files (faq.md, policies.md). The first file found for the
// source is used whole: no truncation and no merge with common, so a source never
// borrows another brand's policy. Lines starting with "[nội bộ]" are notes for the
// bot/staff and are never sent to customers.
const INTERNAL_LINE = /^\[(noi bo|internal)\]/;

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-z0-9\s[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readKnowledgeFile(name, sourceKey = '') {
  for (const file of resolveSourcePaths(name, sourceKey)) {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  }
  return '';
}

function parseSections(markdown = '') {
  const sections = [];
  let current = null;
  for (const rawLine of String(markdown || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = line.match(/^#{2,6}\s+(.+)$/);
    if (heading) {
      current = { heading: heading[1].trim(), key: normalizeText(heading[1]), lines: [] };
      sections.push(current);
      continue;
    }
    if (!current || !line) continue;
    const text = line.replace(/^[-*]\s+/, '');
    if (INTERNAL_LINE.test(normalizeText(text))) continue;
    current.lines.push(text);
  }
  return sections.filter(section => section.lines.length);
}

// headingPattern is matched against the accent-free, lower-case heading text.
function findSection(sourceKey = '', headingPattern, files = ['policies.md', 'faq.md']) {
  for (const file of files) {
    const section = parseSections(readKnowledgeFile(file, sourceKey))
      .find(item => headingPattern.test(item.key));
    if (section) return { ...section, file };
  }
  return null;
}

function sectionText(section) {
  return (section?.lines || []).map(line => `- ${line}`).join('\n');
}

module.exports = {
  normalizeText,
  readKnowledgeFile,
  parseSections,
  findSection,
  sectionText
};
