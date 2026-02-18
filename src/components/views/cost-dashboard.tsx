"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Loader2,
  Zap,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface UsageData {
  usage: Record<string, unknown> | null;
  cost: Record<string, unknown> | null;
  sessions?: Array<Record<string, unknown>> | null;
}

interface CostDailyRow {
  date?: string;
  totalCost?: number;
  totalTokens?: number;
  input?: number;
  output?: number;
  byAgent?: Record<string, { totalTokens?: number; totalCost?: number }>;
  by_agent?: Record<string, { totalTokens?: number; totalCost?: number }>;
}

function formatTokens(n: number | undefined | null): string {
  if (!n) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number | undefined | null): string {
  if (!n) return "$0.00";
  return `$${n.toFixed(2)}`;
}

function StatCard({
  label,
  value,
  subtitle,
  icon: Icon,
  trend,
  accentColor,
}: {
  label: string;
  value: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: "up" | "down" | "flat";
  accentColor?: string;
}) {
  return (
    <div className="glass-panel rounded-lg p-5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <div
          className={`w-8 h-8 rounded flex items-center justify-center ${accentColor || "bg-primary/10"}`}
        >
          <Icon className={`w-4 h-4 ${accentColor ? "text-white" : "text-primary"}`} />
        </div>
      </div>
      <div className="text-2xl font-bold font-mono">{value}</div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {trend === "up" && <TrendingUp className="w-3.5 h-3.5 text-green-500" />}
        {trend === "down" && <TrendingDown className="w-3.5 h-3.5 text-red-400" />}
        {trend === "flat" && <Minus className="w-3.5 h-3.5" />}
        {subtitle && <span>{subtitle}</span>}
      </div>
    </div>
  );
}

