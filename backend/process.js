const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const SUMMARY_SHEET = 'Summary';

// Excel sheet names: max 31 chars, cannot contain \ / ? * [ ] : and must be unique.
function toSheetName(baseName, used) {
  let name = baseName.replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || 'Sheet';

  // Ensure uniqueness within the workbook.
  if (used.has(name)) {
    let i = 2;
    let candidate;
    do {
      const suffix = `_${i}`;
      candidate = name.slice(0, 31 - suffix.length) + suffix;
      i++;
    } while (used.has(candidate));
    name = candidate;
  }

  used.add(name);
  return name;
}

// Read the "Summary" sheet from every xlsx in `inDir` and combine them into
// one workbook, one sheet per source file (sheet named after the file).
// function combineSummaries(inDir = 'downloads_payout', outFile = 'summary_payout.xlsx') {
function combineSummaries(inDir = 'downloads', outFile = 'summary.xlsx') {
  const files = fs
    .readdirSync(inDir)
    .filter((f) => f.toLowerCase().endsWith('.xlsx') && f !== path.basename(outFile));

  const outWb = XLSX.utils.book_new();
  const used = new Set();
  let added = 0;

  for (const file of files) {
    const filePath = path.join(inDir, file);
    try {
      const wb = XLSX.readFile(filePath);

      if (!wb.SheetNames.includes(SUMMARY_SHEET)) {
        console.warn(`Skipping "${file}": no "${SUMMARY_SHEET}" sheet found.`);
        continue;
      }

      const sheet = wb.Sheets[SUMMARY_SHEET];
      const sheetName = toSheetName(path.parse(file).name, used);

      XLSX.utils.book_append_sheet(outWb, sheet, sheetName);
      console.log(`Added "${file}" -> sheet "${sheetName}"`);
      added++;
    } catch (err) {
      console.error(`Failed to read "${file}":`, err.message);
    }
  }

  if (added === 0) {
    console.warn('No summary sheets found; nothing written.');
    return;
  }

  XLSX.writeFile(outWb, outFile);
  console.log(`\nCombined ${added} summaries into ${outFile}`);
}

combineSummaries();

module.exports = { combineSummaries };
