const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const config = require('../config');
const Run = require('../models/Run');
const FileTask = require('../models/FileTask');

// Combine the "Summary" sheet from every downloaded workbook into one file,
// one sheet per seller. Adapted from process.js (combineSummaries).

const SUMMARY_SHEET = 'Summary';

// Excel sheet names: max 31 chars, cannot contain \ / ? * [ ] : and must be
// unique within the workbook. (Verbatim from process.js.)
function toSheetName(baseName, used) {
  let name = baseName.replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || 'Sheet';

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

// Build summary_<type>.xlsx from the run's successfully-downloaded files.
function buildSummaryWorkbook(runId, type, tasks) {
  const outWb = XLSX.utils.book_new();
  const used = new Set();
  let added = 0;
  let skipped = 0;

  for (const t of tasks) {
    if (!t.filePath || !fs.existsSync(t.filePath)) {
      skipped++;
      continue;
    }
    try {
      const wb = XLSX.readFile(t.filePath);
      if (!wb.SheetNames.includes(SUMMARY_SHEET)) {
        skipped++;
        continue;
      }
      const sheet = wb.Sheets[SUMMARY_SHEET];
      const sheetName = toSheetName(t.sellerName, used);
      XLSX.utils.book_append_sheet(outWb, sheet, sheetName);
      added++;
    } catch {
      skipped++;
    }
  }

  if (added === 0) {
    throw new Error('no "Summary" sheets found in the downloaded files');
  }

  const fileName = `summary_${type}.xlsx`;
  const outPath = path.join(config.storageDir, String(runId), fileName);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  XLSX.writeFile(outWb, outPath);

  return { filePath: outPath, fileName, sheetCount: added, skipped };
}

// Generate both the account and payout summaries for a run. Never throws.
async function generateRunSummaries(runId) {
  const run = await Run.findById(runId);
  if (!run) return;

  run.summaries.account.status = 'generating';
  run.summaries.payout.status = 'generating';
  await run.save();

  for (const type of ['account', 'payout']) {
    try {
      const tasks = await FileTask.find({ run: runId, type, status: 'done' })
        .sort({ sellerName: 1 })
        .lean();

      const result = buildSummaryWorkbook(runId, type, tasks);
      run.summaries[type] = {
        status: 'ready',
        filePath: result.filePath,
        fileName: result.fileName,
        sheetCount: result.sheetCount,
        skipped: result.skipped,
        error: null,
        generatedAt: new Date(),
      };
    } catch (err) {
      run.summaries[type] = {
        status: 'failed',
        filePath: null,
        fileName: null,
        sheetCount: 0,
        skipped: 0,
        error: err.message,
        generatedAt: new Date(),
      };
    }
    await run.save();
  }
}

module.exports = { generateRunSummaries };
