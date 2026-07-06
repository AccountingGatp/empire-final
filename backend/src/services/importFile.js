const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const Run = require('../models/Run');
const storage = require('./storage');

// Combined + modified from import_file.js and import_final.js.
// Reads the account summary workbook (summary_account.xlsx, one revenue sheet
// per location) and writes a SINGLE final QBO/SaasAnt import workbook:
//   Empire_Xola_JE_<MONTH>_Import.xlsx
// i.e. it skips the intermediate Empire_Xola_JE_<MONTH>.xlsx entirely.

const CURRENCY = 'USD';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ---- Accounts (posting order) ----------------------------------------------
const ACCOUNTS = {
  net: 'Sales Clearing Account',
  processing: '40002.2 Processing Fees - Xola',
  service: '40001.1 Service Fees',
  gross: '40001 Sales Revenue - Xola',
};

// Restore the account number on the clearing account for the import (import_final).
const ACCOUNT_FINAL = {
  'Sales Clearing Account': '10029 Sales Clearing Account',
};

// ---- Class mapping, keyed by (normalized) sheet name (import_file.js) -------
const SHEET_CLASS = {
  Amsterdam_Tours: 'Empire Tours:Amsterdam',
  Austin_Tours: 'Empire Tours:Austin',
  Charleston_Tour_Company: 'Empire Tours:Charleston',
  Chicago_Discount_Tours: 'Empire Tours:Chicago',
  Chicago_Gangsters_and_Ghosts_To: 'Empire Tours:Chicago',
  Chicago_Private_Boat_Tours: 'Empire Tours:Chicago:Chicago Private',
  Chicago_Private_Tours: 'Empire Tours:Chicago',
  Chicago_River_Boat_Architecture: 'Empire Tours:Chicago:Chicago Boats',
  Italy_Tours: 'Empire Tours:Milan',
  London_Sightseeing_Tours: 'Empire Tours:London',
  NYC_Discount_Tours: 'NYC',
  NYC_Gangsters_and_Ghosts_Tours: 'NYC',
  Ohio_Cabins: 'Empire Tours:Ohio',
  Paris_Tours: 'Empire Tours:Paris',
  See_It_All_Chicago_Tours_LLC: 'Empire Tours:SIA',
  Tours_of_NYC: 'NYC',
  ToursOfNYC: 'NYC',
  Washington_DC_Sightseeing_Tours: 'Empire Tours:Washington DC',
  Wisconsin_Lodges: 'Empire Tours:Wisconsin',
};

// Codes that were inferred (not confirmed) — warn on use.
const UNCONFIRMED = new Set(['Austin_Tours', 'Ohio_Cabins', 'Wisconsin_Lodges']);

// ---- Styling ---------------------------------------------------------------
const FONT = 'Arial';
const NAVY = 'FF1F3864';
const WHITE = 'FFFFFFFF';
const MONEY = '#,##0.00;(#,##0.00)';

// ---- Helpers ---------------------------------------------------------------
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const CLASS_LOOKUP = new Map(Object.entries(SHEET_CLASS).map(([k, v]) => [norm(k), v]));

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// Sign rule: positive -> natural column; negative -> abs value in opposite column.
function place(amount, naturalSide) {
  const debitNatural = naturalSide === 'debit';
  if (amount >= 0) {
    return debitNatural ? { debit: amount, credit: null } : { debit: null, credit: amount };
  }
  const abs = Math.abs(amount);
  return debitNatural ? { debit: null, credit: abs } : { debit: abs, credit: null };
}

// Aggregate one revenue sheet (Method | Gross | Processing Fee | Service Fee | …).
function parseRevenueSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
  const headerIdx = rows.findIndex(
    (r) => r.some((c) => norm(c) === 'method') && r.some((c) => norm(c) === 'gross')
  );
  if (headerIdx === -1) return null;

  let gross = 0;
  let processing = 0;
  let service = 0;
  for (const r of rows.slice(headerIdx + 1)) {
    const method = String(r[0] || '').trim();
    if (!method || norm(method) === 'total') continue;
    gross += num(r[1]);
    processing += num(r[2]);
    service += num(r[3]);
  }
  return { gross: round2(gross), processing: round2(processing), service: round2(service) };
}

// Period metadata derived from a 'YYYY-MM' run month.
function periodMeta(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(month || '');
  if (!m) throw new Error(`bad month "${month}"`);
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  const monthName = MONTHS[monthIndex];
  const label = `${monthName} ${year}`;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return {
    label,
    journalNo: `JE-${monthName.slice(0, 3).toUpperCase()}${year}-XOLA`,
    // Final import date format: M/D/YYYY, no leading zeros (import_final.formatDate).
    journalDate: `${monthIndex + 1}/${lastDay}/${year}`,
    fileName: `Empire_Xola_JE_${label.replace(/ /g, '_')}_Import.xlsx`,
  };
}

