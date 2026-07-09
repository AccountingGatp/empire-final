"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Layers,
  Loader2,
  RotateCw,
  Users,
  PlayCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  fileUrl,
  generateImportFile,
  generateSummary,
  getLatestRunForMonth,
  getRun,
  importFileUrl,
  retryTask,
  startRun,
  summaryUrl,
  type FileTask,
  type ImportFile,
  type Run,
  type SummaryPart,
  type TaskStatus,
} from "@/lib/api";

// ---- helpers -------------------------------------------------------------

function monthRange(month: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const last = new Date(year, mon, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { from: `${year}-${pad(mon)}-01`, to: `${year}-${pad(mon)}-${pad(last)}` };
}

// The calendar month before today, as 'YYYY-MM' (accounting closes last month).
function previousMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function formatBytes(b: number) {
  if (!b) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

const statusMeta: Record<
  TaskStatus,
  { label: string; className: string; spin?: boolean }
> = {
  pending: { label: "Queued", className: "bg-muted text-muted-foreground border-transparent" },
  exporting: { label: "Requesting export", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-transparent", spin: true },
  polling: { label: "Generating", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-transparent", spin: true },
  downloading: { label: "Downloading", className: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-transparent", spin: true },
  done: { label: "Ready", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-transparent" },
  failed: { label: "Failed", className: "bg-red-500/10 text-red-600 dark:text-red-400 border-transparent" },
};

// ---- file row ------------------------------------------------------------

function FileRow({ task, onRetry }: { task: FileTask; onRetry: (id: string) => void }) {
  const meta = statusMeta[task.status];
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary">
        <FileSpreadsheet className="size-4 text-muted-foreground" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{task.sellerName}</p>
        <p className="truncate text-xs text-muted-foreground">
          {task.status === "done"
            ? `${task.fileName} · ${formatBytes(task.sizeBytes)}`
            : task.error
              ? task.error
              : `${task.type} report`}
        </p>
      </div>

      <Badge variant="outline" className={cn("shrink-0 gap-1", meta.className)}>
        {meta.spin && <Loader2 className="size-3 animate-spin" />}
        {meta.label}
      </Badge>

      {task.status === "done" && (
        <Button
          render={<a href={fileUrl(task.id)} download />}
          size="sm"
          variant="outline"
          className="shrink-0"
        >
          <Download className="size-3.5" />
          Download
        </Button>
      )}

      {task.status === "failed" && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => onRetry(task.id)}
        >
          <RotateCw className="size-3.5" />
          Redownload
        </Button>
      )}
    </div>
  );
}

// ---- stepper -------------------------------------------------------------

function Stepper({ run }: { run: Run | null }) {
  const step =
    !run || run.phase === "created" || run.phase === "fetching_delegators"
      ? 1
      : run.phase === "processing"
        ? 2
        : 3;

  const steps = [
    { n: 1, label: "Fetch sellers", icon: Users },
    { n: 2, label: "Export & download", icon: Download },
    { n: 3, label: "Complete", icon: CheckCircle2 },
  ];

  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => {
        const active = step === s.n;
        const done = step > s.n;
        const Icon = s.icon;
        return (
          <div key={s.n} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full border text-sm transition-colors",
                done && "border-emerald-500 bg-emerald-500 text-white",
                active && "border-primary bg-primary text-primary-foreground",
                !active && !done && "border-border bg-muted text-muted-foreground"
              )}
            >
              {done ? <CheckCircle2 className="size-4" /> : <Icon className="size-4" />}
            </div>
            <span
              className={cn(
                "hidden text-sm sm:block",
                active ? "font-medium" : "text-muted-foreground"
              )}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <div className="mx-1 h-px flex-1 bg-border" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---- summary -------------------------------------------------------------

function SummaryLine({
  label,
  part,
  href,
}: {
  label: string;
  part: SummaryPart;
  href: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary">
        <Layers className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">
          {part.status === "ready"
            ? `${part.sheetCount} sheet${part.sheetCount === 1 ? "" : "s"}${
                part.skipped ? ` · ${part.skipped} skipped` : ""
              }`
            : part.status === "failed"
              ? part.error || "Failed"
              : part.status === "generating"
                ? "Combining Summary sheets…"
                : "Not generated yet"}
        </p>
      </div>

      {part.status === "generating" && (
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
      )}

      {part.status === "ready" && (
        <Button
          render={<a href={href} download />}
          size="sm"
          variant="outline"
          className="shrink-0"
        >
          <Download className="size-3.5" />
          Download
        </Button>
      )}
    </div>
  );
}

function SummaryCard({
  run,
  onGenerate,
}: {
  run: Run;
  onGenerate: () => void;
}) {
  const busy =
    run.summaries.account.status === "generating" ||
    run.summaries.payout.status === "generating";
  const hasGenerated =
    run.summaries.account.status === "ready" ||
    run.summaries.payout.status === "ready" ||
    run.summaries.account.status === "failed" ||
    run.summaries.payout.status === "failed";

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Summary</CardTitle>
          <CardDescription>
            Combine every seller&apos;s <span className="font-mono text-xs">Summary</span> sheet
            into one workbook per report type.
          </CardDescription>
        </div>
        <Button size="sm" onClick={onGenerate} disabled={busy || run.status === "running"}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Layers className="size-4" />
          )}
          {busy ? "Generating…" : hasGenerated ? "Regenerate" : "Generate Summary"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        <SummaryLine
          label="Account summary"
          part={run.summaries.account}
          href={summaryUrl(run.id, "account")}
        />
        <SummaryLine
          label="Payout summary"
          part={run.summaries.payout}
          href={summaryUrl(run.id, "payout")}
        />
      </CardContent>
    </Card>
  );
}

// ---- import file ---------------------------------------------------------

function ImportCard({
  run,
  onGenerate,
}: {
  run: Run;
  onGenerate: () => void;
}) {
  const imp: ImportFile = run.importFile;
  // The Sales Revenue import is built from the transactions/revenue summary,
  // which is labeled 'account'.
  const summaryReady = run.summaries.account.status === "ready";
  const busy = imp.status === "generating";
  const money = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Import File</CardTitle>
          <CardDescription>
            Build the single QBO journal-entry import from the revenue summary.
          </CardDescription>
        </div>
        <Button size="sm" onClick={onGenerate} disabled={busy || !summaryReady}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
          {busy
            ? "Building…"
            : imp.status === "ready" || imp.status === "failed"
              ? "Rebuild"
              : "Create Import File"}
        </Button>
      </CardHeader>
      <CardContent>
        {!summaryReady && imp.status === "idle" && (
          <p className="text-sm text-muted-foreground">
            Generate the summary above first.
          </p>
        )}

        {imp.status === "failed" && (
          <div className="flex items-center gap-2 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="size-4" />
            {imp.error || "Failed to build import file."}
          </div>
        )}

        {(imp.status === "ready" || busy) && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                <FileText className="size-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {imp.fileName || `Empire_Xola_JE_Import.xlsx`}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {busy
                    ? "Building journal entries…"
                    : `${imp.lineCount} lines · Dr ${money(imp.totalDebit)} / Cr ${money(
                        imp.totalCredit
                      )}`}
                </p>
              </div>

              {!busy && (
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0",
                    imp.balanced
                      ? "border-transparent bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "border-transparent bg-red-500/10 text-red-600 dark:text-red-400"
                  )}
                >
                  {imp.balanced ? "✓ Balanced" : "✗ Out of balance"}
                </Badge>
              )}

              {imp.status === "ready" && (
                <Button
                  render={<a href={importFileUrl(run.id)} download />}
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                >
                  <Download className="size-3.5" />
                  Download
                </Button>
              )}
            </div>

            {imp.status === "ready" && imp.warnings.length > 0 && (
              <div className="space-y-1 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <p className="font-medium">Class flags ({imp.warnings.length}):</p>
                <ul className="list-inside list-disc space-y-0.5">
                  {imp.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- page ----------------------------------------------------------------

export default function HomePage() {
  const [month, setMonth] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [starting, setStarting] = useState(false);
  const [restoring, setRestoring] = useState(true);
  // Whether WE are actively watching a run this session. This is separate from a
  // stored run's status — nothing polls or generates unless the user acts.
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const range = monthRange(month);

  // Keep polling while downloading, building a summary, or building the import.
  const isBusy = (r: Run) =>
    r.status === "running" ||
    r.summaries.account.status === "generating" ||
    r.summaries.payout.status === "generating" ||
    r.importFile.status === "generating";

  // The run belonging to the currently-selected month (if any) and its state.
  const runForMonth = run && run.month === month ? run : null;
  const inProgress = !!runForMonth && isBusy(runForMonth); // still generating
  const settled = !!runForMonth && !isBusy(runForMonth); // already generated
  const isActive = isPolling;

  const poll = useCallback(async (id: string) => {
    try {
      const next = await getRun(id);
      setRun(next);
      if (!isBusy(next)) {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        setIsPolling(false);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const ensurePolling = useCallback(
    (id: string) => {
      if (pollRef.current) clearInterval(pollRef.current);
      setIsPolling(true);
      pollRef.current = setInterval(() => poll(id), 4000);
    },
    [poll]
  );

  // On load: default to the previous month and just SHOW its existing files (if
  // any). Nothing polls or generates automatically — the user drives everything.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const m = previousMonth();
      if (cancelled) return;
      setMonth(m);
      try {
        const existing = await getLatestRunForMonth(m);
        if (!cancelled) setRun(existing);
      } catch {
        /* no existing run — fine */
      }
      if (!cancelled) setRestoring(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Switching month: show that month's existing run (or clear if none). No polling.
  async function handleMonthChange(m: string) {
    if (isPolling) return; // don't switch while actively watching a run
    setMonth(m);
    setError(null);
    try {
      const existing = await getLatestRunForMonth(m);
      setRun(existing);
    } catch {
      setRun(null);
    }
  }

  // Resume watching an in-progress run (explicit — e.g. after a refresh).
  function handleResume() {
    if (!runForMonth) return;
    setError(null);
    poll(runForMonth.id);
    ensurePolling(runForMonth.id);
  }

  async function handleStart() {
    setError(null);
    setStarting(true);
    try {
      const created = await startRun(month);
      setRun(created);
      ensurePolling(created.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function handleRetry(taskId: string) {
    // Optimistically flip to a working state, then let polling reconcile.
    setRun((r) =>
      r
        ? {
            ...r,
            account: r.account.map((t) => (t.id === taskId ? { ...t, status: "exporting" } : t)),
            payout: r.payout.map((t) => (t.id === taskId ? { ...t, status: "exporting" } : t)),
          }
        : r
    );
    try {
      await retryTask(taskId);
    } catch (e) {
      setError((e as Error).message);
    }
    if (run) {
      poll(run.id);
      ensurePolling(run.id); // resume in case the run had already settled
    }
  }

  async function handleGenerateSummary() {
    if (!run) return;
    setError(null);
    // Optimistic: show both as generating immediately.
    setRun((r) =>
      r
        ? {
            ...r,
            summaries: {
              account: { ...r.summaries.account, status: "generating" },
              payout: { ...r.summaries.payout, status: "generating" },
            },
          }
        : r
    );
    try {
      // Don't overwrite the optimistic "generating" with the POST response —
      // it can race ahead of the background job and still read "idle", which
      // would hide the loader. Let polling reconcile to the real state.
      await generateSummary(run.id);
      ensurePolling(run.id);
    } catch (e) {
      setError((e as Error).message);
      poll(run.id);
    }
  }

  async function handleGenerateImport() {
    if (!run) return;
    setError(null);
    setRun((r) =>
      r ? { ...r, importFile: { ...r.importFile, status: "generating" } } : r
    );
    try {
      // Keep the optimistic "generating" (see handleGenerateSummary).
      await generateImportFile(run.id);
      ensurePolling(run.id);
    } catch (e) {
      setError((e as Error).message);
      poll(run.id);
    }
  }

  const pct = run && run.totalTasks ? Math.round((run.doneTasks / run.totalTasks) * 100) : 0;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 py-8 md:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Monthly Xola Export</h1>
        <p className="text-sm text-muted-foreground">
          Pick a month and download every seller&apos;s account &amp; payout workbook.
        </p>
      </div>

      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Select month</CardTitle>
          <CardDescription>
            The first and last day of the month define the export date range.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="space-y-1.5">
              <label htmlFor="month" className="text-sm font-medium">
                Month
              </label>
              <input
                id="month"
                type="month"
                value={month}
                onChange={(e) => handleMonthChange(e.target.value)}
                disabled={!!isActive || restoring}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:w-48"
              />
            </div>

            {range && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="rounded-md border bg-muted px-2 py-1 font-mono text-xs">
                  {range.from}
                </span>
                <span>→</span>
                <span className="rounded-md border bg-muted px-2 py-1 font-mono text-xs">
                  {range.to}
                </span>
              </div>
            )}

            <div className="flex gap-2 sm:ml-auto">
              {inProgress && (
                <Button onClick={handleResume} disabled={isPolling || restoring}>
                  {isPolling ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <PlayCircle className="size-4" />
                  )}
                  {isPolling ? "Processing…" : "Resume"}
                </Button>
              )}
              <Button
                onClick={handleStart}
                disabled={starting || isPolling || restoring || !range}
                variant={inProgress || settled ? "outline" : "default"}
              >
                {starting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : inProgress || settled ? (
                  <RotateCw className="size-4" />
                ) : (
                  <PlayCircle className="size-4" />
                )}
                {inProgress || settled ? "Regenerate" : "Generate"}
              </Button>
            </div>
          </div>

          {settled && (
            <p className="mt-3 text-sm text-muted-foreground">
              This month was already generated — the files are shown below. Use{" "}
              <span className="font-medium text-foreground">Regenerate</span> to re-download.
            </p>
          )}

          {inProgress && !isPolling && (
            <p className="mt-3 text-sm text-muted-foreground">
              A run for this month is in progress. Click{" "}
              <span className="font-medium text-foreground">Resume</span> to watch it, or{" "}
              <span className="font-medium text-foreground">Regenerate</span> to start over.
            </p>
          )}

          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="size-4" />
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Progress */}
      {run && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Processing</CardTitle>
            <CardDescription>
              {run.phase === "fetching_delegators" && "Fetching the seller list from Xola…"}
              {run.phase === "processing" &&
                `Exporting and downloading ${run.totalTasks} files (${run.sellerCount} sellers × account + payout).`}
              {run.phase === "done" &&
                (run.status === "completed"
                  ? "All files downloaded successfully."
                  : run.status === "completed_with_errors"
                    ? `${run.failedTasks} file(s) failed — retry them below.`
                    : run.error || "Run failed.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Stepper run={run} />
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {run.doneTasks} / {run.totalTasks} ready
                  {run.failedTasks > 0 && ` · ${run.failedTasks} failed`}
                </span>
                <span className="tabular-nums text-muted-foreground">{pct}%</span>
              </div>
              <Progress value={pct} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* File lists */}
      {run && run.totalTasks > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">
              Account sheets{" "}
              <span className="text-muted-foreground">({run.account.length})</span>
            </h2>
            <div className="space-y-2">
              {run.account.map((t) => (
                <FileRow key={t.id} task={t} onRetry={handleRetry} />
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">
              Payout sheets{" "}
              <span className="text-muted-foreground">({run.payout.length})</span>
            </h2>
            <div className="space-y-2">
              {run.payout.map((t) => (
                <FileRow key={t.id} task={t} onRetry={handleRetry} />
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Summary generation — available once files have downloaded */}
      {run && run.status !== "running" && run.doneTasks > 0 && (
        <SummaryCard run={run} onGenerate={handleGenerateSummary} />
      )}

      {/* Import file — available once the account (revenue) summary is ready */}
      {run && run.summaries.account.status === "ready" && (
        <ImportCard run={run} onGenerate={handleGenerateImport} />
      )}
    </main>
  );
}
