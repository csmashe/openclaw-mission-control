import { v4 as uuidv4 } from "uuid";
import { getOpenClawClient } from "./openclaw-client";
import { getTask, updateTask, addComment, logActivity } from "./db";
import { evaluateCompletion, extractDispatchCompletion } from "./completion-gate";

// --- Types ---

interface ActiveMonitor {
  taskId: string;
  sessionKey: string;
  agentId: string;
  startedAt: number;
  pollTimer: ReturnType<typeof setInterval>;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  lastMessageCount: number;
  lastActivityAt: number;
  dispatchId?: string;
  dispatchStartedAt?: string;
  baselineAssistantCount?: number;
}

// --- Singleton ---

const globalForMonitor = globalThis as typeof globalThis & {
  __agentTaskMonitor?: AgentTaskMonitor;
};

class AgentTaskMonitor {
  private monitors: Map<string, ActiveMonitor> = new Map(); // sessionKey → monitor
  private readonly POLL_INTERVAL_MS = 10_000; // Check every 10 seconds
  private readonly IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minute idle timeout

  /**
   * Start monitoring a dispatched task for agent completion.
   * Uses polling to check chat history for new assistant messages.
   */
  async startMonitoring(
    taskId: string,
    sessionKey: string,
    agentId: string,
    opts?: {
      dispatchId?: string;
      dispatchStartedAt?: string;
      baselineAssistantCount?: number;
    }
  ): Promise<void> {
    // Clean up any existing monitor for this session
    this.stopMonitoring(sessionKey);

    // Get initial message count so we can detect new messages
    let initialCount = opts?.baselineAssistantCount ?? 0;
    if (opts?.baselineAssistantCount == null) {
      try {
        const client = getOpenClawClient();
        const history = await client.getChatHistory(sessionKey);
        initialCount = history.filter((m) => m.role === "assistant").length;
      } catch {
        // Start from 0 if we can't get history
      }
    }

    // Set up polling interval
    const pollTimer = setInterval(async () => {
      await this.pollForCompletion(sessionKey);
    }, this.POLL_INTERVAL_MS);

    const monitor: ActiveMonitor = {
      taskId,
      sessionKey,
      agentId,
      startedAt: Date.now(),
      pollTimer,
      timeoutTimer: undefined,
      lastMessageCount: initialCount,
      lastActivityAt: Date.now(),
      dispatchId: opts?.dispatchId,
      dispatchStartedAt: opts?.dispatchStartedAt,
      baselineAssistantCount: initialCount,
    };

    this.monitors.set(sessionKey, monitor);
    this.resetIdleTimeout(monitor);
    console.log(
      `[AgentTaskMonitor] Monitoring started: task=${taskId}, session=${sessionKey}, agent=${agentId}, initialMsgs=${initialCount}`
    );
  }

  /**
   * Stop monitoring a specific session.
   */
  stopMonitoring(sessionKey: string): void {
    const monitor = this.monitors.get(sessionKey);
    if (monitor) {
      clearInterval(monitor.pollTimer);
      clearTimeout(monitor.timeoutTimer);
      this.monitors.delete(sessionKey);
      console.log(
        `[AgentTaskMonitor] Monitoring stopped: session=${sessionKey}`
      );
    }
  }

  /**
   * Get all currently active monitors.
   */
  getActiveMonitors(): {
    taskId: string;
    sessionKey: string;
    agentId: string;
    startedAt: number;
  }[] {
    return Array.from(this.monitors.values()).map(
      ({ taskId, sessionKey, agentId, startedAt }) => ({
        taskId,
        sessionKey,
        agentId,
        startedAt,
      })
    );
  }

  // --- Private ---

  private resetIdleTimeout(monitor: ActiveMonitor): void {
    if (monitor.timeoutTimer) clearTimeout(monitor.timeoutTimer);
    const { sessionKey, taskId } = monitor;
    monitor.timeoutTimer = setTimeout(async () => {
      console.log(
        `[AgentTaskMonitor] Idle timeout for task ${taskId} (session: ${sessionKey}). Keeping in progress.`
      );
      await this.forceComplete(sessionKey, "timeout");
    }, this.IDLE_TIMEOUT_MS);
  }

  /**
   * Poll chat history to detect agent completion.
   * Checks if new assistant messages have appeared since we started monitoring.
   */
  private async pollForCompletion(sessionKey: string): Promise<void> {
    const monitor = this.monitors.get(sessionKey);
    if (!monitor) return;

    try {
      const task = getTask(monitor.taskId);
      if (!task || task.status !== "in_progress") {
        // Task was moved manually or doesn't exist anymore
        this.stopMonitoring(sessionKey);
        return;
      }

      const client = getOpenClawClient();
      await client.connect();
      const history = await client.getChatHistory(sessionKey);
      const assistantMsgs = history.filter((m) => m.role === "assistant");

      // Check if new assistant messages have arrived
      if (assistantMsgs.length > monitor.lastMessageCount) {
        const latestResponse = assistantMsgs[assistantMsgs.length - 1];
        monitor.lastActivityAt = Date.now();
        this.resetIdleTimeout(monitor);
        console.log(
          `[AgentTaskMonitor] New agent response detected for task ${monitor.taskId} (${assistantMsgs.length} msgs, was ${monitor.lastMessageCount})`
        );

        await this.handleCompletion(
          monitor,
          latestResponse.content,
          assistantMsgs.length,
          latestResponse.timestamp ?? new Date().toISOString()
        );
        monitor.lastMessageCount = assistantMsgs.length;
      }
    } catch (err) {
      console.error(
        `[AgentTaskMonitor] Poll error for session ${sessionKey}:`,
        String(err)
      );
    }
  }