// Build the flat journal-entry lines from the account summary workbook.
function buildLines(wb, meta) {
  const lines = [];
  const warnings = [];

  for (const sheetName of wb.SheetNames) {
    const agg = parseRevenueSheet(wb.Sheets[sheetName]);
    if (!agg) continue;

    const net = round2(agg.gross - agg.processing - agg.service);
    if ([net, agg.gross, agg.processing, agg.service].every((v) => Math.abs(v) < 0.005)) {
      continue; // no activity
    }

    const desc = sheetName.replace(/_/g, ' ');
    const klass = CLASS_LOOKUP.get(norm(sheetName));
    if (klass === undefined) {
      warnings.push(`No class for "${sheetName}" — left blank, needs a class decision.`);
    } else if (UNCONFIRMED.has(sheetName)) {
      warnings.push(`Class for "${sheetName}" (${klass}) is inferred — confirm before posting.`);
    }
    const classValue = klass || '';

    const posts = [
      { account: ACCOUNTS.net, amount: net, side: 'debit', text: `Xola net payout - ${desc}` },
      { account: ACCOUNTS.processing, amount: agg.processing, side: 'debit', text: `Xola processing fees - ${desc}` },
      { account: ACCOUNTS.service, amount: agg.service, side: 'debit', text: `Xola service fees - ${desc}` },
      { account: ACCOUNTS.gross, amount: agg.gross, side: 'credit', text: `Xola gross sales - ${desc}` },
    ];

    for (const p of posts) {
      if (Math.abs(p.amount) < 0.005) continue; // skip zero lines
      const { debit, credit } = place(p.amount, p.side);
      lines.push({
        journalNo: meta.journalNo,
        journalDate: meta.journalDate,
        // Restore the account number on the clearing account (import_final).
        account: ACCOUNT_FINAL[p.account] || p.account,
        debit,
        credit,
        description: p.text,
        name: '',
        currency: CURRENCY,
        location: '',
        class: classValue,
      });
    }
  }

  return { lines, warnings };
}

// Build the single final import workbook (import_final format/styling) as a buffer.
async function writeFinalImport(lines) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GATP Solutions';
  const ws = wb.addWorksheet('Journal Entry', { views: [{ state: 'frozen', ySplit: 1 }] });

  const headers = [
    '*JournalNo', '*JournalDate', '*AccountName', '*Debits', '*Credits',
    'Description', 'Name', 'Currency', 'Location', 'Class',
  ];
  const hr = ws.addRow(headers);
  hr.eachCell((cell) => {
    cell.font = { name: FONT, bold: true, color: { argb: WHITE }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });

  ws.columns = [
    { width: 18 }, { width: 13 }, { width: 32 }, { width: 14 }, { width: 14 },
    { width: 42 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 30 },
  ];

  for (const l of lines) {
    const row = ws.addRow([
      l.journalNo, l.journalDate, l.account, l.debit, l.credit,
      l.description, l.name, l.currency, l.location, l.class,
    ]);
    row.eachCell({ includeEmpty: true }, (cell) => {
      if (!cell.font || !cell.font.name) cell.font = { name: FONT, size: 10 };
    });
    row.getCell(4).numFmt = MONEY;
    row.getCell(5).numFmt = MONEY;
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Generate the import file for a run. Never throws.
async function generateImportFile(runId) {
  const run = await Run.findById(runId);
  if (!run) return;

  run.importFile.status = 'generating';
  run.importFile.error = null;
  await run.save();

  try {
    // The revenue report (Method | Gross | Processing | Service | Net) is the
    // transactions export, labeled 'account'. The Sales Revenue JE is built from it.
    const summaryKey = run.summaries?.account?.storageKey;
    if (!summaryKey) {
      throw new Error('account summary not found — generate the summary first');
    }

    const buf = await storage.getObjectBuffer(summaryKey);
    const wb = XLSX.read(buf, { type: 'buffer' });

    const meta = periodMeta(run.month);
    const { lines, warnings } = buildLines(wb, meta);
    if (!lines.length) {
      throw new Error('no journal lines produced from the account summary');
    }

    const totalDebit = round2(lines.reduce((s, l) => s + (l.debit || 0), 0));
    const totalCredit = round2(lines.reduce((s, l) => s + (l.credit || 0), 0));
    const balanced = round2(totalDebit - totalCredit) === 0;

    const buffer = await writeFinalImport(lines);
    const key = `runs/${runId}/${meta.fileName}`;
    await storage.putObject(key, buffer);

    run.importFile = {
      status: 'ready',
      fileName: meta.fileName,
      storageKey: key,
      lineCount: lines.length,
      totalDebit,
      totalCredit,
      balanced,
      warnings,
      error: null,
      generatedAt: new Date(),
    };
    await run.save();
  } catch (err) {
    run.importFile.status = 'failed';
    run.importFile.error = err.message;
    await run.save();
  }
}

module.exports = { generateImportFile };
