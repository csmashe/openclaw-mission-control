"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTheme } from "next-themes";
import {
  LayoutDashboard,
  Bot,
  Rocket,
  Settings,
  Plus,
  MoreHorizontal,
  CheckCircle2,
  Send,
  Trash2,
  X,
  Wifi,
  WifiOff,
  Moon,
  Sun,
  Monitor,
  Terminal,
  AlertTriangle,
  Wrench,
  DollarSign,
  Shield,
  Clock,
  FileText,
  MessageSquare,
} from "lucide-react";
import { ToolsPlayground } from "@/components/views/tools-playground";
import { CostDashboard } from "@/components/views/cost-dashboard";
import { ApprovalCenter } from "@/components/views/approval-center";
import { CronScheduler } from "@/components/views/cron-scheduler";
import { LogsViewer } from "@/components/views/logs-viewer";
import { SettingsPanel, getStoredModelPreference } from "@/components/views/settings-panel";
import { ChatPanel } from "@/components/views/chat-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

// --- Types ---

interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  mission_id: string | null;
  assigned_agent_id: string | null;
  openclaw_session_key: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface TaskComment {
  id: string;
  task_id: string;
  agent_id: string | null;
  author_type: string;
  content: string;
  created_at: string;
}

interface ActivityEntry {
  id: string;
  type: string;
  agent_id: string | null;
  task_id: string | null;
  message: string;
  metadata: string;
  created_at: string;
}

interface Agent {
  id: string;
  name?: string;
  model?: string;
}

interface GatewayStatus {
  connected: boolean;
  agentCount: number;
  cronJobCount: number;
  error?: string;
}

interface DevicePairStatus {
  pendingCount: number;
  latestPending?: {
    requestId?: string;
    displayName?: string;
    clientId?: string;
    clientMode?: string;
    scopes?: string[];
  } | null;
  error?: string;
}

type ColumnId = "inbox" | "assigned" | "in_progress" | "review" | "done";

const COLUMNS: { id: ColumnId; label: string }[] = [
  { id: "inbox", label: "INBOX" },
  { id: "assigned", label: "ASSIGNED" },
  { id: "in_progress", label: "IN PROGRESS" },
  { id: "review", label: "REVIEW" },
  { id: "done", label: "DONE" },
];

// --- Helpers ---

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr + "Z");
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr + "Z");
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function getColumnDotColor(id: ColumnId): string {
  switch (id) {
    case "inbox": return "bg-slate-400";
    case "assigned": return "bg-primary/50";
    case "in_progress": return "bg-primary shadow-[0_0_8px_oklch(0.58_0.2_260)]";
    case "review": return "bg-purple-500";
    case "done": return "bg-green-500";
  }
}

function getPriorityStyle(priority: string) {
  switch (priority) {
    case "urgent": return { className: "text-red-400 bg-red-400/10 border-red-400/20", label: "URGENT" };
    case "high": return { className: "text-red-400 bg-red-400/10 border-red-400/20", label: "HIGH" };
    case "medium": return { className: "text-orange-400 bg-orange-400/10 border-orange-400/20", label: "MED" };
    case "low": return { className: "text-primary bg-primary/10 border-primary/20", label: "LOW" };
    default: return { className: "text-slate-400 bg-slate-400/10 border-slate-400/20", label: priority.toUpperCase() };
  }
}

function getActivityColor(type: string): string {
  if (type.includes("created")) return "text-primary font-bold";
  if (type.includes("assigned")) return "text-blue-400 font-bold";
  if (type.includes("progress")) return "text-green-500 font-bold";
  if (type.includes("review")) return "text-purple-400 font-bold";
  if (type.includes("deleted")) return "text-red-400 font-bold";
  if (type.includes("agent")) return "text-green-500 font-bold";
  return "text-primary font-bold";
}

function getActivityLabel(type: string): string {
  if (type.includes("created")) return "Info:";
  if (type.includes("assigned")) return "Agent:";
  if (type.includes("progress")) return "Agent:";
  if (type.includes("review")) return "System:";
  if (type.includes("agent")) return "Agent:";
  return "System:";
}

// --- Theme Toggle ---

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="w-8 h-8" />;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="w-8 h-8 rounded flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/5 transition-all"
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{theme === "dark" ? "Light mode" : "Dark mode"}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// --- View routing ---
const VALID_VIEWS = ["board", "agents", "missions", "tools", "usage", "approvals", "cron", "logs", "settings", "chat"] as const;
type ViewId = (typeof VALID_VIEWS)[number];

function getViewFromHash(): ViewId {
  if (typeof window === "undefined") return "board";
  const hash = window.location.hash.replace("#", "");
  return (VALID_VIEWS as readonly string[]).includes(hash) ? (hash as ViewId) : "board";
}

