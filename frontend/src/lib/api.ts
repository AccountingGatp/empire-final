// Client for the Empire Express backend.

export const API_URL =
  // process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  "https://empire-final-api.vercel.app";


export type TaskStatus =
  | "pending"
  | "exporting"
  | "polling"
  | "downloading"
  | "done"
  | "failed";

export type FileTask = {
  id: string;
  sellerId: string;
  sellerName: string;
  type: "account" | "payout";
  status: TaskStatus;
  fileName: string | null;
  sizeBytes: number;
  attempts: number;
  error: string | null;
  updatedAt: string;
};

export type SummaryStatus = "idle" | "generating" | "ready" | "failed";

export type SummaryPart = {
  status: SummaryStatus;
  fileName: string | null;
  sheetCount: number;
  skipped: number;
  error: string | null;
  generatedAt: string | null;
};

export type ImportFile = {
  status: SummaryStatus;
  fileName: string | null;
  lineCount: number;
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
  warnings: string[];
  error: string | null;
  generatedAt: string | null;
};

export type Run = {
  id: string;
  month: string;
  from: string;
  to: string;
  phase: "created" | "fetching_delegators" | "processing" | "done";
  status: "running" | "completed" | "completed_with_errors" | "failed";
  totalTasks: number;
  doneTasks: number;
  failedTasks: number;
  sellerCount: number;
  error: string | null;
  createdAt: string;
  account: FileTask[];
  payout: FileTask[];
  summaries: { account: SummaryPart; payout: SummaryPart };
  importFile: ImportFile;
};

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function startRun(month: string): Promise<Run> {
  return json(
    await fetch(`${API_URL}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month }),
    })
  );
}

export async function getRun(id: string): Promise<Run> {
  return json(await fetch(`${API_URL}/api/runs/${id}`, { cache: "no-store" }));
}

export async function retryTask(
  id: string
): Promise<{ id: string; status: TaskStatus; error: string | null }> {
  return json(
    await fetch(`${API_URL}/api/tasks/${id}/retry`, { method: "POST" })
  );
}

export function fileUrl(taskId: string): string {
  return `${API_URL}/api/tasks/${taskId}/file`;
}

export async function generateSummary(runId: string): Promise<Run> {
  return json(
    await fetch(`${API_URL}/api/runs/${runId}/summary`, { method: "POST" })
  );
}

export function summaryUrl(runId: string, type: "account" | "payout"): string {
  return `${API_URL}/api/runs/${runId}/summary/${type}/file`;
}

export async function generateImportFile(runId: string): Promise<Run> {
  return json(
    await fetch(`${API_URL}/api/runs/${runId}/import`, { method: "POST" })
  );
}

export function importFileUrl(runId: string): string {
  return `${API_URL}/api/runs/${runId}/import/file`;
}