function BarChart({
  data,
  maxHeight = 120,
}: {
  data: { label: string; value: number; color?: string }[];
  maxHeight?: number;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-2 justify-around" style={{ height: maxHeight }}>
      {data.map((d, i) => (
        <div key={i} className="flex flex-col items-center gap-1.5 flex-1">
          <div
            className="w-full rounded-t transition-all duration-500"
            style={{
              height: `${(d.value / max) * maxHeight * 0.85}px`,
              backgroundColor: d.color || "oklch(0.58 0.2 260)",
              minHeight: d.value > 0 ? 4 : 0,
            }}
          />
          <span className="text-[10px] text-muted-foreground font-mono">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function HorizontalBar({
  items,
}: {
  items: { label: string; value: number; color: string }[];
}) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <div className="space-y-2.5">
      {items.map((item, i) => {
        const pct = Math.round((item.value / total) * 100);
        return (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">{item.label}</span>
              <span className="text-muted-foreground font-mono">{pct}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${pct}%`,
                  backgroundColor: item.color,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function CostDashboard() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("today");

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/openclaw/usage");
      const json = await res.json();
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsage();
    const interval = setInterval(fetchUsage, 60000);
    return () => clearInterval(interval);
  }, [fetchUsage]);

  // Extract whatever data the gateway returns
  const usage = (data?.usage || {}) as Record<string, unknown>;
  const cost = (data?.cost || {}) as Record<string, unknown>;
  const daily = Array.isArray(cost.daily) ? (cost.daily as Array<CostDailyRow>) : [];

  const periodDays = period === "today" ? 1 : period === "7d" ? 7 : 30;
  const selectedDays = daily.slice(-periodDays);

  const sum = (key: string): number =>
    selectedDays.reduce((acc, row) => acc + (Number(row[key]) || 0), 0);

  const inputTokensRaw = sum("input");
  const outputTokensRaw = sum("output");
  const totalCostRaw = sum("totalCost");

  const inputTokens =
    inputTokensRaw ??
    (usage.inputTokens as number | undefined | null) ??
    (usage.input_tokens as number | undefined | null) ??
    0;
  const outputTokens =
    outputTokensRaw ??
    (usage.outputTokens as number | undefined | null) ??
    (usage.output_tokens as number | undefined | null) ??
    0;
  const totalCost =
    totalCostRaw ??
    (cost.totalCost as number | undefined | null) ??
    (cost.total as number | undefined | null) ??
    (cost.cost as number | undefined | null) ??
    0;

  const sessionsFromList = Array.isArray(data?.sessions) ? data.sessions.length : undefined;
  const sessions =
    sessionsFromList ??
    (usage.sessions as number | undefined | null) ??
    (usage.activeSessions as number | undefined | null) ??
    0;

  const dailyData = selectedDays.map((row) => {
    const date = String(row.date || "");
    const total = row.totalTokens;
    const value =
      total !== null && total !== undefined
        ? Number(total)
        : (Number(row.input ?? 0) + Number(row.output ?? 0));

    return {
      label: date ? date.slice(5) : "—",
      value: Number.isFinite(value) ? value : 0,
      color: "oklch(0.58 0.2 260)",
    };
  });

  const providers = Array.isArray(usage.providers)
    ? (usage.providers as Array<{
        provider?: string;
        displayName?: string;
        windows?: Array<{ label?: string; usedPercent?: number }>;
      }>)
    : [];

  const providerWindows = providers
    .flatMap((p) => {
      const windows = Array.isArray(p.windows) ? p.windows : [];
      return windows.map((w) => ({
        label: `${p.displayName || p.provider || "provider"} ${w.label || ""}`.trim(),
        value: Number(w.usedPercent) || 0,
        color: "oklch(0.58 0.2 260)",
      }));
    })
    .filter((w) => w.value > 0);

  const sessionsByAgent = (() => {
    // Prefer period-aware cost breakdown when available.
    const fromDaily = new Map<string, number>();
    for (const row of selectedDays) {
      const byAgent = row.byAgent || row.by_agent;
      if (!byAgent || typeof byAgent !== "object") continue;
      for (const [agent, metrics] of Object.entries(byAgent)) {
        const tokenOrCost =
          metrics?.totalTokens !== null && metrics?.totalTokens !== undefined
            ? metrics.totalTokens
            : metrics?.totalCost;
        const inc = Number(tokenOrCost ?? 0);
        fromDaily.set(agent.toLowerCase(), (fromDaily.get(agent.toLowerCase()) || 0) + inc);
      }
    }

    const sourceMap = fromDaily.size > 0 ? fromDaily : (() => {
      // Fallback to session activity in selected period.
      const list = (data?.sessions || []) as Array<{
        agentId?: string;
        key?: string;
        updatedAt?: number;
        lastActivity?: number;
      }>;
      const now = Date.now();
      const cutoffMs = now - periodDays * 24 * 60 * 60 * 1000;
      const counts = new Map<string, number>();

      for (const s of list) {
        const activityMs = Number(s.lastActivity) || Number(s.updatedAt) || 0;
        if (activityMs && activityMs < cutoffMs) continue;

        let agent = s.agentId;
        if (!agent && typeof s.key === "string") {
          const m = s.key.match(/^agent:([^:]+):/);
          if (m?.[1]) agent = m[1];
        }
        const key = (agent || "main").toLowerCase();
        counts.set(key, (counts.get(key) || 0) + 1);
      }

      return counts;
    })();

    return Array.from(sourceMap.entries())
      .map(([label, value], i) => ({
        label,
        value,
        color: ["oklch(0.58 0.2 260)", "oklch(0.7 0.17 162)", "oklch(0.77 0.19 70)"][i % 3],
      }))
      .sort((a, b) => b.value - a.value);
  })();

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold">Usage & Costs</h2>
          <p className="text-sm text-muted-foreground">
            Track your AI spending and token consumption
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Period selector */}
          <div className="flex bg-muted rounded overflow-hidden border border-border">
            {["today", "7d", "30d"].map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-xs font-medium transition-all ${
                  period === p
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p === "today" ? "Today" : p === "7d" ? "7 Days" : "30 Days"}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchUsage}
            disabled={loading}
            className="gap-1.5"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total Cost"
          value={formatCost(totalCost)}
          subtitle="this period"
          icon={DollarSign}
          trend={totalCost > 0 ? "up" : "flat"}
          accentColor="bg-green-600"
        />
        <StatCard
          label="Input Tokens"
          value={formatTokens(inputTokens)}
          subtitle="prompts sent"
          icon={TrendingUp}
          trend={inputTokens > 0 ? "up" : "flat"}
        />
        <StatCard
          label="Output Tokens"
          value={formatTokens(outputTokens)}
          subtitle="responses received"
          icon={Zap}
          trend={outputTokens > 0 ? "up" : "flat"}
        />
        <StatCard
          label="Active Sessions"
          value={String(sessions)}
          subtitle="running now"
          icon={BarChart3}
          trend="flat"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-3 gap-4">
        {/* Usage Over Time */}
        <div className="col-span-2 glass-panel rounded-lg p-5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">
            Usage Over Time
          </h3>
          {dailyData.length > 0 && dailyData.some((d) => d.value > 0) ? (
            <BarChart data={dailyData} maxHeight={140} />
          ) : (
            <div className="flex items-center justify-center h-[140px] text-sm text-muted-foreground">
              No usage data yet for selected period
            </div>
          )}
        </div>

        {/* By Agent (active sessions) */}
        <div className="glass-panel rounded-lg p-5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">
            By Agent
          </h3>
          {sessionsByAgent.length > 0 ? (
            <HorizontalBar items={sessionsByAgent} />
          ) : providerWindows.length > 0 ? (
            <HorizontalBar items={providerWindows} />
          ) : (
            <div className="text-sm text-muted-foreground">No agent activity data yet</div>
          )}
        </div>
      </div>

      {/* Raw data (collapsed) */}
      {data && (
        <details className="mt-6">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
            Show raw gateway response
          </summary>
          <pre className="mt-2 bg-muted/50 rounded border border-border p-3 text-xs font-mono overflow-auto max-h-48">
            {JSON.stringify(data, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
