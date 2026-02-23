"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ToolsPlayground } from "@/components/views/tools-playground";
import { CostDashboard } from "@/components/views/cost-dashboard";
import { ApprovalCenter } from "@/components/views/approval-center";
import { CronScheduler } from "@/components/views/cron-scheduler";
import { LogsViewer } from "@/components/views/logs-viewer";
import { SettingsPanel, getStoredModelPreference } from "@/components/views/settings-panel";
import { ChatPanel } from "@/components/views/chat-panel";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { LiveTerminal } from "@/components/layout/LiveTerminal";
import { KanbanBoard } from "@/components/board/KanbanBoard";
import { CreateTaskModal } from "@/components/modals/CreateTaskModal";
import { DispatchModal } from "@/components/modals/DispatchModal";
import { TaskDetailModal } from "@/components/modals/TaskDetailModal";
import { AgentsView } from "@/components/AgentsView";
import { MissionsView } from "@/components/MissionsView";
import type { Task, ActivityEntry, Agent, GatewayStatus, DevicePairStatus, ViewId } from "@/lib/types";
import { VALID_VIEWS } from "@/lib/types";

function getViewFromHash(): ViewId {
  if (typeof window === "undefined") return "board";
  const hash = window.location.hash.replace("#", "");
  return (VALID_VIEWS as readonly string[]).includes(hash) ? (hash as ViewId) : "board";
}

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
        if (draggedTask.assigned_agent_id) {
          dispatchTask(draggedTask.id, draggedTask.assigned_agent_id);
        } else {
          setShowDispatchModal(draggedTask);
        }
      } else {
        moveTask(draggedTask.id, columnId);
      }
    }
    setDraggedTask(null);
  };

  const getColumnTasks = (status: string) => tasks.filter((t) => t.status === status);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        activeView={activeView}
        onViewChange={setActiveView}
        onAgentsRefresh={fetchAgents}
      />

      <main className="flex-1 flex flex-col min-w-0 relative">
        <div className="absolute inset-0 z-0 opacity-50 pointer-events-none grid-pattern" />

        <Header
          gatewayStatus={gatewayStatus}
          taskCount={tasks.length}
          terminalOpen={terminalOpen}
          onToggleTerminal={() => setTerminalOpen(!terminalOpen)}
        />

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

          <LiveTerminal
            open={terminalOpen}
            onClose={() => setTerminalOpen(false)}
            activity={activity}
          />
        </div>
      </main>

      {/* Modals */}
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
