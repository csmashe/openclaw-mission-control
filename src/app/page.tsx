"use client";

import { useState, useEffect, useCallback } from "react";

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
}

type ColumnId = "inbox" | "assigned" | "in_progress" | "review" | "done";

const COLUMNS: { id: ColumnId; label: string; icon: string }[] = [
  { id: "inbox", label: "Inbox", icon: "📥" },
  { id: "assigned", label: "Assigned", icon: "👤" },
  { id: "in_progress", label: "In Progress", icon: "⚡" },
  { id: "review", label: "Review", icon: "🔍" },
  { id: "done", label: "Done", icon: "✅" },
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

function activityIcon(type: string): string {
  switch (type) {
    case "task_created": return "📋";
    case "task_status_changed": return "🔄";
    case "task_assigned": return "👤";
    case "task_in_progress": return "⚡";
    case "task_review": return "🔍";
    case "task_deleted": return "🗑️";
    case "mission_created": return "🚀";
    case "agent_message": return "🤖";
    default: return "📌";
  }
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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDispatchModal, setShowDispatchModal] = useState<Task | null>(null);
  const [showTaskDetail, setShowTaskDetail] = useState<Task | null>(null);
  const [activeView, setActiveView] = useState<"board" | "agents" | "missions">("board");
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);

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

  useEffect(() => {
    fetchTasks();
    fetchActivity();
    fetchAgents();
    fetchGatewayStatus();
    // Poll for updates every 5 seconds to catch agent status changes
    const interval = setInterval(() => {
      fetchTasks();
      fetchActivity();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchTasks, fetchActivity, fetchAgents, fetchGatewayStatus]);

  // --- Task Actions ---

  const createTask = async (data: { title: string; description: string; priority: string }) => {
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
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
    const res = await fetch("/api/tasks/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, agentId }),
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
      moveTask(draggedTask.id, columnId);
    }
    setDraggedTask(null);
  };

  const getColumnTasks = (status: string) => tasks.filter((t) => t.status === status);

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon">🎯</div>
          <h1>Mission Control</h1>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-label">Dashboard</div>
          <button
            className={`nav-item ${activeView === "board" ? "active" : ""}`}
            onClick={() => setActiveView("board")}
          >
            <span className="nav-icon">📋</span>
            Task Board
          </button>
          <button
            className={`nav-item ${activeView === "agents" ? "active" : ""}`}
            onClick={() => { setActiveView("agents"); fetchAgents(); }}
          >
            <span className="nav-icon">🤖</span>
            Agents
          </button>
          <button
            className={`nav-item ${activeView === "missions" ? "active" : ""}`}
            onClick={() => setActiveView("missions")}
          >
            <span className="nav-icon">🚀</span>
            Missions
          </button>
        </nav>

        <div className="sidebar-status">
          <div style={{ display: "flex", alignItems: "center", fontSize: "13px", marginBottom: "8px" }}>
            <span className={`status-dot ${gatewayStatus.connected ? "connected" : "disconnected"}`} />
            OpenClaw {gatewayStatus.connected ? "Connected" : "Disconnected"}
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-muted)", display: "flex", gap: "16px" }}>
            <span>{gatewayStatus.agentCount} agents</span>
            <span>{gatewayStatus.cronJobCount} cron jobs</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <div className="top-bar">
          <h2>
            {activeView === "board" ? "Task Board" : activeView === "agents" ? "Agent Squad" : "Missions"}
          </h2>
          <div style={{ display: "flex", gap: "8px" }}>
            {activeView === "board" && (
              <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                + New Task
              </button>
            )}
          </div>
        </div>

        <div className="content-area">
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

          {/* Activity Feed */}
          <div className="activity-feed">
            <div className="feed-header">
              <span>📡</span> Activity Feed
            </div>
            <div className="feed-body">
              {activity.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">📡</div>
                  <div className="empty-state-text">No activity yet</div>
                </div>
              ) : (
                activity.map((entry) => (
                  <div key={entry.id} className="feed-item">
                    <div className="feed-item-type">
                      {activityIcon(entry.type)} {entry.type.replace(/_/g, " ")}
                    </div>
                    <div className="feed-item-message">{entry.message}</div>
                    <div className="feed-item-time">{timeAgo(entry.created_at)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Modals */}
      {showCreateModal && (
        <CreateTaskModal onClose={() => setShowCreateModal(false)} onCreate={createTask} />
      )}
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
          onMoveToReview={() => { moveTask(showTaskDetail.id, "review"); setShowTaskDetail(null); }}
          onMoveToDone={() => { moveTask(showTaskDetail.id, "done"); setShowTaskDetail(null); }}
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
}) {
  return (
    <div className="kanban-board">
      {columns.map((col) => {
        const colTasks = getColumnTasks(col.id);
        return (
          <div key={col.id} className={`kanban-column column-${col.id}`}>
            <div className="column-header">
              <div className="column-title">
                <span>{col.icon}</span>
                {col.label}
              </div>
              <span className="column-count">{colTasks.length}</span>
            </div>
            <div
              className={`column-body ${dragOverColumn === col.id ? "drag-over" : ""}`}
              onDragOver={(e) => onDragOver(e, col.id)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, col.id)}
            >
              {colTasks.length === 0 ? (
                <div className="empty-state" style={{ padding: "20px" }}>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>Drop tasks here</div>
                </div>
              ) : (
                colTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onDragStart={() => onDragStart(task)}
                    onDelete={() => onDeleteTask(task.id)}
                    onDispatch={() => onDispatchTask(task)}
                    onClick={() => onViewTask(task)}
                    onMoveToDown={onMoveToDown ? () => onMoveToDown(task.id) : undefined}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Task Card ---

function TaskCard({
  task,
  onDragStart,
  onDelete,
  onDispatch,
  onClick,
  onMoveToDown,
}: {
  task: Task;
  onDragStart: () => void;
  onDelete: () => void;
  onDispatch: () => void;
  onClick: () => void;
  onMoveToDown?: () => void;
}) {
  const showDispatch = task.status === "inbox" && !task.assigned_agent_id;
  const showDone = task.status === "review";

  return (
    <div className="task-card" draggable onDragStart={onDragStart} onClick={onClick}>
      <div className="task-card-title">{task.title}</div>
      {task.description && (
        <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px", lineHeight: "1.4" }}>
          {task.description.length > 80 ? task.description.slice(0, 80) + "..." : task.description}
        </div>
      )}
      <div className="task-card-meta">
        <span className={`priority-badge ${task.priority}`}>{task.priority}</span>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          {task.assigned_agent_id && (
            <span className="agent-badge">🤖 {task.assigned_agent_id}</span>
          )}
          {showDispatch && (
            <button
              onClick={(e) => { e.stopPropagation(); onDispatch(); }}
              className="btn btn-primary btn-small"
              style={{ fontSize: "11px", padding: "3px 8px" }}
              title="Send to Agent"
            >
              🚀 Dispatch
            </button>
          )}
          {showDone && onMoveToDown && (
            <button
              onClick={(e) => { e.stopPropagation(); onMoveToDown(); }}
              className="btn btn-small"
              style={{ fontSize: "11px", padding: "3px 8px", background: "rgba(16, 185, 129, 0.2)", color: "var(--accent-green)", border: "1px solid rgba(16, 185, 129, 0.3)" }}
              title="Mark Done"
            >
              ✅ Done
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="btn-ghost btn-small"
            title="Delete"
            style={{ fontSize: "14px", padding: "2px 6px" }}
          >
            ×
          </button>
        </div>
      </div>
      {task.status === "in_progress" && (
        <div style={{ marginTop: "8px", fontSize: "11px", color: "var(--accent-amber)", display: "flex", alignItems: "center", gap: "6px" }}>
          <span className="animate-pulse">●</span> Agent working...
        </div>
      )}
    </div>
  );
}

// --- Create Task Modal ---

function CreateTaskModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (data: { title: string; description: string; priority: string }) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onCreate({ title: title.trim(), description: description.trim(), priority });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Create New Task</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Title</label>
            <input type="text" className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" autoFocus />
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea className="form-textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional details..." />
          </div>
          <div className="form-group">
            <label className="form-label">Priority</label>
            <select className="form-select" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create Task</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Dispatch Modal (assign agent to task) ---

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
      setResult((res as { ok: boolean; message?: string }).ok
        ? "✅ Task dispatched! Agent is processing..."
        : "❌ Dispatch failed");
    } catch (err) {
      setResult(`❌ Error: ${String(err)}`);
    }
    setDispatching(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>🚀 Dispatch Task to Agent</h3>
        <div style={{ marginBottom: "16px", padding: "12px", borderRadius: "10px", background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}>
          <div style={{ fontWeight: 600, marginBottom: "4px" }}>{task.title}</div>
          <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{task.description || "No description"}</div>
          <div style={{ marginTop: "8px" }}>
            <span className={`priority-badge ${task.priority}`}>{task.priority}</span>
          </div>
        </div>

        {agents.length === 0 ? (
          <div style={{ color: "var(--accent-amber)", fontSize: "14px", padding: "12px", background: "rgba(245, 158, 11, 0.1)", borderRadius: "10px" }}>
            ⚠️ No agents available. Go to Agents page to create one first.
          </div>
        ) : (
          <>
            <div className="form-group">
              <label className="form-label">Select Agent</label>
              <select className="form-select" value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)}>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    🤖 {agent.name || agent.id} {agent.model ? `(${agent.model})` : ""}
                  </option>
                ))}
              </select>
            </div>

            {result && (
              <div style={{ fontSize: "14px", padding: "12px", borderRadius: "10px", background: result.startsWith("✅") ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)", marginBottom: "16px" }}>
                {result}
              </div>
            )}
          </>
        )}

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            {result ? "Close" : "Cancel"}
          </button>
          {agents.length > 0 && !result && (
            <button className="btn btn-primary" onClick={handleDispatch} disabled={dispatching}>
              {dispatching ? "Dispatching..." : "🚀 Send to Agent"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Task Detail Modal with Comments ---

function TaskDetailModal({ task, onClose, onMoveToReview, onMoveToDone }: {
  task: Task;
  onClose: () => void;
  onMoveToReview: () => void;
  onMoveToDone: () => void;
}) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/tasks/comments?taskId=${task.id}`)
      .then((res) => res.json())
      .then((data) => { setComments(data.comments || []); setLoading(false); })
      .catch(() => setLoading(false));

    // Poll for new comments
    const interval = setInterval(() => {
      fetch(`/api/tasks/comments?taskId=${task.id}`)
        .then((res) => res.json())
        .then((data) => setComments(data.comments || []))
        .catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [task.id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: "560px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
          <div>
            <h3 style={{ margin: 0 }}>{task.title}</h3>
            <div style={{ display: "flex", gap: "8px", marginTop: "8px", alignItems: "center" }}>
              <span className={`priority-badge ${task.priority}`}>{task.priority}</span>
              <span style={{ fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase" }}>{task.status.replace("_", " ")}</span>
              {task.assigned_agent_id && (
                <span className="agent-badge">🤖 {task.assigned_agent_id}</span>
              )}
            </div>
          </div>
          <button className="btn-ghost" onClick={onClose} style={{ fontSize: "20px" }}>×</button>
        </div>

        {task.description && (
          <div style={{ padding: "12px", borderRadius: "10px", background: "var(--bg-card)", border: "1px solid var(--border-subtle)", marginBottom: "16px", fontSize: "14px", color: "var(--text-secondary)", lineHeight: "1.5" }}>
            {task.description}
          </div>
        )}

        {/* Comments */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "8px" }}>
            💬 Comments ({comments.length})
          </div>
          {loading ? (
            <div style={{ fontSize: "13px", color: "var(--text-muted)" }} className="animate-pulse">Loading...</div>
          ) : comments.length === 0 ? (
            <div style={{ fontSize: "13px", color: "var(--text-muted)", padding: "16px", textAlign: "center" }}>
              No comments yet. Dispatch to an agent to see responses here.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "300px", overflowY: "auto" }}>
              {comments.map((c) => (
                <div key={c.id} style={{
                  padding: "10px 14px",
                  borderRadius: "10px",
                  background: c.author_type === "agent" ? "rgba(139, 92, 246, 0.08)" : c.author_type === "system" ? "rgba(59, 130, 246, 0.08)" : "var(--bg-card)",
                  border: `1px solid ${c.author_type === "agent" ? "rgba(139, 92, 246, 0.2)" : "var(--border-subtle)"}`,
                  fontSize: "13px",
                }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: c.author_type === "agent" ? "var(--accent-purple)" : c.author_type === "system" ? "var(--accent-blue)" : "var(--text-secondary)", marginBottom: "4px", textTransform: "uppercase" }}>
                    {c.author_type === "agent" ? `🤖 ${c.agent_id || "Agent"}` : c.author_type === "system" ? "🔧 System" : "👤 User"}
                  </div>
                  <div style={{ color: "var(--text-primary)", lineHeight: "1.5", whiteSpace: "pre-wrap" }}>
                    {c.content.length > 500 ? c.content.slice(0, 500) + "..." : c.content}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "6px" }}>
                    {timeAgo(c.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          {task.status === "in_progress" && (
            <button className="btn btn-primary" onClick={onMoveToReview}>Move to Review</button>
          )}
          {task.status === "review" && (
            <button className="btn" onClick={onMoveToDone}
              style={{ background: "linear-gradient(135deg, var(--accent-green), #059669)", color: "white" }}>
              ✅ Mark as Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Agents View ---

function AgentsView({ status, agents, onRefresh }: { status: GatewayStatus; agents: Agent[]; onRefresh: () => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState("");
  const [newIdentity, setNewIdentity] = useState("");
  const [createResult, setCreateResult] = useState<string | null>(null);

  const agentColors = [
    "linear-gradient(135deg, #8b5cf6, #6366f1)",
    "linear-gradient(135deg, #3b82f6, #06b6d4)",
    "linear-gradient(135deg, #10b981, #059669)",
    "linear-gradient(135deg, #f59e0b, #d97706)",
    "linear-gradient(135deg, #ec4899, #be185d)",
    "linear-gradient(135deg, #ef4444, #dc2626)",
  ];
  const agentEmojis = ["🤖", "🧠", "⚡", "🔮", "🛡️", "🎯", "👁️", "🦊"];

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
        setCreateResult("✅ Agent created successfully!");
        setNewId("");
        setNewIdentity("");
        onRefresh();
        setTimeout(() => { setShowCreate(false); setCreateResult(null); }, 1500);
      } else {
        setCreateResult(`❌ ${data.error || "Failed to create agent"}`);
      }
    } catch (err) {
      setCreateResult(`❌ Error: ${String(err)}`);
    }
    setCreating(false);
  };

  if (!status.connected) {
    return (
      <div style={{ flex: 1, padding: "40px" }}>
        <div className="empty-state">
          <div className="empty-state-icon">🔌</div>
          <div className="empty-state-text">
            OpenClaw Gateway not connected<br />
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              Make sure the gateway is running at ws://127.0.0.1:18789
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Agents</div>
          <div className="stat-value">{agents.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cron Jobs</div>
          <div className="stat-value">{status.cronJobCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Gateway</div>
          <div className="stat-value" style={{ fontSize: "20px" }}>✅ Online</div>
        </div>
      </div>

      <div style={{ padding: "0 20px 12px" }}>
        <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "Cancel" : "+ Create Agent"}
        </button>
      </div>

      {showCreate && (
        <div style={{ margin: "0 20px 16px", padding: "20px", borderRadius: "16px", background: "var(--bg-card)", border: "1px solid var(--border-accent)" }}>
          <div className="form-group">
            <label className="form-label">Agent ID</label>
            <input className="form-input" value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="e.g., researcher, writer, reviewer" />
          </div>
          <div className="form-group">
            <label className="form-label">Identity / Persona (SOUL.md)</label>
            <textarea className="form-textarea" value={newIdentity} onChange={(e) => setNewIdentity(e.target.value)}
              placeholder="You are a skilled researcher who finds and summarizes information..."
              style={{ minHeight: "100px" }}
            />
          </div>
          {createResult && (
            <div style={{ fontSize: "14px", padding: "10px", borderRadius: "8px", background: createResult.startsWith("✅") ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)", marginBottom: "12px" }}>
              {createResult}
            </div>
          )}
          <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
            {creating ? "Creating..." : "Create Agent in OpenClaw"}
          </button>
        </div>
      )}

      <div className="agents-grid">
        {agents.map((agent, i) => (
          <div key={agent.id} className="agent-card">
            <div className="agent-avatar" style={{ background: agentColors[i % agentColors.length] }}>
              {agentEmojis[i % agentEmojis.length]}
            </div>
            <div className="agent-name">{agent.name || agent.id}</div>
            <div className="agent-id">{agent.id}</div>
            {agent.model && (
              <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--accent-cyan)" }}>🧠 {agent.model}</div>
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
    <div style={{ flex: 1, overflow: "auto", padding: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
        <h3 style={{ fontSize: "16px", fontWeight: 600 }}>Your Missions</h3>
        <button className="btn btn-primary btn-small" onClick={() => setShowCreate(true)}>+ New Mission</button>
      </div>

      {missions.length === 0 && !showCreate ? (
        <div className="empty-state">
          <div className="empty-state-icon">🚀</div>
          <div className="empty-state-text">No missions yet. Create your first mission.</div>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Create Mission</button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {showCreate && (
            <div style={{ background: "var(--bg-card)", borderRadius: "16px", padding: "20px", border: "1px solid var(--border-accent)" }}>
              <div className="form-group">
                <label className="form-label">Mission Name</label>
                <input className="form-input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g., Content Marketing Campaign" autoFocus />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea className="form-textarea" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="What's the goal?" />
              </div>
              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button className="btn btn-secondary btn-small" onClick={() => setShowCreate(false)}>Cancel</button>
                <button className="btn btn-primary btn-small" onClick={createMission}>Create</button>
              </div>
            </div>
          )}
          {missions.map((m) => (
            <div key={m.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)", borderRadius: "16px", padding: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: "16px", fontWeight: 600 }}>🚀 {m.name}</div>
                  {m.description && <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "4px" }}>{m.description}</div>}
                </div>
                <span className="priority-badge medium" style={{ textTransform: "capitalize" }}>{m.status}</span>
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "12px" }}>Created {timeAgo(m.created_at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
