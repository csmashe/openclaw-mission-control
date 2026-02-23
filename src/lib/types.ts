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

export type ColumnId = "inbox" | "assigned" | "in_progress" | "review" | "done";

export const VALID_VIEWS = ["board", "agents", "missions", "tools", "usage", "approvals", "cron", "logs", "settings", "chat"] as const;
export type ViewId = (typeof VALID_VIEWS)[number];
