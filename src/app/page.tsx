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
import { WhoWorkingPanel } from "@/components/views/who-working-panel";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { LiveTerminal } from "@/components/layout/LiveTerminal";
import { KanbanBoard } from "@/components/board/KanbanBoard";
import { CreateTaskModal } from "@/components/modals/CreateTaskModal";
import { DispatchModal } from "@/components/modals/DispatchModal";
import { TaskDetailModal } from "@/components/modals/TaskDetailModal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AgentsView } from "@/components/AgentsView";
import { MissionsView } from "@/components/MissionsView";
import { PluginViewWrapper } from "@/components/views/plugin-view-wrapper";
import { useMissionControl } from "@/lib/store";
import { useSSE } from "@/hooks/useSSE";
import { usePlugins } from "@/hooks/usePlugins";
import type { Task, ViewId } from "@/lib/types";
import { VALID_VIEWS } from "@/lib/types";

function getViewFromHash(): ViewId {
  if (typeof window === "undefined") return "board";
  const hash = window.location.hash.replace("#", "");
  if (hash.startsWith("plugin:")) return hash as ViewId;
  return (VALID_VIEWS as readonly string[]).includes(hash) ? (hash as ViewId) : "board";
}

export default function Dashboard() {
  const {
    tasks, activity, agents, gatewayStatus, devicePairStatus,
    showCreateModal, showDispatchModal, showTaskDetail,
    activeView, terminalOpen,
    setTasks, setActivity, setAgents, setGatewayStatus,
    setDevicePairStatus, setShowCreateModal, setShowDispatchModal,
    setShowTaskDetail, setActiveView, setTerminalOpen,
  } = useMissionControl();

  const [approvingDevicePair, setApprovingDevicePair] = useState(false);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);

  // SSE for real-time updates
  useSSE();

  // Plugin system
  usePlugins();

  // Hash-based view routing
  useEffect(() => {
    setActiveView(getViewFromHash());
    const onHashChange = () => {
      const view = getViewFromHash();
      useMissionControl.setState({ activeView: view });
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [setActiveView]);

  // --- Data Fetching (initial hydration + heartbeat) ---

  const fetchTasks = useCallback(async (): Promise<Task[]> => {
    try {
      const res = await fetch("/api/tasks");
      const data = await res.json();
      const nextTasks = data.tasks || [];
      setTasks(nextTasks);
      return nextTasks;
    } catch {
      return [];
    }
  }, [setTasks]);

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/activity");
      const data = await res.json();
      setActivity(data.activity || []);
    } catch { /* retry */ }
  }, [setActivity]);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      setAgents(data.agents || []);
    } catch { /* retry */ }
  }, [setAgents]);

  const fetchGatewayStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/openclaw/status");
      const data = await res.json();
      setGatewayStatus(data);
    } catch {
      setGatewayStatus({ connected: false, agentCount: 0, cronJobCount: 0 });
    }
  }, [setGatewayStatus]);

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
  }, [setDevicePairStatus]);

  const approveLatestDevicePair = useCallback(async () => {
    setApprovingDevicePair(true);
    try {
      const res = await fetch("/api/openclaw/device-pair", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const detail = body?.error || `HTTP ${res.status}`;
        const prev = useMissionControl.getState().devicePairStatus;
        setDevicePairStatus({ ...prev, error: `Approval failed: ${detail}` });
        return;
      }
      const prev = useMissionControl.getState().devicePairStatus;
      setDevicePairStatus({ ...prev, error: undefined });
      await fetchDevicePairStatus();
      await fetchGatewayStatus();
      await fetchAgents();
    } catch (err) {
      const prev = useMissionControl.getState().devicePairStatus;
      setDevicePairStatus({ ...prev, error: `Approval failed: ${String(err)}` });
    } finally {
      setApprovingDevicePair(false);
    }
  }, [fetchAgents, fetchDevicePairStatus, fetchGatewayStatus, setDevicePairStatus]);

  // Initial data hydration
  useEffect(() => {
    fetchTasks();
    fetchActivity();
    fetchAgents();
    fetchGatewayStatus();
    fetchDevicePairStatus();
  }, [fetchTasks, fetchActivity, fetchAgents, fetchGatewayStatus, fetchDevicePairStatus]);

  // 30s heartbeat for gateway status + completion checks (server-side only)
  useEffect(() => {
    const interval = setInterval(async () => {
      try { await fetch("/api/tasks/check-completion"); } catch { /* ignore */ }
      fetchGatewayStatus();
      fetchDevicePairStatus();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchGatewayStatus, fetchDevicePairStatus]);

  // Background polling for tasks in planning status (5s interval)
  // This ensures the board updates even when the task detail modal is closed.
  useEffect(() => {
    const interval = setInterval(() => {
      const planningTasks = useMissionControl.getState().tasks.filter(
        (t) => t.status === "planning" && !(t as unknown as Record<string, unknown>).planning_complete
      );
      for (const t of planningTasks) {
        fetch(`/api/tasks/${t.id}/planning/poll`).catch(() => {});
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // --- Task Actions ---

  const createTask = async (data: { title: string; description: string; priority: string; assigned_agent_id?: string; startPlanning?: boolean; autoApprovePlan?: boolean }) => {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await res.json();

    if (data.startPlanning && result.task?.id) {
      // Set auto-approve flag on the task before starting planning
      if (data.autoApprovePlan) {
        await fetch("/api/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: result.task.id, planning_auto_approve: 1 }),
        });
      }
      // Start planning phase instead of direct dispatch
      await fetch(`/api/tasks/${result.task.id}/planning`, { method: "POST" });
    } else if (data.assigned_agent_id && result.task?.id) {
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
    const res = await fetch(`/api/tasks?id=${taskId}`, { method: "DELETE" });
    if (!res.ok) {
      alert(`Delete failed (HTTP ${res.status}). Please try again.`);
      return;
    }

    await fetchTasks();
    await fetchActivity();
    setDeleteTarget(null);
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

  const refreshTaskDetail = useCallback(async (taskId: string) => {
    const latestTasks = await fetchTasks();
    const updated = latestTasks.find((t) => t.id === taskId) ?? null;
    if (updated) {
      setShowTaskDetail(updated);
    }
  }, [fetchTasks, setShowTaskDetail]);

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
              onDeleteTask={(taskId) => {
                const target = tasks.find((t) => t.id === taskId) ?? null;
                setDeleteTarget(target);
              }}
              onDispatchTask={(task) => setShowDispatchModal(task)}
              onViewTask={(task) => setShowTaskDetail(task)}
              onMoveToDown={(taskId: string) => moveTask(taskId, "done")}
              onCreateTask={() => setShowCreateModal(true)}
            />
          )}
          {activeView === "who-working" && <WhoWorkingPanel />}
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
          {activeView.startsWith("plugin:") && <PluginViewWrapper />}

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
          onRefresh={() => refreshTaskDetail(showTaskDetail.id)}
        />
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete task?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `Delete "${deleteTarget.title}"? This action cannot be undone.`
                : "This action cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!deleteTarget) return;
                void deleteTask(deleteTarget.id);
              }}
            >
              Delete task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
