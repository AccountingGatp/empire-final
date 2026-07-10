import XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import config from '../config.js';
import Run from '../models/Run.js';
import FileTask from '../models/FileTask.js';
import * as storage from './storage.js';

// Combined + modified from import_file.js and import_final.js.
// Builds the SINGLE final QBO/SaasAnt import workbook Empire_Xola_JE_<MONTH>_Import.xlsx.
// Two modes:
//   - standard  : amounts as reported (per-location currency), from summary_account.xlsx
//   - converted : every currency converted to USD (frankfurter.dev rates), read from
//                 each seller's account file (the Transactions sheet carries the currency)

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
const pad2 = (n) => String(n).padStart(2, '0');
const CLASS_LOOKUP = new Map(Object.entries(SHEET_CLASS).map(([k, v]) => [norm(k), v]));

// Same sheet-name derivation summary.js uses (so class lookup + descriptions match).
const toSheetName = (name) =>
  String(name || '').replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || 'Sheet';

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

// The seller's currency, from the Transactions sheet's "Currency" column.
function readCurrencyFromWorkbook(wb) {
  const ws = wb.Sheets.Transactions;
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
  if (!rows.length) return null;
  const header = (rows[0] || []).map(norm);
  const idx = header.findIndex((h) => h === 'currency');
  if (idx === -1) return null;
  for (const r of rows.slice(1)) {
    const c = String(r[idx] || '').trim();
    if (c) return c;
  }
  return null;
}

// Rate to convert `currency` into USD, averaged over the month's business days
// (frankfurter.dev time-series). null if unavailable.
async function getRate(currency, from, to, cache) {
  const cur = String(currency || '').toUpperCase();
  if (cur === 'USD' || !cur) return 1;
  if (cache.has(cur)) return cache.get(cur);
  let rate = null;
  try {
    const res = await fetch(`${config.frankfurterBase}/${from}..${to}?base=${cur}&symbols=USD`);
    if (res.ok) {
      const data = await res.json();
      const daily = Object.values(data?.rates || {})
        .map((d) => d && d.USD)
        .filter((r) => typeof r === 'number');
      if (daily.length) {
        rate = Number((daily.reduce((s, r) => s + r, 0) / daily.length).toFixed(6));
      }
    }
  } catch {
    rate = null;
  }
  cache.set(cur, rate);
  return rate;
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
    // Month range used to average the FX rate over the period.
    rateFrom: `${year}-${pad2(monthIndex + 1)}-01`,
    rateTo: `${year}-${pad2(monthIndex + 1)}-${pad2(lastDay)}`,
    fileName: `Empire_Xola_JE_${label.replace(/ /g, '_')}_Import.xlsx`,
  };
}

