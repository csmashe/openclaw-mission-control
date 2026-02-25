/**
 * Orchestration Helper
 *
 * Helper functions for agents to log activities and deliverables
 * via Mission Control API.
 */

import { resolveInternalApiUrl } from "@/lib/internal-api";

function apiUrl(pathname: string): string {
  return resolveInternalApiUrl(pathname);
}

export interface LogActivityParams {
  taskId: string;
  activityType: "spawned" | "updated" | "completed" | "file_created" | "status_changed";
  message: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
}

export interface LogDeliverableParams {
  taskId: string;
  deliverableType: "file" | "url" | "artifact";
  title: string;
  path?: string;
  description?: string;
}

export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    const res = await fetch(apiUrl("/api/activity"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: params.activityType,
        message: params.message,
        task_id: params.taskId,
        agent_id: params.agentId,
        metadata: params.metadata,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`Error logging activity: HTTP ${res.status}`, body);
    }
  } catch (error) {
    console.error("Error logging activity:", error);
  }
}

export async function logDeliverable(params: LogDeliverableParams): Promise<void> {
  try {
    const res = await fetch(apiUrl(`/api/tasks/${params.taskId}/deliverables`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deliverable_type: params.deliverableType,
        title: params.title,
        path: params.path,
        description: params.description,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`Error logging deliverable: HTTP ${res.status}`, body);
    }
  } catch (error) {
    console.error("Error logging deliverable:", error);
  }
}
