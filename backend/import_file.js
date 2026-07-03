/*
 * Empire Tours — Xola Sales Journal Entry import builder.
 *
 * Input (project root):
 *   summary.xlsx  — Revenue report: one sheet per location with a Summary Report
 *                   (Method | Gross | Processing Fee | Service Fee | Guest Fee | Net).
 *
 * Output:
 *   Empire_Xola_JE_<MONTH>.xlsx — a single flat journal-entry import sheet:
 *     Journal No | Journal Date | Currency | Memo | Account | Debit | Credit |
 *     Description | Name | Class
 *
 * Rules:
 *   - For each location, aggregate Gross / Processing Fee / Service Fee across
 *     all method rows; Net = Gross − Processing − Service.
 *   - Post up to 4 lines per location (Net, Processing, Service = debit natural;
 *     Gross = credit natural). Sign rule: a positive amount goes in its natural
 *     column; a negative amount goes as its absolute value in the opposite column.
 *   - Skip any line whose amount is 0, and skip locations with no activity.
 */

const XLSX = require('xlsx');
const ExcelJS = require('exceljs');

// ---- Period config (change each month) --------------------------------------

const MONTH_LABEL = 'May 2026';
const CURRENCY = 'USD';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const [MONTH_NAME, YEAR_STR] = MONTH_LABEL.split(' ');
const YEAR = Number(YEAR_STR);
const MONTH_INDEX = MONTHS.indexOf(MONTH_NAME);
const pad2 = (n) => String(n).padStart(2, '0');
const LAST_DAY = new Date(YEAR, MONTH_INDEX + 1, 0).getDate();

const JOURNAL_NO = `JE-${MONTH_NAME.slice(0, 3).toUpperCase()}${YEAR}-XOLA`;
const JOURNAL_DATE = `${pad2(MONTH_INDEX + 1)}/${pad2(LAST_DAY)}/${YEAR}`;
const MEMO = `Xola Revenue – ${MONTH_LABEL}`; // en dash

const REVENUE_FILE = 'summary.xlsx';
const OUT_FILE =
  process.env.OUT_FILE || `Empire_Xola_JE_${MONTH_LABEL.replace(/ /g, '_')}.xlsx`;

// ---- Accounts (posting order) -----------------------------------------------

const ACCOUNTS = {
  net: 'Sales Clearing Account',
  processing: '40002.2 Processing Fees - Xola',
  service: '40001.1 Service Fees',
  gross: '40001 Sales Revenue - Xola',
};

// ---- Class mapping, keyed by (normalized) actual sheet name -----------------
// Class paths follow Class_List_Empire (Location → code → class in Books).

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

// Codes that were inferred (not confirmed in the authoritative JE) — warn on use.
const UNCONFIRMED = new Set(['Austin_Tours', 'Ohio_Cabins', 'Wisconsin_Lodges']);

// ---- Styling ----------------------------------------------------------------

const NAVY = 'FF1F3864';
const WHITE = 'FFFFFFFF';
const ALT_FILL = 'FFF2F5FB';
const FLAG_FILL = 'FFFFF2CC';
const FONT = 'Arial';
const MONEY = '#,##0.00;(#,##0.00)';

// ---- Helpers ----------------------------------------------------------------

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Normalized lookup so minor sheet-name variations still match.
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

// Aggregate one revenue sheet.
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
  return {
    gross: round2(gross),
    processing: round2(processing),
    service: round2(service),
  };
}

// ---- Build the flat line model ----------------------------------------------

function buildLines() {
  const wb = XLSX.readFile(REVENUE_FILE);
  const lines = [];
  const warnings = [];

  for (const sheetName of wb.SheetNames) {
    const agg = parseRevenueSheet(wb.Sheets[sheetName]);
    if (!agg) continue;

    const net = round2(agg.gross - agg.processing - agg.service);

    // Skip locations with no activity at all.
    if ([net, agg.gross, agg.processing, agg.service].every((v) => Math.abs(v) < 0.005)) {
      continue;
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
        journalNo: JOURNAL_NO,
        journalDate: JOURNAL_DATE,
        currency: CURRENCY,
        memo: MEMO,
        account: p.account,
        debit,
        credit,
        description: p.text,
        name: '',
        class: classValue,
        flagClass: !classValue,
      });
    }
  }

  return { lines, warnings };
}

