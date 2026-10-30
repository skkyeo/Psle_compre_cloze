// Checks data/words.js for mistakes. Run: node tools/validate.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../data/words.js"), "utf8"), sandbox);
const { WORD_ROWS: rows, CATEGORIES: cats } = sandbox.window;

const errors = [];
const seen = new Set();
rows.forEach((r, i) => {
  const [word, cat, level, meaning, example, alts] = r;
  const at = `row ${i + 1} (${word})`;
  if (!word || !meaning || !example) errors.push(`${at}: missing field`);
  if (!cats[cat]) errors.push(`${at}: unknown category ${cat}`);
  if (![1, 2, 3].includes(level)) errors.push(`${at}: level must be 1-3`);
  const blanks = (example.match(/\[\[.+?\]\]/g) || []).length;
  if (blanks !== 1) errors.push(`${at}: example needs exactly one [[blank]], found ${blanks}`);
  if (alts !== undefined && !Array.isArray(alts)) errors.push(`${at}: alternatives must be an array`);
  const key = word.toLowerCase();
  if (seen.has(key)) errors.push(`${at}: duplicate headword`);
  seen.add(key);
});

const perCat = {};
rows.forEach((r) => { perCat[r[1]] = (perCat[r[1]] || 0) + 1; });
console.log(`${rows.length} words`);
Object.entries(perCat).forEach(([c, n]) => console.log(`  ${cats[c]}: ${n}`));
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("OK");
