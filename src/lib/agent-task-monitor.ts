import { v4 as uuidv4 } from "uuid";
import { getOpenClawClient } from "./openclaw-client";
import { getTask, addComment, logActivity, listDeliverables } from "./db";
import { evaluateCompletion, extractDispatchCompletion, extractTextContent } from "./completion-gate";
import { transitionTaskStatus } from "./task-state";
import { resolveInternalApiUrl } from "./internal-api";
import { isOrchestratorEnabled, orchestrateAfterCompletion, orchestrateAfterTesting } from "./orchestrator";

// --- Types ---

function isLikelyCompletionSignal(text: string, hasMarker: boolean): boolean {
  if (hasMarker) return true;
  const lower = (text || "").toLowerCase();
  return (
    lower.includes("done") ||
    lower.includes("completed") ||
    lower.includes("implemented") ||
    lower.includes("finished")
  );
}

interface ActiveMonitor {
  taskId: string;
  sessionKey: string;
  agentId: string;
  startedAt: number;
  pollTimer: ReturnType<typeof setInterval>;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  ackTimeoutTimer?: ReturnType<typeof setTimeout>;
  unsubscribeEvents?: () => void;
  lastMessageCount: number;
  lastActivityAt: number;
  dispatchId?: string;
  dispatchStartedAt?: string;
  baselineAssistantCount?: number;
  firstActivityAcked: boolean;
}

// --- Singleton ---

const globalForMonitor = globalThis as typeof globalThis & {
  __agentTaskMonitor?: AgentTaskMonitor;
};

class AgentTaskMonitor {
  private monitors: Map<string, ActiveMonitor> = new Map(); // sessionKey → monitor
  private readonly POLL_INTERVAL_MS = 10_000; // Check every 10 seconds
  private readonly IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minute idle timeout
  private readonly FIRST_ACTIVITY_ACK_TIMEOUT_MS = this.resolveAckTimeoutMs();

