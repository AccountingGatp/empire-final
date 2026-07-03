const path = require('path');
const config = require('../config');
const Run = require('../models/Run');
const FileTask = require('../models/FileTask');
const xola = require('./xola');

const REPORT_TYPES = ['account', 'payout'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Make a filesystem-safe file name from a seller name.
function safeName(name) {
  return String(name || 'seller')
    .replace(/[\\/?*[\]:<>|"]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120);
}

function storagePathFor(runId, type, sellerName) {
  return path.join(config.storageDir, String(runId), type, `${safeName(sellerName)}.xlsx`);
}

// Phase A: create the export job and record its (unique) S3 URL. Returns the URL.
async function createTaskExport(task) {
  task.attempts += 1;
  task.error = null;
  task.status = 'exporting';
  await task.save();

  const data = await xola.createExport(task.type, task._from, task._to, task.sellerId);
  const fileUrl = data.url || null;
  if (!fileUrl) {
    throw new Error('no download url returned by Xola');
  }

  task.xolaJobId = data.id || null;
  task.downloadUrl = fileUrl;
  task.status = 'polling';
  await task.save();
  return fileUrl;
}

// Phase B: wait for the file to appear, then download it to its type folder.
async function finishTask(task) {
  await xola.waitForFile(task.downloadUrl);

  task.status = 'downloading';
  await task.save();

  const outPath = storagePathFor(task.run, task.type, task.sellerName);
  const bytes = await xola.downloadExcel(task.downloadUrl, outPath);

  task.status = 'done';
  task.filePath = outPath;
  task.fileName = path.basename(outPath);
  task.sizeBytes = bytes;
  await task.save();
}

// Create + download a single task end-to-end (used by retry — no sibling to
// collide with, so a fresh export at the current second is always unique).
async function runTaskSolo(task) {
  await createTaskExport(task);
  await finishTask(task);
}

// Process all report tasks for ONE seller. The export files are created with a
// stagger so the same-seller account/payout exports never land on the same S3
// filename (which would put one report's data in the other's folder). The
// downloads then run concurrently since generation happens server-side.
async function processSellerTasks(sellerTasks) {
  const createdUrls = [];

  for (let i = 0; i < sellerTasks.length; i++) {
    const task = sellerTasks[i];
    if (i > 0) await sleep(config.exportStaggerMs); // land in a different second

    try {
      let url = await createTaskExport(task);
      // Belt-and-suspenders: if this collides with a sibling, re-create it.
      let guard = 0;
      while (createdUrls.includes(url) && guard < 5) {
        await sleep(config.exportStaggerMs);
        url = await createTaskExport(task);
        guard++;
      }
      if (createdUrls.includes(url)) {
        throw new Error('could not obtain a unique export URL for this seller');
      }
      createdUrls.push(url);
    } catch (err) {
      task.status = 'failed';
      task.error = err.message;
      await task.save();
    }
  }

  // Download every successfully-created export concurrently.
  await Promise.all(
    sellerTasks
      .filter((t) => t.status === 'polling')
      .map((t) =>
        finishTask(t).catch(async (err) => {
          t.status = 'failed';
          t.error = err.message;
          await t.save();
        })
      )
  );
}

// A tiny promise-pool so we don't hammer Xola with every seller at once.
async function pool(items, size, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function refreshRunCounts(runId) {
  const [done, failed, total] = await Promise.all([
    FileTask.countDocuments({ run: runId, status: 'done' }),
    FileTask.countDocuments({ run: runId, status: 'failed' }),
    FileTask.countDocuments({ run: runId }),
  ]);
  await Run.findByIdAndUpdate(runId, { doneTasks: done, failedTasks: failed, totalTasks: total });
  return { done, failed, total };
}

// Process an entire run in the background. Never throws to the caller.
async function processRun(runId) {
  const run = await Run.findById(runId);
  if (!run) return;

  try {
    // Step 1: fetch delegators (sellers).
    run.phase = 'fetching_delegators';
    await run.save();
    const sellers = await xola.fetchDelegators();

    // Step 2: build one task per (seller x report type).
    const taskDocs = [];
    for (const s of sellers) {
      for (const type of REPORT_TYPES) {
        taskDocs.push({
          run: run._id,
          sellerId: s.id,
          sellerName: s.name || s.id,
          type,
          status: 'pending',
        });
      }
    }
    const tasks = await FileTask.insertMany(taskDocs);

    run.sellerCount = sellers.length;
    run.totalTasks = tasks.length;
    run.phase = 'processing';
    await run.save();

    // Group tasks by seller so a seller's account + payout are handled together
    // (staggered creates). Concurrency is now across sellers, not across files.
    const bySeller = new Map();
    for (const task of tasks) {
      task._from = run.from;
      task._to = run.to;
      if (!bySeller.has(task.sellerId)) bySeller.set(task.sellerId, []);
      bySeller.get(task.sellerId).push(task);
    }

    // Step 3: process each seller's files with limited concurrency.
    await pool([...bySeller.values()], config.concurrency, async (sellerTasks) => {
      await processSellerTasks(sellerTasks);
      await refreshRunCounts(run._id);
    });

    // Step 4: finalize.
    const { failed } = await refreshRunCounts(run._id);
    run.phase = 'done';
    run.status = failed > 0 ? 'completed_with_errors' : 'completed';
    await run.save();
  } catch (err) {
    run.status = 'failed';
    run.phase = 'done';
    run.error = err.message;
    await run.save();
  }
}

// Retry a single failed task (used by the "redownload" button).
async function retryTask(taskId) {
  const task = await FileTask.findById(taskId);
  if (!task) throw new Error('task not found');

  const run = await Run.findById(task.run);
  if (!run) throw new Error('run not found');

  task._from = run.from;
  task._to = run.to;
  try {
    await runTaskSolo(task);
  } catch (err) {
    task.status = 'failed';
    task.error = err.message;
    await task.save();
  }

  await refreshRunCounts(run._id);

  // If everything is now done, reflect that on the run.
  const stillFailed = await FileTask.countDocuments({ run: run._id, status: 'failed' });
  const stillPending = await FileTask.countDocuments({
    run: run._id,
    status: { $in: ['pending', 'exporting', 'polling', 'downloading'] },
  });
  if (stillPending === 0) {
    run.status = stillFailed > 0 ? 'completed_with_errors' : 'completed';
    run.phase = 'done';
    await run.save();
  }

  return FileTask.findById(taskId);
}

module.exports = { processRun, retryTask, storagePathFor };
