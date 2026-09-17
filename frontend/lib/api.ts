"use client";
import { accessToken } from "./supabase";
import type {
  ActivityRow, Campaign, CampaignListItem, Catalog, ChatMessage, ChatTurn, ClarityResult, CompareResult, CreditsPage, FeedbackRow, Me, Memory,
  MutationResponse, StageEvent, YieldEvent,
} from "./types";

/** Empty NEXT_PUBLIC_API_URL = same origin (Shape A). */
export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public payload?: unknown) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    let code = "http_error", message = res.statusText, payload: unknown;
    if (ct.includes("application/json")) {
      const j = await res.json().catch(() => ({}));
      const e = j.error || j.detail || j;
      code = e.code || code; message = e.message || message; payload = e.payload;
    }
    throw new ApiError(res.status, code, message, payload);
  }
  return ct.includes("application/json") ? res.json() : (res as unknown as T);
}

export const api = {
  me: () => request<Me>("/api/me"),
  catalog: () => request<Catalog>("/api/catalog"),
  clarity: (brief: string, answers: string[] = []) => request<ClarityResult>("/api/clarity", { method: "POST", body: JSON.stringify({ brief, answers }) }),
  estimate: (action: string) => request<{ base: number; est_usage: number; total: number; balance: number }>(`/api/credits/estimate?action=${action}`),
  campaigns: () => request<CampaignListItem[]>("/api/campaigns"),
  campaign: (id: string) => request<MutationResponse>(`/api/campaigns/${id}`),
  activity: (id: string) => request<{ interactions: ActivityRow[]; feedback: FeedbackRow[] }>(`/api/campaigns/${id}/activity`),
  versions: (id: string) => request<{ version: number; change_note: string; created_at: string }[]>(`/api/campaigns/${id}/versions`),
  deleteCampaign: (id: string) => request<void>(`/api/campaigns/${id}`, { method: "DELETE" }),
  patch: (id: string, body: Record<string, unknown>) => request<MutationResponse>(`/api/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  regenerate: (id: string, personaId: string, instruction?: string) =>
    request<MutationResponse>(`/api/campaigns/${id}/creatives/${personaId}/regenerate`, { method: "POST", body: JSON.stringify({ instruction: instruction || null }) }),
  feedback: (body: { campaign_id: string; target_kind: string; target_id: string; vote: "up" | "down"; comment?: string }) =>
    request<{ feedback_id: string; repair: MutationResponse | null }>("/api/feedback", { method: "POST", body: JSON.stringify(body) }),
  compare: (a: string, b: string) => request<CompareResult>(`/api/campaigns/${a}/compare/${b}`),
  exportJson: (id: string) => request<Record<string, unknown>>(`/api/campaigns/${id}/export.json`),
  credits: () => request<CreditsPage>("/api/credits"),
  memory: () => request<Memory>("/api/memory"),
  putPreference: (key: string, value: unknown) => request<{ ok: boolean }>("/api/memory/preferences", { method: "PUT", body: JSON.stringify({ key, value }) }),
  addFact: (text: string) => request<{ id: string }>("/api/memory/facts", { method: "POST", body: JSON.stringify({ text }) }),
  deleteFact: (id: string) => request<{ ok: boolean }>(`/api/memory/facts/${id}`, { method: "DELETE" }),
  chat: (body: { message: string; thread_id?: string | null; campaign_id?: string | null }) => request<ChatTurn>("/api/chat", { method: "POST", body: JSON.stringify(body) }),
  thread: (id: string) => request<{ thread_id: string; campaign_id: string | null; messages: ChatMessage[] }>(`/api/chat/${id}`),
  threads: () => request<{ id: string; campaign_id: string | null; campaign_name: string | null; created_at: string; messages: number }[]>("/api/chat"),

  /** Download a file through the authenticated API (the browser can't attach a bearer token to a plain link). */
  async download(path: string, filename: string) {
    const token = await accessToken();
    const res = await fetch(`${API_BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new ApiError(res.status, "download_failed", res.statusText);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },

  /** Streaming generation: yields stage events, resolves with the final MutationResponse. */
  generate(body: { brief: string; answers: string[]; parent_campaign_id?: string | null }, onStage: (e: StageEvent) => void): Promise<MutationResponse> {
    return sse<MutationResponse>("/api/campaigns", body, { stage: onStage });
  },

  /** Streaming chat turn: yields live progress events, resolves with the ChatTurn. */
  chatStream(body: { message: string; thread_id?: string | null; campaign_id?: string | null }, onYield: (e: YieldEvent) => void): Promise<ChatTurn> {
    return sse<ChatTurn>("/api/chat", body, { yield: onYield });
  },
};

/** POST + parse an SSE response. Named events are routed to `handlers`; `done` resolves, `error` rejects. */
async function sse<T>(path: string, body: unknown, handlers: Record<string, (data: never) => void>): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    const e = j.error || j.detail || {};
    throw new ApiError(res.status, e.code || "http_error", e.message || res.statusText, e.payload);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let event = "message";
  let done: T | null = null;
  let error: ApiError | null = null;
  const handle = (name: string, data: string) => {
    if (!data) return;
    if (name === "done") done = JSON.parse(data);
    else if (name === "error") { const e = JSON.parse(data); error = new ApiError(e.status || 500, e.code, e.message, e.payload); }
    else handlers[name]?.(JSON.parse(data) as never);
  };
  for (;;) {
    const { value, done: eof } = await reader.read();
    if (eof) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      handle(event, data);
      event = "message";
    }
  }
  if (error) throw error;
  if (!done) throw new ApiError(500, "stream_ended", "The stream ended without a result.");
  return done;
}
