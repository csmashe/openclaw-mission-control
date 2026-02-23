import { v4 as uuidv4 } from "uuid";
import { getTask, logActivity, updateTask, type Task } from "@/lib/db";

export type TaskStatus = "inbox" | "assigned" | "in_progress" | "review" | "done";

const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  inbox: ["assigned", "done"],
  assigned: ["inbox", "in_progress", "review", "done"],
  in_progress: ["assigned", "review", "done"],
  review: ["assigned", "in_progress", "done"],
  done: ["review"],
};

interface TransitionOptions {
  actor: "dispatch" | "monitor" | "reconcile" | "api" | "system";
  reason: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
  patch?: Parameters<typeof updateTask>[1];
  bypassGuards?: boolean;
}

interface TransitionResult {
  ok: boolean;
  noop: boolean;
  from?: TaskStatus;
  to: TaskStatus;
  task?: Task;
  blockedReason?: string;
}

export function transitionTaskStatus(
  taskId: string,
  to: TaskStatus,
  opts: TransitionOptions
): TransitionResult {
  const task = getTask(taskId);
  if (!task) {
    return { ok: false, noop: true, to, blockedReason: "task_not_found" };
  }

  const from = task.status as TaskStatus;
  if (from === to) {
    const patchKeys = Object.keys(opts.patch ?? {}).filter((k) => (opts.patch as Record<string, unknown>)[k] !== undefined);
    if (patchKeys.length === 0) {
      return { ok: true, noop: true, from, to, task };
    }

    const next = updateTask(taskId, { ...(opts.patch ?? {}) });
    logActivity({
      id: uuidv4(),
      type: "task_status_reaffirmed",
      task_id: taskId,
      agent_id: opts.agentId ?? next?.assigned_agent_id ?? task.assigned_agent_id ?? undefined,
      message: `Task \"${task.title}\" kept in ${from} with updated metadata`,
      metadata: {
        status: from,
        actor: opts.actor,
        reason: opts.reason,
        patchKeys,
        ...(opts.metadata ?? {}),
      },
    });

    return { ok: true, noop: false, from, to, task: next ?? task };
  }

  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!opts.bypassGuards && !allowed.includes(to)) {
    logActivity({
      id: uuidv4(),
      type: "task_transition_blocked",
      task_id: taskId,
      agent_id: opts.agentId ?? task.assigned_agent_id ?? undefined,
      message: `Blocked task transition for \"${task.title}\": ${from} -> ${to}`,
      metadata: {
        from,
        to,
        actor: opts.actor,
        reason: opts.reason,
        allowedTransitions: allowed,
        ...(opts.metadata ?? {}),
      },
    });

    return {
      ok: false,
      noop: true,
      from,
      to,
      task,
      blockedReason: "invalid_transition",
    };
  }

  const next = updateTask(taskId, {
    ...(opts.patch ?? {}),
    status: to,
  });

  logActivity({
    id: uuidv4(),
    type: "task_status_changed",
    task_id: taskId,
    agent_id: opts.agentId ?? next?.assigned_agent_id ?? task.assigned_agent_id ?? undefined,
    message: `Task \"${task.title}\" moved from ${from} to ${to}`,
    metadata: {
      from,
      to,
      actor: opts.actor,
      reason: opts.reason,
      guarded: !opts.bypassGuards,
      ...(opts.metadata ?? {}),
    },
  });

  return {
    ok: Boolean(next),
    noop: false,
    from,
    to,
    task: next,
  };
}

export function getAllowedTransitions(from: TaskStatus): TaskStatus[] {
  return [...(ALLOWED_TRANSITIONS[from] ?? [])];
}
