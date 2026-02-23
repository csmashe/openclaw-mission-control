/**
 * Orchestration Helper
 *
 * Helper functions for agents to log activities, deliverables,
 * and manage sub-agent sessions via Mission Control API.
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

export interface RegisterSubAgentParams {
  taskId: string;
  sessionId: string;
  agentName?: string;
}

export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    await fetch(apiUrl("/api/activity"), {
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
  } catch (error) {
    console.error("Error logging activity:", error);
  }
}

export async function logDeliverable(params: LogDeliverableParams): Promise<void> {
  try {
    await fetch(apiUrl(`/api/tasks/${params.taskId}/deliverables`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deliverable_type: params.deliverableType,
        title: params.title,
        path: params.path,
        description: params.description,
      }),
    });
  } catch (error) {
    console.error("Error logging deliverable:", error);
  }
}

export async function registerSubAgentSession(params: RegisterSubAgentParams): Promise<void> {
  try {
    await fetch(apiUrl(`/api/tasks/${params.taskId}/subagent`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        openclaw_session_id: params.sessionId,
        agent_name: params.agentName,
      }),
    });
  } catch (error) {
    console.error("Error registering sub-agent session:", error);
  }
}

export async function completeSubAgentSession(sessionId: string): Promise<void> {
  try {
    await fetch(apiUrl(`/api/openclaw/sessions/${sessionId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "completed",
        ended_at: new Date().toISOString(),
      }),
    });
  } catch (error) {
    console.error("Error completing sub-agent session:", error);
  }
}

export async function onSubAgentSpawned(params: {
  taskId: string;
  sessionId: string;
  agentName: string;
  description?: string;
}): Promise<void> {
  await Promise.all([
    logActivity({
      taskId: params.taskId,
      activityType: "spawned",
      message: `Sub-agent spawned: ${params.agentName}`,
      metadata: { sessionId: params.sessionId, description: params.description },
    }),
    registerSubAgentSession({
      taskId: params.taskId,
      sessionId: params.sessionId,
      agentName: params.agentName,
    }),
  ]);
}

export async function onSubAgentCompleted(params: {
  taskId: string;
  sessionId: string;
  agentName: string;
  summary: string;
  deliverables?: Array<{ type: "file" | "url" | "artifact"; title: string; path?: string }>;
}): Promise<void> {
  const promises: Promise<void>[] = [
    logActivity({
      taskId: params.taskId,
      activityType: "completed",
      message: `${params.agentName} completed: ${params.summary}`,
      metadata: { sessionId: params.sessionId },
    }),
    completeSubAgentSession(params.sessionId),
  ];

  if (params.deliverables) {
    for (const deliverable of params.deliverables) {
      promises.push(
        logDeliverable({
          taskId: params.taskId,
          deliverableType: deliverable.type,
          title: deliverable.title,
          path: deliverable.path,
        })
      );
    }
  }

  await Promise.all(promises);
}
