const mongoose = require('mongoose');

// One workbook to export + download: (seller x report-type).
const fileTaskSchema = new mongoose.Schema(
  {
    run: { type: mongoose.Schema.Types.ObjectId, ref: 'Run', required: true, index: true },

    sellerId: { type: String, required: true },
    sellerName: { type: String, required: true },

    // 'account' -> transactions export ; 'payout' -> payout_report export.
    type: { type: String, enum: ['account', 'payout'], required: true },

    // Step-by-step lifecycle of a single file.
    status: {
      type: String,
      enum: [
        'pending', // queued
        'exporting', // creating the export job on Xola
        'polling', // waiting for Xola to generate the file
        'downloading', // pulling the xlsx down
        'done', // saved locally
        'failed', // any step failed (retryable)
      ],
      default: 'pending',
    },

    xolaJobId: { type: String, default: null },
    downloadUrl: { type: String, default: null },

    fileName: { type: String, default: null },
    filePath: { type: String, default: null },
    sizeBytes: { type: Number, default: 0 },

    attempts: { type: Number, default: 0 },
    error: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FileTask', fileTaskSchema);
