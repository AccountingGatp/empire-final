/*
 * Build the final QBO/SaasAnt journal-entry import file from the Empire-generated
 * JE workbook (output of import_file.js).
 *
 * Input:  Empire_Xola_JE_<MONTH>.xlsx  (sheet "Journal Entry")
 *           Journal No | Journal Date | Currency | Memo | Account | Debit |
 *           Credit | Description | Name | Class
 *
 * Output: Empire_Xola_JE_<MONTH>_Import.xlsx
 *           *JournalNo | *JournalDate | *AccountName | *Debits | *Credits |
 *           Description | Name | Currency | Location | Class
 *
 * Transform:
 *   - Drop Memo; add a blank Location column; move Currency after Name.
 *   - Restore the account number on the clearing account
 *     ("Sales Clearing Account" -> "10029 Sales Clearing Account").
 *   - Reformat the date to M/D/YYYY (no leading zeros).
 *   - Drop the TOTALS / blank rows.
 */

const XLSX = require('xlsx');
const ExcelJS = require('exceljs');

const IN_FILE = process.env.IN_FILE || 'Empire_Xola_JE_May_2026.xlsx';
const OUT_FILE = process.env.OUT_FILE || IN_FILE.replace(/\.xlsx$/i, '_Import.xlsx');

// Accounts that need their number restored for the import.
const ACCOUNT_FINAL = {
  'Sales Clearing Account': '10029 Sales Clearing Account',
};

const FONT = 'Arial';
const NAVY = 'FF1F3864';
const WHITE = 'FFFFFFFF';
const MONEY = '#,##0.00;(#,##0.00)';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Find a column index by matching the header against a predicate.
function colFinder(header) {
  const normed = header.map(norm);
  return (test) => normed.findIndex((h) => test(h));
}

// Reformat "05/31/2026" (or a Date) to "5/31/2026".
function formatDate(value) {
  if (value instanceof Date) {
    return `${value.getMonth() + 1}/${value.getDate()}/${value.getFullYear()}`;
  }
  const m = String(value).match(/(\d{1,2})\D(\d{1,2})\D(\d{2,4})/);
  if (!m) return String(value);
  return `${Number(m[1])}/${Number(m[2])}/${m[3]}`;
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function readSource() {
  const wb = XLSX.readFile(IN_FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });

  const header = rows[0];
  const find = colFinder(header);
  const idx = {
    journalNo: find((h) => h.includes('journalno')),
    journalDate: find((h) => h.includes('journaldate')),
    account: find((h) => h.includes('account')),
    debit: find((h) => h.includes('debit')),
    credit: find((h) => h.includes('credit')),
    description: find((h) => h.includes('description')),
    name: find((h) => h === 'name'),
    currency: find((h) => h.includes('currency')),
    class: find((h) => h.includes('class')),
  };

  const missing = Object.entries(idx).filter(([, v]) => v === -1).map(([k]) => k);
  if (missing.length) {
    throw new Error(`Could not find columns in ${IN_FILE}: ${missing.join(', ')}`);
  }

  const out = [];
  for (const r of rows.slice(1)) {
    const journalNo = String(r[idx.journalNo] || '').trim();
    const account = String(r[idx.account] || '').trim();
    // Skip the TOTALS row and any blank/summary rows.
    if (!journalNo || norm(account) === 'totals') continue;

    out.push({
      journalNo,
      journalDate: formatDate(r[idx.journalDate]),
      account: ACCOUNT_FINAL[account] || account,
      debit: numOrNull(r[idx.debit]),
      credit: numOrNull(r[idx.credit]),
      description: r[idx.description] || '',
      name: r[idx.name] || '',
      currency: r[idx.currency] || 'USD',
      location: '',
      class: r[idx.class] || '',
    });
  }
  return out;
}

async function writeFinal(rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GATP Solutions';
  const ws = wb.addWorksheet('Journal Entry', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

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

  for (const r of rows) {
    const row = ws.addRow([
      r.journalNo, r.journalDate, r.account, r.debit, r.credit,
      r.description, r.name, r.currency, r.location, r.class,
    ]);
    row.eachCell({ includeEmpty: true }, (cell) => {
      if (!cell.font || !cell.font.name) cell.font = { name: FONT, size: 10 };
    });
    row.getCell(4).numFmt = MONEY;
    row.getCell(5).numFmt = MONEY;
  }

  await wb.xlsx.writeFile(OUT_FILE);
}

async function main() {
  const rows = readSource();
  if (!rows.length) {
    console.error(`No data rows read from ${IN_FILE}.`);
    process.exit(1);
  }

  await writeFinal(rows);

  const totalDebit = rows.reduce((s, r) => s + (r.debit || 0), 0);
  const totalCredit = rows.reduce((s, r) => s + (r.credit || 0), 0);
  const balanced = Math.round((totalDebit - totalCredit) * 100) === 0;

  console.log(`Wrote ${OUT_FILE}`);
  console.log(`  Source:       ${IN_FILE}`);
  console.log(`  Lines:        ${rows.length}`);
  console.log(`  Total Debits: ${totalDebit.toFixed(2)}`);
  console.log(`  Total Credits:${totalCredit.toFixed(2)}`);
  console.log(`  Balance:      ${(totalDebit - totalCredit).toFixed(2)} ${balanced ? '✔ BALANCED' : '✗ OUT OF BALANCE'}`);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