// ---- Write the workbook -----------------------------------------------------

async function writeWorkbook(lines) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GATP Solutions';
  const ws = wb.addWorksheet('Journal Entry', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const headers = [
    'Journal No', 'Journal Date', 'Currency', 'Memo', 'Account',
    'Debit', 'Credit', 'Description', 'Name', 'Class',
  ];
  const hr = ws.addRow(headers);
  hr.eachCell((cell) => {
    cell.font = { name: FONT, bold: true, color: { argb: WHITE }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });

  ws.columns = [
    { width: 18 }, { width: 13 }, { width: 9 }, { width: 26 }, { width: 32 },
    { width: 14 }, { width: 14 }, { width: 42 }, { width: 10 }, { width: 30 },
  ];

  let prevClass = null;
  let band = false;
  lines.forEach((l) => {
    if (l.class !== prevClass) {
      band = !band; // flip band when the location/class block changes
      prevClass = l.class;
    }
    const row = ws.addRow([
      l.journalNo, l.journalDate, l.currency, l.memo, l.account,
      l.debit, l.credit, l.description, l.name, l.class,
    ]);
    row.eachCell({ includeEmpty: true }, (cell) => {
      if (!cell.font || !cell.font.name) cell.font = { name: FONT, size: 10 };
      if (band) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALT_FILL } };
      }
    });
    row.getCell(6).numFmt = MONEY;
    row.getCell(7).numFmt = MONEY;
    if (l.flagClass) {
      row.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FLAG_FILL } };
    }
  });

  // Totals row + balance check (with cached results so they render everywhere).
  const first = 2;
  const last = ws.rowCount;
  const totalDebit = round2(lines.reduce((s, l) => s + (l.debit || 0), 0));
  const totalCredit = round2(lines.reduce((s, l) => s + (l.credit || 0), 0));
  const balanced = round2(totalDebit - totalCredit) === 0;

  const totals = ws.addRow(['', '', '', '', 'TOTALS', null, null, '', '', '']);
  totals.getCell(6).value = { formula: `SUM(F${first}:F${last})`, result: totalDebit };
  totals.getCell(7).value = { formula: `SUM(G${first}:G${last})`, result: totalCredit };
  totals.getCell(8).value = {
    formula: `IF(ROUND(F${last + 1}-G${last + 1},2)=0,"✔  BALANCED","✗ OUT OF BALANCE")`,
    result: balanced ? '✔  BALANCED' : '✗ OUT OF BALANCE',
  };
  totals.getCell(6).numFmt = MONEY;
  totals.getCell(7).numFmt = MONEY;
  totals.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { name: FONT, bold: true, size: 10 };
    cell.border = { top: { style: 'thin', color: { argb: NAVY } } };
  });

  await wb.xlsx.writeFile(OUT_FILE);
}

// ---- Main -------------------------------------------------------------------

async function main() {
  if (MONTH_INDEX === -1) {
    console.error(`Bad MONTH_LABEL "${MONTH_LABEL}" — use e.g. "May 2026".`);
    process.exit(1);
  }

  const { lines, warnings } = buildLines();
  if (!lines.length) {
    console.error(`No journal lines produced from ${REVENUE_FILE}.`);
    process.exit(1);
  }

  await writeWorkbook(lines);

  const totalDebit = round2(lines.reduce((s, l) => s + (l.debit || 0), 0));
  const totalCredit = round2(lines.reduce((s, l) => s + (l.credit || 0), 0));

  console.log(`Wrote ${OUT_FILE}`);
  console.log(`  Journal No:   ${JOURNAL_NO}`);
  console.log(`  Journal Date: ${JOURNAL_DATE}`);
  console.log(`  Lines:        ${lines.length}`);
  console.log(`  Total Debit:  ${totalDebit.toFixed(2)}`);
  console.log(`  Total Credit: ${totalCredit.toFixed(2)}`);
  console.log(`  Balance:      ${(totalDebit - totalCredit).toFixed(2)} ${totalDebit === totalCredit ? '✔ BALANCED' : '✗ OUT OF BALANCE'}`);

  if (warnings.length) {
    console.warn('\nFlags:');
    warnings.forEach((w) => console.warn(`  - ${w}`));
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