// --- Main Component ---

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus>({
    connected: false,
    agentCount: 0,
    cronJobCount: 0,
  });
  const [devicePairStatus, setDevicePairStatus] = useState<DevicePairStatus>({ pendingCount: 0 });
  const [approvingDevicePair, setApprovingDevicePair] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDispatchModal, setShowDispatchModal] = useState<Task | null>(null);
  const [showTaskDetail, setShowTaskDetail] = useState<Task | null>(null);
  const [activeView, setActiveViewState] = useState<ViewId>(getViewFromHash);
  const setActiveView = useCallback((view: ViewId) => {
    setActiveViewState(view);
    window.location.hash = view === "board" ? "" : view;
  }, []);

  useEffect(() => {
    const onHashChange = () => setActiveViewState(getViewFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);

  // --- Data Fetching ---

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch { /* retry */ }
  }, []);

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/activity");
      const data = await res.json();
      setActivity(data.activity || []);
    } catch { /* retry */ }
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      setAgents(data.agents || []);
    } catch { /* retry */ }
  }, []);

  const fetchGatewayStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/openclaw/status");
      const data = await res.json();
      setGatewayStatus(data);
    } catch {
      setGatewayStatus({ connected: false, agentCount: 0, cronJobCount: 0 });
    }
  }, []);

  const fetchDevicePairStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/openclaw/device-pair");
      const data = await res.json();
      setDevicePairStatus({
        pendingCount: data?.pendingCount ?? 0,
        latestPending: data?.latestPending ?? null,
        error: data?.error,
      });
    } catch (error) {
      setDevicePairStatus({ pendingCount: 0, error: String(error) });
    }
  }, []);

  const approveLatestDevicePair = useCallback(async () => {
    setApprovingDevicePair(true);
    try {
      const res = await fetch("/api/openclaw/device-pair", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const detail = body?.error || `HTTP ${res.status}`;
        setDevicePairStatus((prev) => ({ ...prev, error: `Approval failed: ${detail}` }));
        return;
      }
      setDevicePairStatus((prev) => ({ ...prev, error: undefined }));
      await fetchDevicePairStatus();
      await fetchGatewayStatus();
      await fetchAgents();
    } catch (err) {
      setDevicePairStatus((prev) => ({ ...prev, error: `Approval failed: ${String(err)}` }));
    } finally {
      setApprovingDevicePair(false);
    }
  }, [fetchAgents, fetchDevicePairStatus, fetchGatewayStatus]);

  useEffect(() => {
    fetchTasks();
    fetchActivity();
    fetchAgents();
    fetchGatewayStatus();
    fetchDevicePairStatus();

    const interval = setInterval(async () => {
      // Check if any agent-assigned tasks have completed before fetching
      try { await fetch("/api/tasks/check-completion"); } catch { /* ignore */ }
      fetchTasks();
      fetchActivity();
      fetchGatewayStatus();
      fetchDevicePairStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchTasks, fetchActivity, fetchAgents, fetchGatewayStatus, fetchDevicePairStatus]);

  // --- Task Actions ---

  const createTask = async (data: { title: string; description: string; priority: string; assigned_agent_id?: string }) => {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await res.json();

    // Auto-dispatch if agent is assigned
    if (data.assigned_agent_id && result.task?.id) {
      const pref = getStoredModelPreference();
      await fetch("/api/tasks/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: result.task.id,
          agentId: data.assigned_agent_id,
          ...(pref ? { model: pref.model, provider: pref.provider } : {}),
        }),
      });
    }

    await fetchTasks();
    await fetchActivity();
    setShowCreateModal(false);
  };

  const moveTask = async (taskId: string, newStatus: string) => {
    await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: taskId, status: newStatus }),
    });
    await fetchTasks();
    await fetchActivity();
  };

  const deleteTask = async (taskId: string) => {
    await fetch(`/api/tasks?id=${taskId}`, { method: "DELETE" });
    await fetchTasks();
    await fetchActivity();
  };

  const dispatchTask = async (taskId: string, agentId: string) => {
    const pref = getStoredModelPreference();
    const res = await fetch("/api/tasks/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId,
        agentId,
        ...(pref ? { model: pref.model, provider: pref.provider } : {}),
      }),
    });
    const data = await res.json();
    setShowDispatchModal(null);
    await fetchTasks();
    await fetchActivity();
    return data;
  };

  // --- Drag and Drop ---
  const handleDragStart = (task: Task) => setDraggedTask(task);
  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    setDragOverColumn(columnId);
  };
  const handleDragLeave = () => setDragOverColumn(null);
  const handleDrop = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    setDragOverColumn(null);
    if (draggedTask && draggedTask.status !== columnId) {
      if (columnId === "assigned") {
        // Route through dispatch flow so the agent actually gets the message
        if (draggedTask.assigned_agent_id) {
          dispatchTask(draggedTask.id, draggedTask.assigned_agent_id);
        } else {
          // No agent assigned — open dispatch modal to pick one
          setShowDispatchModal(draggedTask);
        }
      } else {
        moveTask(draggedTask.id, columnId);
      }
    }
    setDraggedTask(null);
  };

  const getColumnTasks = (status: string) => tasks.filter((t) => t.status === status);

  const NAV_ITEMS = [
    { id: "board" as const, icon: LayoutDashboard, label: "Dashboard" },
    { id: "chat" as const, icon: MessageSquare, label: "Chat" },
    { id: "agents" as const, icon: Bot, label: "Agents" },
    { id: "missions" as const, icon: Rocket, label: "Missions" },
    { id: "tools" as const, icon: Wrench, label: "Tools" },
    { id: "usage" as const, icon: DollarSign, label: "Usage" },
    { id: "approvals" as const, icon: Shield, label: "Approvals" },
    { id: "cron" as const, icon: Clock, label: "Schedules" },
    { id: "logs" as const, icon: FileText, label: "Logs" },
  ];

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ===== Icon Sidebar ===== */}
      <aside className="w-16 flex flex-col items-center py-6 border-r border-border bg-card/50 z-20 shrink-0">
        {/* Logo */}
        <div className="mb-8 w-10 h-10 rounded bg-primary/20 flex items-center justify-center shadow-[0_0_5px_oklch(0.58_0.2_260/0.3)] cursor-pointer group">
          <Terminal className="w-5 h-5 text-primary group-hover:animate-pulse" />
        </div>

        {/* Nav */}
        <nav className="flex-1 flex flex-col gap-3 w-full items-center">
          {NAV_ITEMS.map((item) => {
            const isActive = item.id && activeView === item.id;
            const Icon = item.icon;
            return (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      if (item.id) {
                        setActiveView(item.id);
                        if (item.id === "agents") fetchAgents();
                      }
                    }}
                    className={`w-10 h-10 rounded flex items-center justify-center transition-all relative group ${
                      isActive
                        ? "text-primary bg-primary/10 shadow-[0_0_10px_oklch(0.58_0.2_260/0.3)]"
                        : "text-muted-foreground hover:text-primary hover:bg-primary/5"
                    }`}
                  >
                    {isActive && (
                      <span className="absolute left-0 w-1 h-6 bg-primary rounded-r" />
                    )}
                    <Icon className="w-5 h-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{item.label}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        {/* Bottom actions */}
        <div className="flex flex-col gap-3 w-full items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setActiveView("settings")}
                className={`w-10 h-10 rounded flex items-center justify-center transition-all relative group ${
                  activeView === "settings"
                    ? "text-primary bg-primary/10 shadow-[0_0_10px_oklch(0.58_0.2_260/0.3)]"
                    : "text-muted-foreground hover:text-primary hover:bg-primary/5"
                }`}
              >
                {activeView === "settings" && (
                  <span className="absolute left-0 w-1 h-6 bg-primary rounded-r" />
                )}
                <Settings className="w-5 h-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Settings</p>
            </TooltipContent>
          </Tooltip>
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary border border-primary/30">
            MC
          </div>
        </div>
      </aside>

      {/* ===== Main Content ===== */}
      <main className="flex-1 flex flex-col min-w-0 relative">
        {/* Grid pattern background */}
        <div className="absolute inset-0 z-0 opacity-50 pointer-events-none grid-pattern" />

        {/* Header */}
        <header className="h-14 border-b border-border bg-card/80 backdrop-blur-sm flex items-center justify-between px-6 z-10 shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold tracking-wider uppercase flex items-center gap-2">
              <span className="text-primary font-mono text-xl">{"//"}</span>
              Mission Control
            </h1>
            <Separator orientation="vertical" className="h-6" />
            <div className="flex items-center gap-2 text-xs font-mono text-primary">
              <span className="relative flex h-2 w-2">
                {gatewayStatus.connected && (
                  <span className="ping-slow absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                )}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${gatewayStatus.connected ? "bg-primary" : "bg-destructive"}`} />
              </span>
              {gatewayStatus.connected ? "SYSTEM ONLINE" : "OFFLINE"}
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            {/* Connection pill */}
            <div className="flex items-center gap-2 text-muted-foreground bg-muted px-3 py-1.5 rounded border border-border">
              {gatewayStatus.connected ? (
                <Wifi className="w-3.5 h-3.5 text-green-500" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-destructive" />
              )}
              <span>ws://127.0.0.1:18789</span>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-end leading-none gap-1">
                <span className="text-muted-foreground text-[10px] uppercase">Agents</span>
                <span className="font-bold">{gatewayStatus.agentCount}</span>
              </div>
              <div className="flex flex-col items-end leading-none gap-1">
                <span className="text-muted-foreground text-[10px] uppercase">Tasks</span>
                <span className="text-primary font-bold">{tasks.length}</span>
              </div>
            </div>

            <Separator orientation="vertical" className="h-6" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setTerminalOpen(!terminalOpen)}
                  className={`w-8 h-8 rounded flex items-center justify-center transition-all ${
                    terminalOpen
                      ? "text-primary bg-primary/10"
                      : "text-muted-foreground hover:text-primary hover:bg-primary/5"
                  }`}
                >
                  <Terminal className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{terminalOpen ? "Hide terminal" : "Show terminal"}</p>
              </TooltipContent>
            </Tooltip>
            <ThemeToggle />
          </div>
        </header>

        {devicePairStatus.pendingCount > 0 && (
          <div className="z-10 border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 flex items-center justify-between gap-3">
            <div className="text-xs">
              <span className="font-semibold text-amber-300">Device approval required:</span>{" "}
              <span className="text-amber-100/90">
                Mission Control has {devicePairStatus.pendingCount} pending pairing request{devicePairStatus.pendingCount > 1 ? "s" : ""}.
                {devicePairStatus.error && (
                  <span className="text-red-400 ml-2">{devicePairStatus.error}</span>
                )}
              </span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={approveLatestDevicePair}
                    disabled={approvingDevicePair}
                    className="h-7 text-xs"
                  >
                    {approvingDevicePair ? "Approving..." : "Approve latest device"}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Approve latest pending device request</p>
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 flex overflow-hidden z-10 relative">
          {activeView === "board" && (
            <KanbanBoard
              columns={COLUMNS}
              getColumnTasks={getColumnTasks}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              dragOverColumn={dragOverColumn}
              onDeleteTask={deleteTask}
              onDispatchTask={(task) => setShowDispatchModal(task)}
              onViewTask={(task) => setShowTaskDetail(task)}
              onMoveToDown={(taskId: string) => moveTask(taskId, "done")}
              onCreateTask={() => setShowCreateModal(true)}
            />
          )}
          {activeView === "agents" && (
            <AgentsView
              status={gatewayStatus}
              agents={agents}
              onRefresh={fetchAgents}
            />
          )}
          {activeView === "missions" && <MissionsView />}
          {activeView === "tools" && <ToolsPlayground />}
          {activeView === "usage" && <CostDashboard />}
          {activeView === "approvals" && <ApprovalCenter />}
          {activeView === "cron" && <CronScheduler />}
          {activeView === "logs" && <LogsViewer />}
          {activeView === "settings" && <SettingsPanel />}
          {activeView === "chat" && <ChatPanel />}

          {/* ===== Floating Live Terminal ===== */}
          <aside
            className={`absolute top-0 right-0 bottom-0 w-80 border-l border-border bg-background flex flex-col z-30 font-mono text-xs shadow-[-4px_0_24px_oklch(0_0_0/0.15)] transition-transform duration-300 ease-in-out ${
              terminalOpen ? "translate-x-0" : "translate-x-full"
            }`}
          >
            <div className="p-4 border-b border-border bg-card/50 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-primary" />
                <span className="font-bold tracking-wide text-sm">LIVE TERMINAL</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <button
                  onClick={() => setTerminalOpen(false)}
                  className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4 text-muted-foreground font-mono">
                {activity.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground/50">
                    <Terminal className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p>Waiting for activity...</p>
                  </div>
                ) : (
                  activity.map((entry, i) => (
                    <div
                      key={entry.id}
                      className="flex gap-2 leading-relaxed"
                      style={{ opacity: Math.max(0.5, 1 - i * 0.06) }}
                    >
                      <span className="text-muted-foreground/60 shrink-0 tabular-nums">
                        [{formatTime(entry.created_at)}]
                      </span>
                      <div className="wrap-break-word min-w-0">
                        <span className={getActivityColor(entry.type)}>
                          {getActivityLabel(entry.type)}
                        </span>{" "}
                        <span className="text-foreground">
                          {entry.message}
                        </span>
                      </div>
                    </div>
                  ))
                )}

                {/* Blinking cursor */}
                <div className="mt-4 flex gap-2 items-center">
                  <span className="text-primary">{">"}                  </span>
                  <span className="w-2 h-4 bg-primary cursor-blink" />
                </div>
              </div>
            </ScrollArea>

            {/* Command input */}
            <div className="p-3 border-t border-border bg-card/50">
              <div className="flex items-center gap-2 bg-muted rounded px-3 py-2 border border-border focus-within:border-primary transition-colors">
                <span className="text-muted-foreground">$</span>
                <input
                  className="bg-transparent border-none text-foreground focus:ring-0 focus:outline-none p-0 text-xs w-full font-mono placeholder:text-muted-foreground/40"
                  placeholder="Enter command..."
                  type="text"
                />
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* ===== Modals ===== */}
      <CreateTaskModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        onCreate={createTask}
        agents={agents}
      />
      {showDispatchModal && (
        <DispatchModal
          task={showDispatchModal}
          agents={agents}
          onClose={() => setShowDispatchModal(null)}
          onDispatch={dispatchTask}
        />
      )}
      {showTaskDetail && (
        <TaskDetailModal
          task={showTaskDetail}
          onClose={() => setShowTaskDetail(null)}
          onMoveToDone={() => { moveTask(showTaskDetail.id, "done"); setShowTaskDetail(null); }}
          onRefresh={async () => { await fetchTasks(); const updated = tasks.find(t => t.id === showTaskDetail.id); if (updated) setShowTaskDetail(updated); }}
        />
      )}
    </div>
  );
}

// --- Kanban Board ---

function KanbanBoard({
  columns,
  getColumnTasks,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  dragOverColumn,
  onDeleteTask,
  onDispatchTask,
  onViewTask,
  onMoveToDown,
  onCreateTask,
}: {
  columns: typeof COLUMNS;
  getColumnTasks: (status: string) => Task[];
  onDragStart: (task: Task) => void;
  onDragOver: (e: React.DragEvent, columnId: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, columnId: string) => void;
  dragOverColumn: string | null;
  onDeleteTask: (id: string) => void;
  onDispatchTask: (task: Task) => void;
  onViewTask: (task: Task) => void;
  onMoveToDown?: (id: string) => void;
  onCreateTask?: () => void;
}) {
  return (
    <div className="flex-1 min-h-0 min-w-0 overflow-x-auto overflow-y-hidden p-6">
      <div className="flex h-full min-h-0 gap-4">
        {columns.map((col) => {
          const colTasks = getColumnTasks(col.id);
          const isActive = col.id === "in_progress";
          const isDragOver = dragOverColumn === col.id;

          return (
            <div
              key={col.id}
              className={`flex-1 flex min-h-0 flex-col min-w-0 overflow-hidden rounded-lg border backdrop-blur-sm ${
                isActive
                  ? "border-t-2 border-t-primary border-x-border border-b-border column-glow"
                  : "border-border"
              } ${isDragOver ? "ring-2 ring-primary/30" : ""} bg-muted/30`}
            >
              {/* Column Header */}
              <div className="shrink-0 p-3 border-b border-border/50 flex justify-between items-center relative z-10">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${getColumnDotColor(col.id)}`} />
                  <h3 className={`font-bold text-sm tracking-wide ${isActive ? "text-primary" : ""}`}>
                    {col.label}
                  </h3>
                  <span className={`text-[10px] px-1.5 rounded font-mono border ${
                    isActive
                      ? "bg-primary/20 text-primary border-primary/20"
                      : "bg-muted text-muted-foreground border-border"
                  }`}>
                    {colTasks.length}
                  </span>
                </div>
                {col.id === "inbox" ? (
                  <button
                    onClick={onCreateTask}
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                ) : col.id === "done" ? (
                  <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                )}
              </div>

              {/* Column Body */}
              <ScrollArea className="flex-1 min-h-0">
                <div
                  className="p-3 flex flex-col gap-3 min-h-full min-w-0 overflow-x-hidden relative z-10"
                  onDragOver={(e) => onDragOver(e, col.id)}
                  onDragLeave={onDragLeave}
                  onDrop={(e) => onDrop(e, col.id)}
                >
                  {colTasks.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground/40 text-xs">
                      Drop tasks here
                    </div>
                  ) : (
                    colTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        isInProgress={isActive}
                        onDragStart={() => onDragStart(task)}
                        onDelete={() => onDeleteTask(task.id)}
                        onDispatch={() => onDispatchTask(task)}
                        onClick={() => onViewTask(task)}
                        onMoveToDown={onMoveToDown ? () => onMoveToDown(task.id) : undefined}
                      />
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Task Card ---

function TaskCard({
  task,
  isInProgress,
  onDragStart,
  onDelete,
  onDispatch,
  onClick,
  onMoveToDown,
}: {
  task: Task;
  isInProgress?: boolean;
  onDragStart: () => void;
  onDelete: () => void;
  onDispatch: () => void;
  onClick: () => void;
  onMoveToDown?: () => void;
}) {
  const showDispatch = task.status === "inbox" && !task.assigned_agent_id;
  const showDone = task.status === "review";
  const isReview = task.status === "review";
  const isAgentWorking = isInProgress && !!task.assigned_agent_id;
  const isDone = task.status === "done";
  const priority = getPriorityStyle(task.priority);

  return (
    <div
      className={`group min-w-0 bg-card p-4 rounded border shadow-sm hover:shadow-[0_0_15px_oklch(0.58_0.2_260/0.1)] transition-all cursor-pointer relative overflow-hidden ${
        isAgentWorking
          ? "border-primary/50 animate-[pulse_3s_ease-in-out_infinite]"
          : isReview
          ? "border-amber-500/50 shadow-[0_0_10px_oklch(0.75_0.15_85/0.1)]"
          : isDone
          ? "border-border opacity-60 hover:opacity-100"
          : "border-border hover:border-primary/50"
      }`}
      draggable={!isAgentWorking}
      onDragStart={isAgentWorking ? undefined : onDragStart}
      onClick={onClick}
    >
      {/* Active task left accent */}
      {isInProgress && task.assigned_agent_id && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
      )}

      {/* Header: priority + ID */}
      <div className={`flex justify-between items-start mb-2 ${isInProgress && task.assigned_agent_id ? "pl-2" : ""}`}>
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${priority.className} ${isDone ? "line-through" : ""}`}>
          {priority.label}
        </span>
        <span className={`text-[10px] font-mono text-muted-foreground ${isDone ? "line-through" : ""}`}>
          #{task.sort_order}
        </span>
      </div>

      {/* Title */}
      <h4 className={`min-w-0 break-words text-sm font-medium mb-3 leading-snug ${
        isInProgress && task.assigned_agent_id ? "pl-2" : ""
      } ${isDone ? "line-through text-muted-foreground" : ""}`}>
        {task.title}
      </h4>

      {/* Progress bar for active tasks */}
      {isInProgress && task.assigned_agent_id && (
        <div className="w-full h-1 bg-muted rounded-full mb-3 ml-2 overflow-hidden" style={{ width: "calc(100% - 8px)" }}>
          <div className="h-full bg-primary w-2/3 animate-pulse" />
        </div>
      )}

      {/* Footer */}
      <div className={`flex justify-between items-center pt-2 border-t border-border/50 ${
        isInProgress && task.assigned_agent_id ? "pl-2" : ""
      }`}>
        <div className="flex items-center gap-2">
          {task.assigned_agent_id ? (
            <div className="flex items-center gap-2">
              <div className="relative">
                <div className="w-6 h-6 rounded-full bg-primary/20 border border-primary flex items-center justify-center">
                  <Bot className="w-3 h-3 text-primary" />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-background rounded-full flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_5px_lime]" />
                </div>
              </div>
              <span className="max-w-28 truncate text-[10px] text-primary font-mono" title={task.assigned_agent_id}>{task.assigned_agent_id}</span>
            </div>
          ) : isDone ? (
            <div className="w-6 h-6 rounded-full bg-green-900/30 border border-green-800 flex items-center justify-center text-[10px] text-green-500">
              ✓
            </div>
          ) : (
            <div className="w-6 h-6 rounded-full bg-muted border border-border flex items-center justify-center text-[10px] text-muted-foreground">
              ?
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {isAgentWorking && (
            <span className="text-[10px] font-mono text-primary animate-pulse">🤖 Working...</span>
          )}
          {isReview && (
            <span className="text-[10px] font-mono text-amber-500">📋 Needs Review</span>
          )}
          {showDispatch && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onDispatch(); }}
              className="h-6 px-2 text-[10px] text-primary hover:text-primary"
            >
              <Send className="w-3 h-3 mr-1" /> Dispatch
            </Button>
          )}
          {showDone && onMoveToDown && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onMoveToDown(); }}
              className="h-6 px-2 text-[10px] text-green-500 hover:text-green-400"
            >
              <CheckCircle2 className="w-3 h-3 mr-1" /> Done
            </Button>
          )}
          {!isDone && (
            <span className="text-[10px] font-mono text-muted-foreground">{timeAgo(task.created_at)}</span>
          )}
          {isDone && (
            <span className="text-[10px] font-mono text-green-600/70">{timeAgo(task.updated_at)}</span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 ml-1 text-muted-foreground hover:text-destructive transition-all"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Create Task Modal ---

function CreateTaskModal({ open, onOpenChange, onCreate, agents }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (data: { title: string; description: string; priority: string; assigned_agent_id?: string }) => void;
  agents: Agent[];
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [agentId, setAgentId] = useState("none");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onCreate({
      title: title.trim(),
      description: description.trim(),
      priority,
      ...(agentId !== "none" ? { assigned_agent_id: agentId } : {}),
    });
    setTitle("");
    setDescription("");
    setPriority("medium");
    setAgentId("none");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Create New Task</DialogTitle>
          <DialogDescription>Add a new task to the inbox.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Title</label>
              <input
                type="text"
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs to be done?"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <textarea
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring min-h-[80px] resize-y"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional details..."
              />
            </div>
            <div className="flex gap-3">
              <div className="space-y-2 flex-1">
                <label className="text-sm font-medium">Priority</label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 flex-1">
                <label className="text-sm font-medium">Assign to Agent</label>
                <Select value={agentId} onValueChange={setAgentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="No agent" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span className="text-muted-foreground">Unassigned</span>
                    </SelectItem>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        <span className="flex items-center gap-1.5">
                          <Bot className="w-3 h-3" />
                          {a.name || a.id}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">Create Task</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Dispatch Modal ---

function DispatchModal({ task, agents, onClose, onDispatch }: {
  task: Task;
  agents: Agent[];
  onClose: () => void;
  onDispatch: (taskId: string, agentId: string) => Promise<unknown>;
}) {
  const [selectedAgent, setSelectedAgent] = useState(agents[0]?.id || "");
  const [dispatching, setDispatching] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleDispatch = async () => {
    if (!selectedAgent) return;
    setDispatching(true);
    try {
      const res = await onDispatch(task.id, selectedAgent);
      setResult((res as { ok: boolean }).ok ? "success" : "error");
    } catch {
      setResult("error");
    }
    setDispatching(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="w-5 h-5 text-primary" /> Dispatch Task to Agent
          </DialogTitle>
        </DialogHeader>

        {/* Task summary */}
        <div className="p-3 rounded-md bg-muted border border-border">
          <div className="font-medium text-sm">{task.title}</div>
          <div className="text-xs text-muted-foreground mt-1">{task.description || "No description"}</div>
          <div className="mt-2">
            <Badge variant="outline" className={getPriorityStyle(task.priority).className}>
              {task.priority}
            </Badge>
          </div>
        </div>

        {agents.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-yellow-500 p-3 bg-yellow-500/10 rounded-md border border-yellow-500/20">
            <AlertTriangle className="w-4 h-4" />
            No agents available. Go to Agents page to create one first.
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Agent</label>
              <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      <div className="flex items-center gap-2">
                        <Bot className="w-4 h-4" />
                        {agent.name || agent.id}
                        {agent.model && <span className="text-muted-foreground">({agent.model})</span>}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {result && (
              <div className={`p-3 rounded-md text-sm ${
                result === "success"
                  ? "bg-green-500/10 text-green-500 border border-green-500/20"
                  : "bg-destructive/10 text-destructive border border-destructive/20"
              }`}>
                {result === "success" ? "✅ Task dispatched! Agent is processing..." : "❌ Dispatch failed"}
              </div>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {result ? "Close" : "Cancel"}
          </Button>
          {agents.length > 0 && !result && (
            <Button onClick={handleDispatch} disabled={dispatching}>
              {dispatching ? "Dispatching..." : "Send to Agent"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Task Detail Modal ---

function TaskDetailModal({ task, onClose, onMoveToDone, onRefresh }: {
  task: Task;
  onClose: () => void;
  onMoveToDone: () => void;
  onRefresh: () => void;
}) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [reworkFeedback, setReworkFeedback] = useState("");
  const [showRework, setShowRework] = useState(false);
  const [reworking, setReworking] = useState(false);
  const [prevStatus, setPrevStatus] = useState(task.status);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/comments?taskId=${task.id}`);
      const data = await res.json();
      setComments(data.comments || []);
    } catch {} // retry on next interval
  }, [task.id]);

  useEffect(() => {
    fetchComments().then(() => setLoading(false));
    const interval = setInterval(async () => {
      await fetchComments();
      onRefresh(); // Also refresh task status
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchComments, onRefresh]);

  // Auto-scroll when new comments arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [comments.length]);

  // Detect status change
  useEffect(() => {
    if (task.status !== prevStatus) {
      setPrevStatus(task.status);
    }
  }, [task.status, prevStatus]);

  const addUserComment = async () => {
    if (!newComment.trim() || sendingComment) return;
    setSendingComment(true);
    try {
      await fetch("/api/tasks/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, content: newComment.trim() }),
      });
      setNewComment("");
      await fetchComments();
    } catch {} finally {
      setSendingComment(false);
    }
  };

  const requestRework = async () => {
    if (!reworkFeedback.trim() || reworking) return;
    setReworking(true);
    try {
      await fetch("/api/tasks/rework", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, feedback: reworkFeedback.trim() }),
      });
      setReworkFeedback("");
      setShowRework(false);
      await fetchComments();
      onRefresh();
    } catch {} finally {
      setReworking(false);
    }
  };

  const priority = getPriorityStyle(task.priority);
  const isAgentWorking = task.status === "in_progress" && !!task.assigned_agent_id;
  const isReview = task.status === "review";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] h-[85vh] max-h-[90vh] overflow-hidden flex flex-col min-h-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {task.title}
            {isAgentWorking && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/30 text-[11px] text-primary font-mono animate-pulse">
                🤖 Agent working...
              </span>
            )}
            {isReview && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-500 font-mono">
                📋 Ready for review
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2 pt-1">
            <Badge variant="outline" className={priority.className}>
              {priority.label}
            </Badge>
            <span className="text-xs uppercase text-muted-foreground">{task.status.replace("_", " ")}</span>
            {task.assigned_agent_id && (
              <Badge variant="secondary" className="gap-1">
                <Bot className="w-3 h-3" /> {task.assigned_agent_id}
              </Badge>
            )}
          </DialogDescription>
        </DialogHeader>

        {task.description && (
          <div className="p-3 rounded-md bg-muted border border-border text-sm text-muted-foreground leading-relaxed">
            {task.description}
          </div>
        )}

        {/* Agent Working Indicator */}
        {isAgentWorking && (
          <div className="flex items-center gap-3 p-3 rounded-md bg-primary/5 border border-primary/20">
            <div className="relative">
              <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary flex items-center justify-center">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-background rounded-full flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-ping" />
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-primary">{task.assigned_agent_id} is working on this task</div>
              <div className="text-[11px] text-muted-foreground">Response will appear below when complete. Manager monitor will move task to Review.</div>
            </div>
          </div>
        )}

        {/* Comments */}
        <div className="flex-1 min-h-0 max-h-[46vh] flex flex-col gap-2 overflow-hidden">
          <h4 className="text-sm font-medium text-muted-foreground shrink-0">
            Activity ({comments.length})
          </h4>
          <div className="flex-1 min-h-0 overflow-hidden">
            {loading ? (
              <div className="h-full text-sm text-muted-foreground animate-pulse py-4 text-center overflow-y-auto">Loading...</div>
            ) : comments.length === 0 ? (
              <div className="h-full text-sm text-muted-foreground py-4 text-center overflow-y-auto">
                No activity yet. Assign an agent to start working on this task.
              </div>
            ) : (
              <div className="h-full overflow-y-scroll pr-3" ref={scrollRef}>
                <div className="space-y-2">
                  {comments.map((c) => (
                    <div
                      key={c.id}
                      className={`p-3 rounded-md text-sm border ${
                        c.author_type === "agent"
                          ? "bg-primary/5 border-primary/20"
                          : c.author_type === "system"
                          ? "bg-blue-500/5 border-blue-500/20"
                          : "bg-amber-500/5 border-amber-500/20"
                      }`}
                    >
                      <div className={`text-[11px] font-bold uppercase mb-1 ${
                        c.author_type === "agent" ? "text-primary" : c.author_type === "system" ? "text-blue-400" : "text-amber-500"
                      }`}>
                        {c.author_type === "agent" ? `🤖 ${c.agent_id || "Agent"}` : c.author_type === "system" ? "⚙️ System" : "👤 You"}
                      </div>
                      <div className="text-foreground whitespace-pre-wrap leading-relaxed text-[13px]">
                        {c.content.length > 800 ? c.content.slice(0, 800) + "..." : c.content}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        {timeAgo(c.created_at)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* User Comment Input */}
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addUserComment()}
            placeholder="Add a comment..."
          />
          <Button
            size="sm"
            disabled={!newComment.trim() || sendingComment}
            onClick={addUserComment}
          >
            <Send className="w-3 h-3" />
          </Button>
        </div>

        {/* Rework Section (visible in review status) */}
        {isReview && showRework && (
          <div className="space-y-2 p-3 rounded-md bg-amber-500/5 border border-amber-500/20">
            <label className="text-sm font-medium text-amber-500">🔄 Rework Instructions</label>
            <textarea
              className="w-full px-3 py-2 rounded-md border border-amber-500/30 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 min-h-[80px] resize-y"
              value={reworkFeedback}
              onChange={(e) => setReworkFeedback(e.target.value)}
              placeholder="Describe what needs to be changed or improved..."
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => { setShowRework(false); setReworkFeedback(""); }}>Cancel</Button>
              <Button
                size="sm"
                disabled={!reworkFeedback.trim() || reworking}
                onClick={requestRework}
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                {reworking ? "Sending..." : "Send to Agent"}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {isReview && !showRework && (
            <Button
              variant="outline"
              onClick={() => setShowRework(true)}
              className="border-amber-500/30 text-amber-500 hover:bg-amber-500/10"
            >
              🔄 Request Rework
            </Button>
          )}
          {isReview && (
            <Button
              onClick={onMoveToDone}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <CheckCircle2 className="w-4 h-4 mr-1" /> Approve & Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Agents View ---

function AgentsView({ status, agents, onRefresh }: { status: GatewayStatus; agents: Agent[]; onRefresh: () => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState("");
  const [newIdentity, setNewIdentity] = useState("");
  const [createResult, setCreateResult] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newId.trim()) return;
    setCreating(true);
    setCreateResult(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: newId.trim(),
          name: newId.trim(),
          identity: newIdentity.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setCreateResult("success");
        setNewId("");
        setNewIdentity("");
        onRefresh();
        setTimeout(() => { setShowCreate(false); setCreateResult(null); }, 1500);
      } else {
        setCreateResult(`error:${data.error || "Failed to create agent"}`);
      }
    } catch (err) {
      setCreateResult(`error:${String(err)}`);
    }
    setCreating(false);
  };

  if (!status.connected) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <WifiOff className="w-12 h-12 mx-auto text-muted-foreground/30" />
          <p className="text-muted-foreground">OpenClaw Gateway not connected</p>
          <p className="text-xs text-muted-foreground/70">Make sure the gateway is running at ws://127.0.0.1:18789</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total Agents</div>
          <div className="text-2xl font-bold text-primary">{agents.length}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Cron Jobs</div>
          <div className="text-2xl font-bold text-primary">{status.cronJobCount}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Gateway</div>
          <div className="text-lg font-bold text-green-500 flex items-center gap-2">
            <Wifi className="w-4 h-4" /> Online
          </div>
        </div>
      </div>

      {/* Create button */}
      <Button onClick={() => setShowCreate(!showCreate)} variant={showCreate ? "outline" : "default"}>
        {showCreate ? "Cancel" : <><Plus className="w-4 h-4 mr-1" /> Create Agent</>}
      </Button>

      {/* Create form */}
      {showCreate && (
        <div className="bg-card border border-primary/20 rounded-lg p-6 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Agent ID</label>
            <input
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="e.g., researcher, writer, reviewer"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Identity / Persona (SOUL.md)</label>
            <textarea
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring min-h-[100px] resize-y"
              value={newIdentity}
              onChange={(e) => setNewIdentity(e.target.value)}
              placeholder="You are a skilled researcher who finds and summarizes information..."
            />
          </div>
          {createResult && (
            <div className={`p-3 rounded-md text-sm ${
              createResult === "success"
                ? "bg-green-500/10 text-green-500"
                : "bg-destructive/10 text-destructive"
            }`}>
              {createResult === "success" ? "✅ Agent created successfully!" : `❌ ${createResult.replace("error:", "")}`}
            </div>
          )}
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? "Creating..." : "Create Agent in OpenClaw"}
          </Button>
        </div>
      )}

      {/* Agent grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="bg-card border border-border rounded-lg p-5 hover:border-primary/50 hover:shadow-[0_0_15px_oklch(0.58_0.2_260/0.1)] transition-all cursor-pointer group"
          >
            <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center mb-3">
              <Bot className="w-5 h-5 text-primary" />
            </div>
            <div className="font-semibold">{agent.name || agent.id}</div>
            <div className="text-xs text-muted-foreground font-mono">{agent.id}</div>
            {agent.model && (
              <div className="mt-2 text-xs text-primary flex items-center gap-1">
                <Monitor className="w-3 h-3" /> {agent.model}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Missions View ---

function MissionsView() {
  const [missions, setMissions] = useState<{ id: string; name: string; description: string; status: string; created_at: string }[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const fetchMissions = useCallback(async () => {
    try {
      const res = await fetch("/api/missions");
      const data = await res.json();
      setMissions(data.missions || []);
    } catch { /* retry */ }
  }, []);

  useEffect(() => { fetchMissions(); }, [fetchMissions]);

  const createMission = async () => {
    if (!newName.trim()) return;
    await fetch("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() }),
    });
    setNewName("");
    setNewDesc("");
    setShowCreate(false);
    await fetchMissions();
  };

  return (
    <div className="flex-1 overflow-auto p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold">Your Missions</h3>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4 mr-1" /> New Mission
        </Button>
      </div>

      {missions.length === 0 && !showCreate ? (
        <div className="text-center py-12 space-y-3">
          <Rocket className="w-10 h-10 mx-auto text-muted-foreground/30" />
          <p className="text-muted-foreground text-sm">No missions yet. Create your first mission.</p>
          <Button onClick={() => setShowCreate(true)}>Create Mission</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {showCreate && (
            <div className="bg-card border border-primary/20 rounded-lg p-5 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Mission Name</label>
                <input
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., Content Marketing Campaign"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Description</label>
                <textarea
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring min-h-[60px] resize-y"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="What's the goal?"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button size="sm" onClick={createMission}>Create</Button>
              </div>
            </div>
          )}
          {missions.map((m) => (
            <div key={m.id} className="bg-card border border-border rounded-lg p-5 hover:border-primary/50 transition-all">
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-semibold flex items-center gap-2">
                    <Rocket className="w-4 h-4 text-primary" /> {m.name}
                  </div>
                  {m.description && (
                    <div className="text-sm text-muted-foreground mt-1">{m.description}</div>
                  )}
                </div>
                <Badge variant="outline" className="capitalize">{m.status}</Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-3">{timeAgo(m.created_at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
