import { v4 as uuidv4 } from "uuid";
import { getOpenClawClient } from "./openclaw-client";
import { getTask, updateTask, addComment, logActivity } from "./db";

// --- Types ---

interface ActiveMonitor {
  taskId: string;
  sessionKey: string;
  agentId: string;
  startedAt: number;
  pollTimer: ReturnType<typeof setInterval>;
  timeoutTimer: ReturnType<typeof setTimeout>;
  lastMessageCount: number;
}

// --- Singleton ---

const globalForMonitor = globalThis as typeof globalThis & {
  __agentTaskMonitor?: AgentTaskMonitor;
};

class AgentTaskMonitor {
  private monitors: Map<string, ActiveMonitor> = new Map(); // sessionKey → monitor
  private readonly POLL_INTERVAL_MS = 10_000; // Check every 10 seconds
  private readonly TIMEOUT_MS = 5 * 60 * 1000; // 5 minute max

  /**
   * Start monitoring a dispatched task for agent completion.
   * Uses polling to check chat history for new assistant messages.
   */
  async startMonitoring(
    taskId: string,
    sessionKey: string,
    agentId: string
  ): Promise<void> {
    // Clean up any existing monitor for this session
    this.stopMonitoring(sessionKey);

    // Get initial message count so we can detect new messages
    let initialCount = 0;
    try {
      const client = getOpenClawClient();
      const history = await client.getChatHistory(sessionKey);
      initialCount = history.filter((m) => m.role === "assistant").length;
    } catch {
      // Start from 0 if we can't get history
    }

    // Set up polling interval
    const pollTimer = setInterval(async () => {
      await this.pollForCompletion(sessionKey);
    }, this.POLL_INTERVAL_MS);

    // Set up absolute timeout
    const timeoutTimer = setTimeout(async () => {
      console.log(
        `[AgentTaskMonitor] Timeout for task ${taskId} (session: ${sessionKey}). Force-moving to review.`
      );
      await this.forceComplete(sessionKey, "timeout");
    }, this.TIMEOUT_MS);

    const monitor: ActiveMonitor = {
      taskId,
      sessionKey,
      agentId,
      startedAt: Date.now(),
      pollTimer,
      timeoutTimer,
      lastMessageCount: initialCount,
    };

    this.monitors.set(sessionKey, monitor);
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
        console.log(
          `[AgentTaskMonitor] New agent response detected for task ${monitor.taskId} (${assistantMsgs.length} msgs, was ${monitor.lastMessageCount})`
        );

        await this.handleCompletion(monitor, latestResponse.content);
      }
    } catch (err) {
      console.error(
        `[AgentTaskMonitor] Poll error for session ${sessionKey}:`,
        String(err)
      );
    }
  }

  /**
   * Handle successful agent completion — move task to review.
   */
  private async handleCompletion(
    monitor: ActiveMonitor,
    responseText: string
  ): Promise<void> {
    const { taskId, agentId, sessionKey } = monitor;

    // Stop monitoring first to prevent duplicate processing
    this.stopMonitoring(sessionKey);

    // Verify task still exists and is in_progress
    const task = getTask(taskId);
    if (!task || task.status !== "in_progress") {
      console.log(
        `[AgentTaskMonitor] Task ${taskId} not in expected state (current: ${task?.status}). Skipping.`
      );
      return;
    }

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

    // Move task to review
    updateTask(taskId, { status: "review" });

    const duration = Math.round((Date.now() - monitor.startedAt) / 1000);
    logActivity({
      id: uuidv4(),
      type: "task_review",
      task_id: taskId,
      agent_id: agentId,
      message: `Agent "${agentId}" completed work on "${task.title}" in ${duration}s — moved to review`,
      metadata: { duration, sessionKey },
    });

    addComment({
      id: uuidv4(),
      task_id: taskId,
      author_type: "system",
      content: `✅ Agent completed in ${duration}s. Task moved to review.`,
    });

    console.log(
      `[AgentTaskMonitor] Task ${taskId} moved to REVIEW (agent completed in ${duration}s)`
    );
  }

  /**
   * Force-complete a task (on timeout or error) — move to review.
   */
  private async forceComplete(
    sessionKey: string,
    reason: "timeout" | "error"
  ): Promise<void> {
    const monitor = this.monitors.get(sessionKey);
    if (!monitor) return;

    const { taskId, agentId } = monitor;

    // Try to get any response before giving up
    let responseText = "";
    try {
      const client = getOpenClawClient();
      const history = await client.getChatHistory(sessionKey);
      const assistantMsgs = history.filter((m) => m.role === "assistant");
      if (assistantMsgs.length > monitor.lastMessageCount) {
        responseText = assistantMsgs[assistantMsgs.length - 1].content;
      }
    } catch {
      // Ignore — we'll move to review anyway
    }

    // Stop monitoring
    this.stopMonitoring(sessionKey);

    const task = getTask(taskId);
    if (!task || task.status !== "in_progress") return;

    if (responseText) {
      addComment({
        id: uuidv4(),
        task_id: taskId,
        agent_id: agentId,
        author_type: "agent",
        content: responseText,
      });
    }

    updateTask(taskId, { status: "review" });

    addComment({
      id: uuidv4(),
      task_id: taskId,
      author_type: "system",
      content:
        reason === "timeout"
          ? "⏱️ Monitor timeout reached. Task moved to review."
          : "⚠️ Monitor error occurred. Task moved to review.",
    });

    logActivity({
      id: uuidv4(),
      type: "task_review",
      task_id: taskId,
      agent_id: agentId,
      message: `Task "${task.title}" moved to review (${reason})`,
    });

    console.log(
      `[AgentTaskMonitor] Task ${taskId} force-moved to REVIEW (${reason})`
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
