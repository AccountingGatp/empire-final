const mongoose = require('mongoose');

// One combined-summary workbook (per report type), built from every seller's
// "Summary" sheet — the web equivalent of process.js.
const summaryPartSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['idle', 'generating', 'ready', 'failed'],
      default: 'idle',
    },
    storageKey: { type: String, default: null }, // B2 object key
    fileName: { type: String, default: null },
    sheetCount: { type: Number, default: 0 }, // sellers combined
    skipped: { type: Number, default: 0 }, // files with no "Summary" sheet
    error: { type: String, default: null },
    generatedAt: { type: Date, default: null },
  },
  { _id: false }
);

// The single final QBO/SaasAnt import workbook (Empire_Xola_JE_<MONTH>_Import).
const importFileSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['idle', 'generating', 'ready', 'failed'],
      default: 'idle',
    },
    storageKey: { type: String, default: null }, // B2 object key
    fileName: { type: String, default: null },
    lineCount: { type: Number, default: 0 },
    totalDebit: { type: Number, default: 0 },
    totalCredit: { type: Number, default: 0 },
    balanced: { type: Boolean, default: false },
    warnings: { type: [String], default: [] },
    error: { type: String, default: null },
    generatedAt: { type: Date, default: null },
  },
  { _id: false }
);

// A single "download the month" execution.
const runSchema = new mongoose.Schema(
  {
    month: { type: String, required: true }, // 'YYYY-MM'
    from: { type: String, required: true }, // 'YYYY-MM-DD' (first day)
    to: { type: String, required: true }, // 'YYYY-MM-DD' (last day)

    // High-level step the run is currently on.
    phase: {
      type: String,
      enum: ['created', 'fetching_delegators', 'processing', 'done'],
      default: 'created',
    },
    status: {
      type: String,
      enum: ['running', 'completed', 'completed_with_errors', 'failed'],
      default: 'running',
    },

    totalTasks: { type: Number, default: 0 },
    doneTasks: { type: Number, default: 0 },
    failedTasks: { type: Number, default: 0 },

    sellerCount: { type: Number, default: 0 },
    error: { type: String, default: null },

    // Combined "Summary" workbooks generated on demand after the run.
    summaries: {
      account: { type: summaryPartSchema, default: () => ({}) },
      payout: { type: summaryPartSchema, default: () => ({}) },
    },

    // Final journal-entry import workbook, built from the account summary.
    importFile: { type: importFileSchema, default: () => ({}) },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Run', runSchema);
