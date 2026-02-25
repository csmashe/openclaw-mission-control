export interface Task {
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
  orchestrator_session_key?: string | null;
  tester_session_key?: string | null;
  rework_count?: number;
  planning_question_waiting?: number;
}

export interface TaskComment {
  id: string;
  task_id: string;
  agent_id: string | null;
  author_type: string;
  content: string;
  created_at: string;
}

export interface ActivityEntry {
  id: string;
  type: string;
  agent_id: string | null;
  task_id: string | null;
  message: string;
  metadata: string;
  created_at: string;
}

export interface Agent {
  id: string;
  name?: string;
  model?: string;
}

export interface GatewayStatus {
  connected: boolean;
  agentCount: number;
  cronJobCount: number;
  error?: string;
}

export interface DevicePairStatus {
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

export type ColumnId = "inbox" | "planning" | "assigned" | "in_progress" | "testing" | "review" | "done";

export const BASE_VIEWS = ["board", "who-working", "agents", "missions", "tools", "usage", "approvals", "cron", "logs", "settings", "chat"] as const;
export type BaseViewId = (typeof BASE_VIEWS)[number];
export type ViewId = BaseViewId | `plugin:${string}`;

// Alias for backwards compatibility
export const VALID_VIEWS = BASE_VIEWS;