  /**
   * Handle successful agent completion signal.
   * Manager monitor auto-promotes valid completions to review.
   */
  private async handleCompletion(
    monitor: ActiveMonitor,
    responseText: string,
    assistantMessageCount: number,
    evidenceTimestamp: string
  ): Promise<void> {
    const { taskId, agentId, sessionKey } = monitor;

    // Verify task still exists and is in_progress
    const task = getTask(taskId);
    if (!task || task.status !== "in_progress") {
      console.log(
        `[AgentTaskMonitor] Task ${taskId} not in expected state (current: ${task?.status}). Skipping.`
      );
      return;
    }

    const extracted = extractDispatchCompletion(responseText || "");
    const decision = evaluateCompletion(task, {
      payloadDispatchId: extracted.dispatchId,
      evidenceTimestamp,
      assistantMessageCount,
    });

    if (!decision.accepted) {
      logActivity({
        id: uuidv4(),
        type: "task_completion_gate_rejected",
        task_id: taskId,
        agent_id: agentId,
        message: `Completion rejected for task "${task.title}" (${decision.completionReason})`,
        metadata: {
          dispatchId: decision.dispatchId,
          payloadDispatchId: decision.payloadDispatchId,
          evidenceTimestamp: decision.evidenceTimestamp,
          completionReason: decision.completionReason,
          accepted: false,
        },
      });
      return;
    }

    // Stop monitoring first to prevent duplicate processing
    this.stopMonitoring(sessionKey);

    // Add agent's response as a comment
    if (responseText) {
      addComment({
        id: uuidv4(),
        task_id: taskId,
        agent_id: agentId,
        author_type: "agent",
        content: responseText,
      });
    }

    // Manager-owned transition to review after completion gate acceptance.
    updateTask(taskId, { status: "review" });

    const duration = Math.round((Date.now() - monitor.startedAt) / 1000);
    logActivity({
      id: uuidv4(),
      type: "task_review",
      task_id: taskId,
      agent_id: agentId,
      message: `Agent "${agentId}" completed work on "${task.title}" in ${duration}s — moved to review`,
      metadata: {
        duration,
        sessionKey,
        dispatchId: task.dispatch_id,
        payloadDispatchId: extractDispatchCompletion(responseText || "").dispatchId,
        evidenceTimestamp,
        completionReason: "accepted",
        accepted: true,
      },
    });

    addComment({
      id: uuidv4(),
      task_id: taskId,
      author_type: "system",
      content: `✅ Agent completed in ${duration}s. Task moved to review.`,
    });

    console.log(
      `[AgentTaskMonitor] Task ${taskId} moved to REVIEW (completion gate accepted)`
    );
  }

  /**
   * Timeout/error guard: do NOT force-review. Keep task in progress and log rework signal.
   */
  private async forceComplete(
    sessionKey: string,
    reason: "timeout" | "error"
  ): Promise<void> {
    const monitor = this.monitors.get(sessionKey);
    if (!monitor) return;

    const { taskId, agentId } = monitor;
    this.stopMonitoring(sessionKey);

    const task = getTask(taskId);
    if (!task || task.status !== "in_progress") return;

    addComment({
      id: uuidv4(),
      task_id: taskId,
      author_type: "system",
      content:
        reason === "timeout"
          ? "⏱️ Completion monitor timeout. Task kept in progress for re-dispatch/rework (no auto-review)."
          : "⚠️ Completion monitor error. Task kept in progress for re-dispatch/rework (no auto-review).",
    });

    logActivity({
      id: uuidv4(),
      type: "task_completion_gate_rejected",
      task_id: taskId,
      agent_id: agentId,
      message: `Completion guard kept task in progress (${reason})`,
      metadata: {
        dispatchId: task.dispatch_id,
        payloadDispatchId: null,
        evidenceTimestamp: new Date().toISOString(),
        completionReason: "rejected_suspicious_instant_no_new_evidence",
        accepted: false,
      },
    });

    console.log(
      `[AgentTaskMonitor] Task ${taskId} kept IN_PROGRESS (${reason})`
    );
  }
}

/**
 * Get the singleton AgentTaskMonitor instance.
 */
export function getAgentTaskMonitor(): AgentTaskMonitor {
  if (!globalForMonitor.__agentTaskMonitor) {
    globalForMonitor.__agentTaskMonitor = new AgentTaskMonitor();
  }
  return globalForMonitor.__agentTaskMonitor;
}
