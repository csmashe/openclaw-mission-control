import { v4 as uuidv4 } from "uuid";
import { addComment, listTasks, type Task } from "@/lib/db";
import { getOpenClawClient } from "@/lib/openclaw-client";
import { getAgentTaskMonitor } from "@/lib/agent-task-monitor";
import { deriveExpectedActiveStatus } from "@/lib/task-runtime-truth";
import { transitionTaskStatus } from "@/lib/task-state";

interface ReconcileChange {
  taskId: string;
  title: string;
  from: string;
  to: string;
  reason: string;
}

interface ReconcileSummary {
  scanned: number;
  repaired: ReconcileChange[];
  errors: Array<{ taskId: string; error: string }>;
}

async function collectRuntimeEvidence(task: Task): Promise<{
  assistantCount: number;
  latestAssistantTimestamp?: string;
}> {
  if (!task.openclaw_session_key) {
    return { assistantCount: 0, latestAssistantTimestamp: undefined };
  }

  const client = getOpenClawClient();
  const history = await client.getChatHistory(task.openclaw_session_key);
  const assistant = history.filter((m) => m.role === "assistant");
  const latest = assistant[assistant.length - 1];
  return {
    assistantCount: assistant.length,
    latestAssistantTimestamp: latest?.timestamp,
  };
}

export async function reconcileTaskRuntimeTruth(): Promise<ReconcileSummary> {
  const nowIso = new Date().toISOString();
  const monitor = getAgentTaskMonitor();
  const monitorBySession = new Map(
    monitor.getActiveMonitors().map((m) => [m.sessionKey, m])
  );

  const tasks = listTasks().filter(
    (t) => t.status === "assigned" || t.status === "in_progress"
  );

  const repaired: ReconcileChange[] = [];
  const errors: Array<{ taskId: string; error: string }> = [];

  const ackTimeoutMs = monitor.getAckTimeoutMs();

  if (tasks.length === 0) {
    return { scanned: 0, repaired, errors };
  }

  const client = getOpenClawClient();
  await client.connect();

  for (const task of tasks) {
    try {
      const activeMonitor =
        task.openclaw_session_key
          ? monitorBySession.get(task.openclaw_session_key)
          : undefined;

      const { assistantCount, latestAssistantTimestamp } = await collectRuntimeEvidence(task);

      const expected = deriveExpectedActiveStatus(task, {
        nowIso,
        ackTimeoutMs,
        monitorAcked: activeMonitor?.firstActivityAcked ?? false,
        assistantMessageCount: assistantCount,
        latestAssistantTimestamp,
      });

      if (task.status === expected) continue;

      const transition = transitionTaskStatus(task.id, expected, {
        actor: "reconcile",
        reason: "runtime_truth_reconcile",
        agentId: task.assigned_agent_id ?? undefined,
        metadata: {
          runtimeTruth: {
            monitorAcked: activeMonitor?.firstActivityAcked ?? false,
            assistantCount,
            baselineAssistantCount: task.dispatch_message_count_start,
            latestAssistantTimestamp: latestAssistantTimestamp ?? null,
            dispatchStartedAt: task.dispatch_started_at,
          },
        },
      });

      if (!transition.ok || transition.noop || !transition.from) continue;

      const reason =
        expected === "in_progress"
          ? "reconcile_observed_agent_activity"
          : "reconcile_missing_agent_activity";

      addComment({
        id: uuidv4(),
        task_id: task.id,
        author_type: "system",
        content:
          expected === "in_progress"
            ? "🧭 Reconciled: runtime showed real agent activity; task moved to In Progress."
            : "🧭 Reconciled: no runtime activity was observed; task moved back to Assigned.",
      });

      repaired.push({
        taskId: task.id,
        title: task.title,
        from: transition.from,
        to: transition.to,
        reason,
      });
    } catch (error) {
      errors.push({ taskId: task.id, error: String(error) });
    }
  }

  return {
    scanned: tasks.length,
    repaired,
    errors,
  };
}
