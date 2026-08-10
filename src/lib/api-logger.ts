import { db } from "./db";
import { generateId } from "./utils";
import { captureEvent } from "./posthog";
import type { ApiLog, ApiLogRequestSnapshot, ApiLogRoute } from "./types";

export interface ApiResponseMeta {
  durationMs: number;
  statusCode: number;
  error?: string;
  modelRequested?: string;
  modelUsed?: string;
  promptLength?: number;
  responseLength?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
  request?: ApiLogRequestSnapshot;
}

// ---------------------------------------------------------------------------
// Event emitter for live UI updates
// ---------------------------------------------------------------------------

const logListeners = new Set<() => void>();

export function onLogAdded(fn: () => void): () => void {
  logListeners.add(fn);
  return () => { logListeners.delete(fn); };
}

// ---------------------------------------------------------------------------
// Core logging
// ---------------------------------------------------------------------------

export async function logApiCall(
  route: ApiLogRoute,
  caller: string,
  provider: string,
  model: string,
  meta: ApiResponseMeta,
  pieceId?: string,
): Promise<void> {
  const log: ApiLog = {
    id: generateId(),
    // The fragment id goes into the column still called `noteId`. This table
    // is local-only and never synced, so the index name is invisible to
    // everyone including other devices, and renaming it would cost a Dexie
    // schema version for nothing a user could see.
    noteId: pieceId,
    timestamp: Date.now(),
    route,
    caller,
    provider,
    model,
    status: meta.error ? "error" : "success",
    statusCode: meta.statusCode,
    error: meta.error,
    durationMs: meta.durationMs,
    promptTokens: meta.promptTokens,
    completionTokens: meta.completionTokens,
    totalTokens: meta.totalTokens,
    cost: meta.cost,
    promptLength: meta.promptLength ?? 0,
    responseLength: meta.responseLength ?? 0,
    request: meta.request,
    synced: false,
  };

  await db.apiLogs.put(log);

  captureEvent("ai_api_call", {
    route: log.route,
    provider: log.provider,
    model: log.model,
    status: log.status,
    durationMs: log.durationMs,
    promptTokens: log.promptTokens,
    completionTokens: log.completionTokens,
    totalTokens: log.totalTokens,
    cost: log.cost,
    error: log.error,
  });

  for (const fn of logListeners) fn();
}

export async function loadApiLogs(limit = 100): Promise<ApiLog[]> {
  return db.apiLogs.orderBy("timestamp").reverse().limit(limit).toArray();
}

export async function loadApiLogsByRoute(route: ApiLogRoute, limit = 100): Promise<ApiLog[]> {
  return db.apiLogs
    .where("route")
    .equals(route)
    .reverse()
    .sortBy("timestamp")
    .then((logs) => logs.slice(0, limit));
}

export async function clearApiLogs(): Promise<void> {
  await db.apiLogs.clear();
}

export interface ApiUsageStats {
  totalCalls: number;
  successCount: number;
  errorCount: number;
  totalCost: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  avgDurationMs: number;
  byRoute: Record<string, number>;
  byProvider: Record<string, number>;
  byModel: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Per-fragment usage stats
// ---------------------------------------------------------------------------

export interface PieceUsageStats {
  totalCost: number;
  totalTokens: number;
  totalCalls: number;
  callsByRoute: { label: number; generate: number; edit: number };
}

export async function getApiUsageStatsForPiece(pieceId: string): Promise<PieceUsageStats> {
  // `noteId` is the existing index name on a local-only table; see logApiCall.
  const logs = await db.apiLogs.where("noteId").equals(pieceId).toArray();

  const stats: PieceUsageStats = {
    totalCost: 0,
    totalTokens: 0,
    totalCalls: logs.length,
    callsByRoute: { label: 0, generate: 0, edit: 0 },
  };

  for (const log of logs) {
    stats.totalCost += log.cost ?? 0;
    stats.totalTokens += log.totalTokens ?? 0;
    if (log.route in stats.callsByRoute) {
      stats.callsByRoute[log.route as keyof typeof stats.callsByRoute]++;
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Global usage stats
// ---------------------------------------------------------------------------

export async function getApiUsageStats(): Promise<ApiUsageStats> {
  const logs = await db.apiLogs.toArray();

  const stats: ApiUsageStats = {
    totalCalls: logs.length,
    successCount: 0,
    errorCount: 0,
    totalCost: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    avgDurationMs: 0,
    byRoute: {},
    byProvider: {},
    byModel: {},
  };

  let totalDuration = 0;

  for (const log of logs) {
    if (log.status === "success") stats.successCount++;
    else stats.errorCount++;

    stats.totalCost += log.cost ?? 0;
    stats.totalPromptTokens += log.promptTokens ?? 0;
    stats.totalCompletionTokens += log.completionTokens ?? 0;
    stats.totalTokens += log.totalTokens ?? 0;
    totalDuration += log.durationMs;

    stats.byRoute[log.route] = (stats.byRoute[log.route] ?? 0) + 1;
    stats.byProvider[log.provider] = (stats.byProvider[log.provider] ?? 0) + 1;
    stats.byModel[log.model] = (stats.byModel[log.model] ?? 0) + 1;
  }

  stats.avgDurationMs = logs.length > 0 ? Math.round(totalDuration / logs.length) : 0;

  return stats;
}