  private resolveAckTimeoutMs(): number {
    const parsed = Number(process.env.MC_FIRST_ACTIVITY_ACK_TIMEOUT_MS ?? "90000");
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 90_000;
  }

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
      ackTimeoutTimer: undefined,
      unsubscribeEvents: undefined,
      lastMessageCount: initialCount,
      lastActivityAt: Date.now(),
      dispatchId: opts?.dispatchId,
      dispatchStartedAt: opts?.dispatchStartedAt,
      baselineAssistantCount: initialCount,
      firstActivityAcked: false,
    };

    this.monitors.set(sessionKey, monitor);
    this.resetIdleTimeout(monitor);
    this.startAckTimeout(monitor);
    this.subscribeToLifecycleEvents(monitor);

    console.log(
      `[AgentTaskMonitor] Monitoring started: task=${taskId}, session=${sessionKey}, agent=${agentId}, initialMsgs=${initialCount}, ackTimeoutMs=${this.FIRST_ACTIVITY_ACK_TIMEOUT_MS}`
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
      clearTimeout(monitor.ackTimeoutTimer);
      monitor.unsubscribeEvents?.();
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
    firstActivityAcked: boolean;
    dispatchId?: string;
  }[] {
    return Array.from(this.monitors.values()).map(
      ({ taskId, sessionKey, agentId, startedAt, firstActivityAcked, dispatchId }) => ({
        taskId,
        sessionKey,
        agentId,
        startedAt,
        firstActivityAcked,
        dispatchId,
      })
    );
  }

  getAckTimeoutMs(): number {
    return this.FIRST_ACTIVITY_ACK_TIMEOUT_MS;
  }

  // --- Private ---

  private subscribeToLifecycleEvents(monitor: ActiveMonitor): void {
    const client = getOpenClawClient();
    monitor.unsubscribeEvents = client.onEvent("*", (evt) => {
      this.maybeAcknowledgeFromEvent(monitor.sessionKey, evt);
    });
  }

  private maybeAcknowledgeFromEvent(sessionKey: string, evt: unknown): void {
    const monitor = this.monitors.get(sessionKey);
    if (!monitor || monitor.firstActivityAcked) return;

    const frame = evt as {
      event?: string;
      payload?: {
        sessionKey?: string;
        session?: string;
        key?: string;
        role?: string;
        status?: string;
        phase?: string;
        stage?: string;
        message?: { role?: string };
      };
    };

    const eventName = String(frame?.event ?? "").toLowerCase();
    const payload = frame?.payload ?? {};
    const payloadSession = payload.sessionKey ?? payload.session ?? payload.key;

    if (!payloadSession || payloadSession !== monitor.sessionKey) return;

    const role = String(payload.role ?? payload.message?.role ?? "").toLowerCase();
    const phaseText = `${String(payload.status ?? "")} ${String(payload.phase ?? "")} ${String(payload.stage ?? "")}`.toLowerCase();

    const assistantSignal = role === "assistant";
    const lifecycleSignal =
      eventName.includes("lifecycle") ||
      eventName.includes("run.start") ||
      eventName.includes("run.progress") ||
      eventName.includes("chat.run.start") ||
      eventName.includes("chat.run.progress") ||
      /(start|started|progress|running)/.test(phaseText);

    if (assistantSignal || lifecycleSignal) {
      this.markFirstActivityAck(monitor, `event:${eventName || "unknown"}`);
    }
  }

  private startAckTimeout(monitor: ActiveMonitor): void {
    monitor.ackTimeoutTimer = setTimeout(async () => {
      await this.handleAckTimeout(monitor.sessionKey);
    }, this.FIRST_ACTIVITY_ACK_TIMEOUT_MS);
  }

  private markFirstActivityAck(monitor: ActiveMonitor, source: string): void {
    if (monitor.firstActivityAcked) return;
    monitor.firstActivityAcked = true;
    clearTimeout(monitor.ackTimeoutTimer);
    monitor.ackTimeoutTimer = undefined;

    // Don't move "testing" tasks to "in_progress" — tester activity should keep the task in testing
    const task = getTask(monitor.taskId);
    if (task?.status === "testing") {
      console.log(
        `[AgentTaskMonitor] First tester activity acked for task ${monitor.taskId} via ${source} (staying in testing)`
      );
      return;
    }

    transitionTaskStatus(monitor.taskId, "in_progress", {
      actor: "monitor",
      reason: "first_agent_activity_ack",
      agentId: monitor.agentId,
      metadata: {
        source,
        sessionKey: monitor.sessionKey,
        dispatchId: monitor.dispatchId,
      },
    });

    console.log(
      `[AgentTaskMonitor] First activity acked for task ${monitor.taskId} via ${source}`
    );
  }

  private async handleAckTimeout(sessionKey: string): Promise<void> {
    const monitor = this.monitors.get(sessionKey);
    if (!monitor || monitor.firstActivityAcked) return;

    const task = getTask(monitor.taskId);
    if (!task || (task.status !== "in_progress" && task.status !== "assigned")) {
      this.stopMonitoring(sessionKey);
      return;
    }

    transitionTaskStatus(monitor.taskId, "assigned", {
      actor: "monitor",
      reason: "ack_timeout_no_activity",
      agentId: monitor.agentId,
      patch: {
        assigned_agent_id: monitor.agentId,
      },
      metadata: {
        sessionKey: monitor.sessionKey,
        dispatchId: task.dispatch_id,
        ackTimeoutMs: this.FIRST_ACTIVITY_ACK_TIMEOUT_MS,
      },
    });

    addComment({
      id: uuidv4(),
      task_id: monitor.taskId,
      author_type: "system",
      content: "No agent activity detected within ack window; reverted to Assigned.",
    });

    logActivity({
      id: uuidv4(),
      type: "task_ack_timeout",
      task_id: monitor.taskId,
      agent_id: monitor.agentId,
      message: `No agent activity detected for "${task.title}" within ack window; reverted to assigned`,
      metadata: {
        sessionKey: monitor.sessionKey,
        dispatchId: task.dispatch_id,
        ackTimeoutMs: this.FIRST_ACTIVITY_ACK_TIMEOUT_MS,
      },
    });

    this.stopMonitoring(sessionKey);

    console.log(
      `[AgentTaskMonitor] Ack timeout for task ${monitor.taskId}; reverted to ASSIGNED`
    );
  }

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

  private isFreshForDispatch(
    monitor: ActiveMonitor,
    timestamp: string | undefined
  ): boolean {
    if (!monitor.dispatchStartedAt || !timestamp) return true;
    const dispatchMs = Date.parse(monitor.dispatchStartedAt);
    const tsMs = Date.parse(timestamp);
    if (!Number.isFinite(dispatchMs) || !Number.isFinite(tsMs)) return true;
    return tsMs >= dispatchMs;
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
      if (!task || (task.status !== "assigned" && task.status !== "in_progress" && task.status !== "testing")) {
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

        if (this.isFreshForDispatch(monitor, latestResponse.timestamp)) {
          this.markFirstActivityAck(monitor, "assistant_message");
        }

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
    responseContent: unknown,
    assistantMessageCount: number,
    evidenceTimestamp: string
  ): Promise<void> {
    const { taskId, agentId, sessionKey } = monitor;

    // Verify task still exists and is active (including testing for tester agent)
    const task = getTask(taskId);
    if (!task || (task.status !== "assigned" && task.status !== "in_progress" && task.status !== "testing")) {
      console.log(
        `[AgentTaskMonitor] Task ${taskId} not in expected state (current: ${task?.status}). Skipping.`
      );
      return;
    }

    const responseText = extractTextContent(responseContent);
    const extracted = extractDispatchCompletion(responseText || "");
    const decision = evaluateCompletion(task, {
      payloadDispatchId: extracted.dispatchId,
      hasCompletionMarker: extracted.hasCompletionMarker,
      evidenceTimestamp,
      assistantMessageCount,
    });

    if (!decision.accepted) {
      if (!isLikelyCompletionSignal(responseText, extracted.hasCompletionMarker)) {
        return;
      }

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

    const duration = Math.round((Date.now() - monitor.startedAt) / 1000);

    // Determine if this completion is from the tester agent (testing phase)
    const isTesterCompletion = task.status === "testing";

    // Route through orchestrator if enabled
    if (isOrchestratorEnabled()) {
      logActivity({
        id: uuidv4(),
        type: isTesterCompletion ? "task_tester_completed" : "task_programmer_completed",
        task_id: taskId,
        agent_id: agentId,
        message: `Agent "${agentId}" completed ${isTesterCompletion ? "testing" : "work"} on "${task.title}" in ${duration}s — routing through orchestrator`,
        metadata: {
          duration, sessionKey,
          dispatchId: task.dispatch_id,
          payloadDispatchId: extractDispatchCompletion(responseText || "").dispatchId,
          evidenceTimestamp, completionReason: "accepted", accepted: true,
          phase: isTesterCompletion ? "testing" : "completion",
        },
      });

      addComment({
        id: uuidv4(),
        task_id: taskId,
        author_type: "system",
        content: `Agent completed ${isTesterCompletion ? "testing" : "work"} in ${duration}s. Orchestrator evaluating...`,
      });

      // Fire-and-forget: orchestrator handles the transition
      if (isTesterCompletion) {
        orchestrateAfterTesting(taskId).catch((err) => {
          console.error(`[AgentTaskMonitor] orchestrateAfterTesting failed for ${taskId}:`, err);
          // Fallback: send to review
          transitionTaskStatus(taskId, "review", {
            actor: "monitor",
            reason: "orchestrator_after_testing_fallback",
            agentId,
            bypassGuards: true,
          });
        });
      } else {
        orchestrateAfterCompletion(taskId).catch((err) => {
          console.error(`[AgentTaskMonitor] orchestrateAfterCompletion failed for ${taskId}:`, err);
          // Fallback: send to review
          transitionTaskStatus(taskId, "review", {
            actor: "monitor",
            reason: "orchestrator_after_completion_fallback",
            agentId,
            bypassGuards: true,
          });
        });
      }

      console.log(
        `[AgentTaskMonitor] Task ${taskId} routed to orchestrator (${isTesterCompletion ? "after testing" : "after completion"})`
      );
      return;
    }

    // --- Default behavior (no orchestrator) ---

    // Check if task has testable deliverables — if so, route through testing
    const deliverables = listDeliverables(taskId);
    const hasTestableDeliverables = deliverables.some(
      (d) => d.deliverable_type === "file" || d.deliverable_type === "url"
    );

    if (hasTestableDeliverables && !isTesterCompletion) {
      // Route through automated testing before review
      transitionTaskStatus(taskId, "testing", {
        actor: "monitor",
        reason: "completion_gate_accepted_testing",
        agentId,
        metadata: { sessionKey, dispatchId: task.dispatch_id },
      });

      logActivity({
        id: uuidv4(),
        type: "task_testing",
        task_id: taskId,
        agent_id: agentId,
        message: `Agent "${agentId}" completed work on "${task.title}" in ${duration}s — running automated tests`,
        metadata: {
          duration, sessionKey,
          dispatchId: task.dispatch_id,
          payloadDispatchId: extractDispatchCompletion(responseText || "").dispatchId,
          evidenceTimestamp, completionReason: "accepted", accepted: true,
        },
      });

      addComment({
        id: uuidv4(),
        task_id: taskId,
        author_type: "system",
        content: `Agent completed in ${duration}s. Running automated tests on deliverables...`,
      });

      // Trigger test endpoint
      try {
        fetch(resolveInternalApiUrl(`/api/tasks/${taskId}/test`), { method: "POST" }).catch((err) =>
          console.error(`[AgentTaskMonitor] Test trigger failed for ${taskId}:`, err)
        );
      } catch (err) {
        console.error(`[AgentTaskMonitor] Test trigger error for ${taskId}:`, err);
      }

      console.log(
        `[AgentTaskMonitor] Task ${taskId} moved to TESTING (completion gate accepted, deliverables found)`
      );
    } else {
      // No deliverables or tester completed — go straight to review (backward compatible)
      transitionTaskStatus(taskId, "review", {
        actor: "monitor",
        reason: isTesterCompletion ? "tester_completion_gate_accepted" : "completion_gate_accepted",
        agentId,
        metadata: { sessionKey, dispatchId: task.dispatch_id },
      });

      logActivity({
        id: uuidv4(),
        type: "task_review",
        task_id: taskId,
        agent_id: agentId,
        message: `Agent "${agentId}" completed ${isTesterCompletion ? "testing" : "work"} on "${task.title}" in ${duration}s — moved to review`,
        metadata: {
          duration, sessionKey,
          dispatchId: task.dispatch_id,
          payloadDispatchId: extractDispatchCompletion(responseText || "").dispatchId,
          evidenceTimestamp, completionReason: "accepted", accepted: true,
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