// The up-to-4 journal lines for one location, given its aggregated amounts.
function postsForSheet(sheetName, agg, meta) {
  const lines = [];
  const warnings = [];

  const net = round2(agg.gross - agg.processing - agg.service);
  if ([net, agg.gross, agg.processing, agg.service].every((v) => Math.abs(v) < 0.005)) {
    return { lines, warnings }; // no activity
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

  return { lines, warnings };
}

// Standard build: amounts as reported, from the combined account summary workbook.
function buildLines(wb, meta) {
  const lines = [];
  const warnings = [];
  for (const sheetName of wb.SheetNames) {
    const agg = parseRevenueSheet(wb.Sheets[sheetName]);
    if (!agg) continue;
    const r = postsForSheet(sheetName, agg, meta);
    lines.push(...r.lines);
    warnings.push(...r.warnings);
  }
  return { lines, warnings };
}

// Converted build: read each seller's account file, convert its amounts to USD.
async function buildLinesConverted(accountTasks, meta) {
  const lines = [];
  const warnings = [];
  const rateCache = new Map();
  const ratesUsed = {};

  const tasks = [...accountTasks].sort((a, b) =>
    String(a.sellerName).localeCompare(String(b.sellerName))
  );

  for (const t of tasks) {
    if (!t.storageKey) continue;
    let wb;
    try {
      wb = XLSX.read(await storage.getObjectBuffer(t.storageKey), { type: 'buffer' });
    } catch {
      warnings.push(`Could not read file for "${t.sellerName}" — skipped.`);
      continue;
    }
    const ws = wb.Sheets.Summary;
    if (!ws) continue;
    const agg = parseRevenueSheet(ws);
    if (!agg) continue;

    const currency = (readCurrencyFromWorkbook(wb) || 'USD').toUpperCase();
    let rate = 1;
    if (currency !== 'USD') {
      rate = await getRate(currency, meta.rateFrom, meta.rateTo, rateCache);
      if (rate == null) {
        warnings.push(`No FX rate for ${currency} ("${t.sellerName}") — left in ${currency}.`);
        rate = 1;
      } else {
        ratesUsed[currency] = rate;
      }
    }

    const converted = {
      gross: round2(agg.gross * rate),
      processing: round2(agg.processing * rate),
      service: round2(agg.service * rate),
    };

    const r = postsForSheet(toSheetName(t.sellerName), converted, meta);
    // Tag each line with the source currency + rate used (for the FX columns).
    for (const l of r.lines) lines.push({ ...l, sourceCurrency: currency, rate });
    warnings.push(...r.warnings);
  }

  return { lines, warnings, ratesUsed };
}

// Build the single final import workbook (import_final format/styling) as a buffer.
// `withFx` appends "Source Currency" and "Rate" columns (for the converted import).
async function writeFinalImport(lines, { withFx = false } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GATP Solutions';
  const ws = wb.addWorksheet('Journal Entry', { views: [{ state: 'frozen', ySplit: 1 }] });

  const headers = [
    '*JournalNo', '*JournalDate', '*AccountName', '*Debits', '*Credits',
    'Description', 'Name', 'Currency', 'Location', 'Class',
    ...(withFx ? ['Source Currency', 'Rate'] : []),
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
    ...(withFx ? [{ width: 15 }, { width: 10 }] : []),
  ];

  for (const l of lines) {
    const row = ws.addRow([
      l.journalNo, l.journalDate, l.account, l.debit, l.credit,
      l.description, l.name, l.currency, l.location, l.class,
      ...(withFx ? [l.sourceCurrency || '', l.rate ?? ''] : []),
    ]);
    row.eachCell({ includeEmpty: true }, (cell) => {
      if (!cell.font || !cell.font.name) cell.font = { name: FONT, size: 10 };
    });
    row.getCell(4).numFmt = MONEY;
    row.getCell(5).numFmt = MONEY;
    if (withFx) row.getCell(12).numFmt = '0.0000'; // Rate
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Generate the import file for a run. `convert` -> the all-USD variant. Never throws.
async function generateImportFile(runId, { convert = false } = {}) {
  const run = await Run.findById(runId);
  if (!run) return;
  const field = convert ? 'importFileUsd' : 'importFile';

  run[field].status = 'generating';
  run[field].error = null;
  await run.save();

  try {
    const meta = periodMeta(run.month);
    let lines;
    let warnings;
    let ratesUsed = null;
    let fileName;

    if (convert) {
      const accountTasks = await FileTask.find({
        run: runId,
        type: 'account',
        status: 'done',
      }).lean();
      if (!accountTasks.length) throw new Error('no downloaded account files to convert');
      const built = await buildLinesConverted(accountTasks, meta);
      lines = built.lines;
      warnings = built.warnings;
      ratesUsed = built.ratesUsed;
      fileName = `Empire_Xola_JE_${meta.label.replace(/ /g, '_')}_Import_USD.xlsx`;
    } else {
      const summaryKey = run.summaries?.account?.storageKey;
      if (!summaryKey) throw new Error('account summary not found — generate the summary first');
      const wb = XLSX.read(await storage.getObjectBuffer(summaryKey), { type: 'buffer' });
      const built = buildLines(wb, meta);
      lines = built.lines;
      warnings = built.warnings;
      fileName = meta.fileName;
    }

    if (!lines.length) throw new Error('no journal lines produced');

    const totalDebit = round2(lines.reduce((s, l) => s + (l.debit || 0), 0));
    const totalCredit = round2(lines.reduce((s, l) => s + (l.credit || 0), 0));
    const balanced = round2(totalDebit - totalCredit) === 0;

    const buffer = await writeFinalImport(lines, { withFx: convert });
    const key = `runs/${runId}/${fileName}`;
    await storage.putObject(key, buffer);

    run[field] = {
      status: 'ready',
      fileName,
      storageKey: key,
      lineCount: lines.length,
      totalDebit,
      totalCredit,
      balanced,
      warnings,
      rates: ratesUsed,
      error: null,
      generatedAt: new Date(),
    };
    await run.save();
  } catch (err) {
    run[field].status = 'failed';
    run[field].error = err.message;
    await run.save();
  }
}

export { generateImportFile };