import express from 'express';
import Run from '../models/Run.js';
import FileTask from '../models/FileTask.js';
import * as processor from '../services/processor.js';
import * as summary from '../services/summary.js';
import * as importFile from '../services/importFile.js';
import * as storage from '../services/storage.js';

const router = express.Router();

// Compute first/last calendar day for a 'YYYY-MM' month.
function monthRange(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(month || '');
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]); // 1-12
  if (mon < 1 || mon > 12) return null;
  const lastDay = new Date(year, mon, 0).getDate();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    from: `${year}-${pad(mon)}-01`,
    to: `${year}-${pad(mon)}-${pad(lastDay)}`,
  };
}

// Shape a run + its tasks for the frontend.
async function serializeRun(run) {
  const tasks = await FileTask.find({ run: run._id }).sort({ sellerName: 1, type: 1 }).lean();
  const shape = (t) => ({
    id: String(t._id),
    sellerId: t.sellerId,
    sellerName: t.sellerName,
    type: t.type,
    status: t.status,
    fileName: t.fileName,
    sizeBytes: t.sizeBytes,
    attempts: t.attempts,
    error: t.error,
    updatedAt: t.updatedAt,
  });
  const shapeSummary = (s) => ({
    status: s?.status || 'idle',
    fileName: s?.fileName || null,
    sheetCount: s?.sheetCount || 0,
    skipped: s?.skipped || 0,
    error: s?.error || null,
    generatedAt: s?.generatedAt || null,
  });

  return {
    id: String(run._id),
    month: run.month,
    from: run.from,
    to: run.to,
    phase: run.phase,
    status: run.status,
    totalTasks: run.totalTasks,
    doneTasks: run.doneTasks,
    failedTasks: run.failedTasks,
    sellerCount: run.sellerCount,
    error: run.error,
    createdAt: run.createdAt,
    account: tasks.filter((t) => t.type === 'account').map(shape),
    payout: tasks.filter((t) => t.type === 'payout').map(shape),
    summaries: {
      account: shapeSummary(run.summaries?.account),
      payout: shapeSummary(run.summaries?.payout),
    },
    importFile: {
      status: run.importFile?.status || 'idle',
      fileName: run.importFile?.fileName || null,
      lineCount: run.importFile?.lineCount || 0,
      totalDebit: run.importFile?.totalDebit || 0,
      totalCredit: run.importFile?.totalCredit || 0,
      balanced: !!run.importFile?.balanced,
      warnings: run.importFile?.warnings || [],
      error: run.importFile?.error || null,
      generatedAt: run.importFile?.generatedAt || null,
    },
  };
}

// POST /api/runs  { month: 'YYYY-MM' }  -> start a new download run.
router.post('/runs', async (req, res) => {
  const { month } = req.body || {};
  const range = monthRange(month);
  if (!range) {
    return res.status(400).json({ error: "Invalid 'month'. Expected 'YYYY-MM'." });
  }

  const run = await Run.create({ month, from: range.from, to: range.to });

  // Kick off processing in the background; the client polls for progress.
  processor.processRun(run._id).catch((err) => console.error('[run] fatal', err));

  res.status(201).json(await serializeRun(run));
});

// GET /api/runs -> recent runs (summary only).
router.get('/runs', async (_req, res) => {
  const runs = await Run.find().sort({ createdAt: -1 }).limit(20).lean();
  res.json(
    runs.map((r) => ({
      id: String(r._id),
      month: r.month,
      from: r.from,
      to: r.to,
      phase: r.phase,
      status: r.status,
      totalTasks: r.totalTasks,
      doneTasks: r.doneTasks,
      failedTasks: r.failedTasks,
      createdAt: r.createdAt,
    }))
  );
});

// GET /api/runs/:id -> run + tasks (frontend polls this).
router.get('/runs/:id', async (req, res) => {
  const run = await Run.findById(req.params.id);
  if (!run) return res.status(404).json({ error: 'run not found' });
  res.json(await serializeRun(run));
});

// POST /api/tasks/:id/retry -> redownload a single file.
router.post('/tasks/:id/retry', async (req, res) => {
  try {
    const task = await processor.retryTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'task not found' });
    res.json({
      id: String(task._id),
      status: task.status,
      error: task.error,
      attempts: task.attempts,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/runs/:id/summary -> combine every seller's "Summary" sheet into
// summary_account.xlsx + summary_payout.xlsx (runs in the background).
router.post('/runs/:id/summary', async (req, res) => {
  const run = await Run.findById(req.params.id);
  if (!run) return res.status(404).json({ error: 'run not found' });

  const doneCount = await FileTask.countDocuments({ run: run._id, status: 'done' });
  if (doneCount === 0) {
    return res.status(409).json({ error: 'no downloaded files to summarize yet' });
  }

  summary
    .generateRunSummaries(run._id)
    .catch((err) => console.error('[summary] fatal', err));

  res.status(202).json(await serializeRun(await Run.findById(run._id)));
});

// GET /api/runs/:id/summary/:type/file -> download a generated summary workbook.
router.get('/runs/:id/summary/:type/file', async (req, res) => {
  const { id, type } = req.params;
  if (!['account', 'payout'].includes(type)) {
    return res.status(400).json({ error: 'type must be account or payout' });
  }
  const run = await Run.findById(id);
  if (!run) return res.status(404).json({ error: 'run not found' });

  const part = run.summaries?.[type];
  if (!part || part.status !== 'ready' || !part.storageKey) {
    return res.status(409).json({ error: 'summary not ready' });
  }
  const url = await storage.getDownloadUrl(part.storageKey, part.fileName || `summary_${type}.xlsx`);
  res.redirect(url);
});

// POST /api/runs/:id/import -> build the single Empire_Xola_JE_<MONTH>_Import.xlsx
// from the account summary (runs in the background).
router.post('/runs/:id/import', async (req, res) => {
  const run = await Run.findById(req.params.id);
  if (!run) return res.status(404).json({ error: 'run not found' });

  // The Sales Revenue import is built from the transactions/revenue summary,
  // which is labeled 'account'.
  if (run.summaries?.account?.status !== 'ready') {
    return res.status(409).json({ error: 'generate the summary first' });
  }

  importFile
    .generateImportFile(run._id)
    .catch((err) => console.error('[import] fatal', err));

  res.status(202).json(await serializeRun(await Run.findById(run._id)));
});

// GET /api/runs/:id/import/file -> download the final import workbook.
router.get('/runs/:id/import/file', async (req, res) => {
  const run = await Run.findById(req.params.id);
  if (!run) return res.status(404).json({ error: 'run not found' });

  const imp = run.importFile;
  if (!imp || imp.status !== 'ready' || !imp.storageKey) {
    return res.status(409).json({ error: 'import file not ready' });
  }
  const url = await storage.getDownloadUrl(imp.storageKey, imp.fileName || 'Empire_Xola_JE_Import.xlsx');
  res.redirect(url);
});

// GET /api/tasks/:id/file -> redirect to a presigned B2 URL for the workbook.
router.get('/tasks/:id/file', async (req, res) => {
  const task = await FileTask.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'task not found' });
  if (task.status !== 'done' || !task.storageKey) {
    return res.status(409).json({ error: 'file not ready' });
  }
  const url = await storage.getDownloadUrl(task.storageKey, task.fileName || 'export.xlsx');
  res.redirect(url);
});

export default router;
