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

// ---- auth ----------------------------------------------------------------

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  picture: string;
};

const TOKEN_KEY = "empire_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string) {
  if (typeof window !== "undefined") window.localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  if (typeof window !== "undefined") window.localStorage.removeItem(TOKEN_KEY);
}

// JSON headers + the Bearer token (if signed in).
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// Exchange a Google ID token for a session (enforces the allowed domain server-side).
export async function loginWithGoogle(
  credential: string
): Promise<{ token: string; user: AuthUser }> {
  return json(
    await fetch(`${API_URL}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    })
  );
}

// Validate the stored session and return the current user.
export async function fetchMe(): Promise<{ user: AuthUser }> {
  return json(
    await fetch(`${API_URL}/api/auth/me`, { headers: authHeaders(), cache: "no-store" })
  );
}

export async function startRun(month: string): Promise<Run> {
  return json(
    await fetch(`${API_URL}/api/runs`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ month }),
    })
  );
}

export async function getRun(id: string): Promise<Run> {
  return json(
    await fetch(`${API_URL}/api/runs/${id}`, {
      headers: authHeaders(),
      cache: "no-store",
    })
  );
}

// The most recent run for a month (with its files), or null if none exists yet.
export async function getLatestRunForMonth(month: string): Promise<Run | null> {
  const res = await json<{ run: Run | null }>(
    await fetch(`${API_URL}/api/runs/latest?month=${encodeURIComponent(month)}`, {
      headers: authHeaders(),
      cache: "no-store",
    })
  );
  return res.run;
}

export async function retryTask(
  id: string
): Promise<{ id: string; status: TaskStatus; error: string | null }> {
  return json(
    await fetch(`${API_URL}/api/tasks/${id}/retry`, {
      method: "POST",
      headers: authHeaders(),
    })
  );
}

export function fileUrl(taskId: string): string {
  return `${API_URL}/api/tasks/${taskId}/file`;
}

export async function generateSummary(runId: string): Promise<Run> {
  return json(
    await fetch(`${API_URL}/api/runs/${runId}/summary`, {
      method: "POST",
      headers: authHeaders(),
    })
  );
}

export function summaryUrl(runId: string, type: "account" | "payout"): string {
  return `${API_URL}/api/runs/${runId}/summary/${type}/file`;
}

export async function generateImportFile(runId: string): Promise<Run> {
  return json(
    await fetch(`${API_URL}/api/runs/${runId}/import`, {
      method: "POST",
      headers: authHeaders(),
    })
  );
}

export function importFileUrl(runId: string): string {
  return `${API_URL}/api/runs/${runId}/import/file`;
}
