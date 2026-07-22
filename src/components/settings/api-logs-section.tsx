"use client";

import { Fragment, useState, useEffect, useCallback } from "react";
import {
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  Zap,
  DollarSign,
  Hash,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { loadApiLogs, clearApiLogs, getApiUsageStats, type ApiUsageStats } from "@/lib/api-logger";
import type { ApiLog, ApiLogFieldSnapshot } from "@/lib/types";
import { formatDate } from "@/lib/utils";

type FilterRoute = "all" | "label" | "generate" | "edit" | "analyze";
type FilterStatus = "all" | "success" | "error";

const ROUTE_COLORS: Record<string, string> = {
  label: "bg-blue-500/15 text-blue-400",
  generate: "bg-teal-500/15 text-teal-400",
  edit: "bg-orange-500/15 text-orange-400",
  analyze: "bg-purple-500/15 text-purple-400",
};

const CALLER_COLORS: Record<string, string> = {
  "snippet-labeling": "bg-amber-500/15 text-amber-400",
  "slash-command": "bg-pink-500/15 text-pink-400",
  "inline-edit": "bg-orange-500/15 text-orange-400",
  "drag-preview": "bg-cyan-500/15 text-cyan-400",
  "model-selector": "bg-cyan-500/15 text-cyan-400",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cost: number | undefined): string {
  if (cost === undefined || cost === 0) return "—";
  if (cost < 0.01) return `$${cost.toFixed(6)}`;
  return `$${cost.toFixed(4)}`;
}

function formatTokens(tokens: number | undefined): string {
  if (tokens === undefined || tokens === 0) return "—";
  if (tokens > 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

function formatFieldLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase());
}

function formatSampleMode(field: ApiLogFieldSnapshot): string {
  if (!field.truncated) return "full";
  if (field.sampleMode === "tail") return "tail sample";
  if (field.sampleMode === "head-tail") return "head + tail sample";
  return "head sample";
}

export function ApiLogsSection() {
  const [logs, setLogs] = useState<ApiLog[]>([]);
  const [stats, setStats] = useState<ApiUsageStats | null>(null);
  const [filterRoute, setFilterRoute] = useState<FilterRoute>("all");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [loading, setLoading] = useState(true);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [fetchedLogs, fetchedStats] = await Promise.all([
      loadApiLogs(200),
      getApiUsageStats(),
    ]);
    setLogs(fetchedLogs);
    setStats(fetchedStats);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleClear = async () => {
    await clearApiLogs();
    setExpandedLogId(null);
    await refresh();
  };

  const filtered = logs.filter((log) => {
    if (filterRoute !== "all" && log.route !== filterRoute) return false;
    if (filterStatus !== "all" && log.status !== filterStatus) return false;
    return true;
  });

  return (
    <div className="flex h-full">
      <div className="w-[200px] shrink-0 border-r border-border py-6 px-5 space-y-6">
        <div>
          <h4 className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-3">
            Overview
          </h4>
          <div className="space-y-3">
            <StatCard icon={Hash} label="Total Calls" value={String(stats?.totalCalls ?? 0)} />
            <StatCard
              icon={CheckCircle2}
              label="Success"
              value={String(stats?.successCount ?? 0)}
              color="text-emerald-400"
            />
            <StatCard
              icon={AlertCircle}
              label="Errors"
              value={String(stats?.errorCount ?? 0)}
              color="text-red-400"
            />
          </div>
        </div>

        <div>
          <h4 className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-3">
            Usage
          </h4>
          <div className="space-y-3">
            <StatCard
              icon={DollarSign}
              label="Total Cost"
              value={formatCost(stats?.totalCost)}
            />
            <StatCard
              icon={Zap}
              label="Total Tokens"
              value={formatTokens(stats?.totalTokens)}
            />
            <StatCard
              icon={Clock}
              label="Avg Latency"
              value={stats ? formatDuration(stats.avgDurationMs) : "—"}
            />
          </div>
        </div>

        <div>
          <h4 className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-3">
            By Route
          </h4>
          <div className="space-y-1.5">
            {Object.entries(stats?.byRoute ?? {}).map(([route, count]) => (
              <div key={route} className="flex items-center justify-between">
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${ROUTE_COLORS[route] ?? "bg-surface-3 text-text-muted"}`}>
                  {route}
                </span>
                <span className="text-[10px] text-text-muted font-mono">{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-3">
            By Provider
          </h4>
          <div className="space-y-1.5">
            {Object.entries(stats?.byProvider ?? {}).map(([prov, count]) => (
              <div key={prov} className="flex items-center justify-between">
                <span className="text-[10px] text-text-secondary truncate max-w-[100px]">
                  {prov}
                </span>
                <span className="text-[10px] text-text-muted font-mono">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <select
              value={filterRoute}
              onChange={(e) => setFilterRoute(e.target.value as FilterRoute)}
              className="bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-2 py-1 text-[11px] text-text-secondary outline-none"
            >
              <option value="all">All routes</option>
              <option value="label">Label</option>
              <option value="generate">Generate</option>
              <option value="edit">Edit</option>
              <option value="analyze">Analyze</option>
            </select>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
              className="bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-2 py-1 text-[11px] text-text-secondary outline-none"
            >
              <option value="all">All statuses</option>
              <option value="success">Success</option>
              <option value="error">Error</option>
            </select>

            <span className="text-[10px] text-text-faint ml-2">
              {filtered.length} entries
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              className="p-1.5 rounded-[var(--radius-sm)] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors duration-150"
              title="Refresh"
            >
              <RefreshCw size={13} />
            </button>
            <button
              onClick={handleClear}
              className="p-1.5 rounded-[var(--radius-sm)] text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors duration-150"
              title="Clear all logs"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-[11px] text-text-faint">
              Loading logs...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-text-faint">
              <p className="text-[11px]">No API calls recorded yet.</p>
              <p className="text-[10px] mt-1">Calls will appear here as you use AI features.</p>
            </div>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-surface-2 border-b border-border">
                <tr className="text-left text-[10px] text-text-muted uppercase tracking-wider">
                  <th className="px-3 py-2 font-medium w-[36px]">View</th>
                  <th className="px-4 py-2 font-medium">Time</th>
                  <th className="px-4 py-2 font-medium">Route</th>
                  <th className="px-4 py-2 font-medium">Called by</th>
                  <th className="px-4 py-2 font-medium">Provider</th>
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-4 py-2 font-medium text-right">Status</th>
                  <th className="px-4 py-2 font-medium text-right">Latency</th>
                  <th className="px-4 py-2 font-medium text-right">Tokens</th>
                  <th className="px-4 py-2 font-medium text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => (
                  <Fragment key={log.id}>
                    <LogRow
                      log={log}
                      expanded={expandedLogId === log.id}
                      onToggle={() => setExpandedLogId((current) => current === log.id ? null : log.id)}
                    />
                    {expandedLogId === log.id && <LogDetails log={log} />}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function LogRow({
  log,
  expanded,
  onToggle,
}: {
  log: ApiLog;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isError = log.status === "error";

  return (
    <tr className="border-b border-border/50 hover:bg-surface-2/50 transition-colors duration-100">
      <td className="px-3 py-2">
        <button
          onClick={onToggle}
          className="p-1 rounded-[var(--radius-sm)] text-text-muted hover:text-text-secondary hover:bg-surface-3 transition-colors duration-150"
          title={expanded ? "Hide details" : "Show details"}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
      </td>
      <td className="px-4 py-2 text-text-muted font-mono whitespace-nowrap">
        {formatDate(log.timestamp)}
      </td>
      <td className="px-4 py-2">
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${ROUTE_COLORS[log.route] ?? "bg-surface-3 text-text-muted"}`}>
          {log.route}
        </span>
      </td>
      <td className="px-4 py-2">
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${CALLER_COLORS[log.caller] ?? "bg-surface-3 text-text-muted"}`}>
          {log.caller || "—"}
        </span>
      </td>
      <td className="px-4 py-2 text-text-secondary">{log.provider}</td>
      <td className="px-4 py-2 text-text-secondary font-mono truncate max-w-[160px]" title={log.model}>
        {log.model || "—"}
      </td>
      <td className="px-4 py-2 text-right">
        {isError ? (
          <span className="text-red-400" title={log.error}>
            {log.statusCode}
          </span>
        ) : (
          <span className="text-emerald-400">{log.statusCode}</span>
        )}
      </td>
      <td className="px-4 py-2 text-right text-text-muted font-mono">
        {formatDuration(log.durationMs)}
      </td>
      <td className="px-4 py-2 text-right text-text-muted font-mono">
        {formatTokens(log.totalTokens)}
      </td>
      <td className="px-4 py-2 text-right text-text-muted font-mono">
        {formatCost(log.cost)}
      </td>
    </tr>
  );
}

function LogDetails({ log }: { log: ApiLog }) {
  const request = log.request;

  return (
    <tr className="bg-surface-2/40 border-b border-border/50">
      <td colSpan={10} className="px-4 py-4">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <DetailCard label="Request ID" value={request?.requestId || "—"} mono />
            <DetailCard label="Requested model" value={request?.modelRequested || "(default)"} mono />
            <DetailCard label="Prompt chars" value={String(log.promptLength)} mono />
            <DetailCard label="Response chars" value={String(log.responseLength)} mono />
          </div>

          {log.error && (
            <div className="rounded-[var(--radius-sm)] border border-red-500/20 bg-red-500/8 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-red-300 font-medium mb-1">
                Error
              </div>
              <div className="text-[11px] text-red-100/90 whitespace-pre-wrap break-words">
                {log.error}
              </div>
            </div>
          )}

          {!request ? (
            <div className="rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-[11px] text-text-faint">
              This entry was created before request-context logging was added.
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              <FieldCard field={request.promptTemplate} />
              {request.fields.map((field) => (
                <FieldCard key={field.key} field={field} />
              ))}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

function FieldCard({ field }: { field: ApiLogFieldSnapshot }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
            {formatFieldLabel(field.key)}
          </div>
          <div className="text-[10px] text-text-faint">
            {field.length} chars, {formatSampleMode(field)}
          </div>
        </div>
      </div>
      <pre className="text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words font-[family-name:var(--font-mono)] m-0">
        {field.sample || "(empty)"}
      </pre>
    </div>
  );
}

function DetailCard({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-1">
        {label}
      </div>
      <div className={`text-[11px] text-text-secondary break-all ${mono ? "font-[family-name:var(--font-mono)]" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={12} className={color ?? "text-text-muted"} />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-text-faint">{label}</div>
        <div className={`text-xs font-mono ${color ?? "text-text-primary"}`}>{value}</div>
      </div>
    </div>
  );
}
