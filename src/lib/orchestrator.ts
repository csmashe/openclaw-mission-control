import { v4 as uuidv4 } from "uuid";
import { getOpenClawClient } from "./openclaw-client";
import {
  getTask,
  addComment,
  logActivity,
  listComments,
  listDeliverables,
  updateTask,
  getWorkflowSettings,
  type WorkflowSettings,
} from "./db";
import { transitionTaskStatus } from "./task-state";
import { extractJSON } from "./planning-utils";
import { getAgentTaskMonitor } from "./agent-task-monitor";
import { resolveInternalApiUrl } from "./internal-api";

// --- Types ---

export interface OrchestratorDecision {
  action: string;
  reasoning: string;
  feedback?: string;
}

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_TIME_MS = 90_000;

// --- Public API ---

export function isOrchestratorEnabled(): boolean {
  const settings = getWorkflowSettings();
  return !!settings.orchestrator_agent_id;
}

/**
 * Invoke the orchestrator agent for a single-turn decision.
 * Sends a prompt, polls for the JSON response, and parses it.
 */
export async function invokeOrchestrator(
  taskId: string,
  prompt: string
): Promise<OrchestratorDecision> {
  const settings = getWorkflowSettings();
  const orchestratorId = settings.orchestrator_agent_id;
  if (!orchestratorId) {
    throw new Error("Orchestrator not configured");
  }

  const sessionKey = `agent:${orchestratorId}:orchestrate:${taskId}`;

  // Store orchestrator session key on task
  updateTask(taskId, { orchestrator_session_key: sessionKey });

  const client = getOpenClawClient();
  await client.connect();

  // Get baseline message count
  let baseline = 0;
  try {
    const history = await client.getChatHistory(sessionKey);
    baseline = history.filter((m) => m.role === "assistant").length;
  } catch {
    // New session, start from 0
  }

  // Send the prompt
  await client.sendMessage(sessionKey, prompt);

  // Poll for response
  const startTime = Date.now();
  let retried = false;

  while (Date.now() - startTime < MAX_POLL_TIME_MS) {
    await sleep(POLL_INTERVAL_MS);

    try {
      const history = await client.getChatHistory(sessionKey);
      const assistantMsgs = history.filter((m) => m.role === "assistant");

      if (assistantMsgs.length > baseline) {
        const latest = assistantMsgs[assistantMsgs.length - 1];
        const content =
          typeof latest.content === "string"
            ? latest.content
            : String(latest.content);

        const parsed = extractJSON(content) as OrchestratorDecision | null;
        if (parsed && parsed.action) {
          return parsed;
        }

        // If we couldn't parse JSON, retry once with a nudge
        if (!retried) {
          retried = true;
          baseline = assistantMsgs.length;
          await client.sendMessage(
            sessionKey,
            "Your previous response was not valid JSON. Please respond ONLY with a JSON object containing `action`, `reasoning`, and optionally `feedback` fields."
          );
          continue;
        }

        // Second failure — return a best-effort parse
        console.warn(
          `[Orchestrator] Could not parse JSON from orchestrator response for task ${taskId}`
        );
        return {
          action: "fallback",
          reasoning: `Orchestrator response was not valid JSON: ${content.slice(0, 200)}`,
        };
      }
    } catch (err) {
      console.error(`[Orchestrator] Poll error for task ${taskId}:`, err);
    }
  }

  // Timeout
  console.warn(`[Orchestrator] Timeout waiting for orchestrator decision on task ${taskId}`);
  return { action: "fallback", reasoning: "Orchestrator timeout" };
}

/**
 * After planning completes: orchestrator evaluates spec and decides next step.
 * Decisions: dispatch_to_programmer | needs_more_planning
 * Fallback: dispatch_to_programmer
 */
export async function orchestrateAfterPlanning(taskId: string): Promise<void> {
  const task = getTask(taskId);
  if (!task) return;

  let spec = "";
  try {
    const raw = (task as unknown as Record<string, unknown>).planning_spec;
    spec = typeof raw === "string" ? raw : JSON.stringify(raw);
  } catch {
    spec = "No spec available";
  }

  const recentComments = listComments(taskId)
    .slice(-5)
    .map((c) => `[${c.author_type}] ${c.content}`)
    .join("\n");

  const prompt = `You are a workflow orchestrator. A planning phase just completed for this task. Review the spec and decide the next step.

## Task
**Title:** ${task.title}
**Description:** ${task.description}
**Assigned Agent:** ${task.assigned_agent_id || "none"}

## Planning Spec
${spec}

## Recent Comments
${recentComments || "None"}

Respond with ONLY a JSON object:
{
  "action": "dispatch_to_programmer" or "needs_more_planning",
  "reasoning": "brief explanation"
}`;

  let decision: OrchestratorDecision;
  try {
    decision = await invokeOrchestrator(taskId, prompt);
  } catch (err) {
    console.error(`[Orchestrator] orchestrateAfterPlanning failed for ${taskId}:`, err);
    decision = { action: "dispatch_to_programmer", reasoning: "Orchestrator error — dispatching anyway" };
  }

  logActivity({
    id: uuidv4(),
    type: "orchestrator_decision",
    task_id: taskId,
    message: `Orchestrator after planning: ${decision.action} — ${decision.reasoning}`,
    metadata: { phase: "after_planning", decision },
  });

  if (decision.action === "needs_more_planning") {
    addComment({
      id: uuidv4(),
      task_id: taskId,
      author_type: "system",
      content: `Orchestrator: Needs more planning — ${decision.reasoning}`,
    });
    return;
  }

  // Default: dispatch to programmer
  if (task.assigned_agent_id) {
    try {
      await fetch(resolveInternalApiUrl("/api/tasks/dispatch"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, agentId: task.assigned_agent_id }),
      });
    } catch (err) {
      console.error(`[Orchestrator] Dispatch failed for ${taskId}:`, err);
      addComment({
        id: uuidv4(),
        task_id: taskId,
        author_type: "system",
        content: `Orchestrator dispatch failed: ${String(err)}`,
      });
    }
  }
}

/**
 * After programmer completes: orchestrator decides whether to test or review.
 * Decisions: send_to_testing | send_to_review
 * Fallback: send_to_review
 */
export async function orchestrateAfterCompletion(taskId: string): Promise<void> {
  const task = getTask(taskId);
  if (!task) return;

  const settings = getWorkflowSettings();
  const deliverables = listDeliverables(taskId);
  const recentComments = listComments(taskId)
    .slice(-5)
    .map((c) => `[${c.author_type}] ${c.content}`)
    .join("\n");

  const prompt = `You are a workflow orchestrator. A programmer agent just completed work on this task. Decide the next step.

## Task
**Title:** ${task.title}
**Description:** ${task.description}

## Deliverables
${deliverables.length > 0 ? deliverables.map((d) => `- [${d.deliverable_type}] ${d.title}: ${d.path || d.description || "no path"}`).join("\n") : "None registered"}

## Recent Comments
${recentComments || "None"}

## Available Options
- "send_to_testing": Route to tester agent for validation (tester agent: ${settings.tester_agent_id || "not configured"})
- "send_to_review": Skip testing, move directly to human review

Respond with ONLY a JSON object:
{
  "action": "send_to_testing" or "send_to_review",
  "reasoning": "brief explanation"
}`;

  let decision: OrchestratorDecision;
  try {
    decision = await invokeOrchestrator(taskId, prompt);
  } catch (err) {
    console.error(`[Orchestrator] orchestrateAfterCompletion failed for ${taskId}:`, err);
    decision = { action: "send_to_review", reasoning: "Orchestrator error — sending to review" };
  }

  logActivity({
    id: uuidv4(),
    type: "orchestrator_decision",
    task_id: taskId,
    message: `Orchestrator after completion: ${decision.action} — ${decision.reasoning}`,
    metadata: { phase: "after_completion", decision },
  });

  if (decision.action === "send_to_testing" && settings.tester_agent_id) {
    await dispatchToTesterAgent(taskId, settings);
  } else {
    // Default: send to review
    transitionTaskStatus(taskId, "review", {
      actor: "system",
      reason: "orchestrator_send_to_review",
      metadata: { orchestratorDecision: decision },
    });

    addComment({
      id: uuidv4(),
      task_id: taskId,
      author_type: "system",
      content: `Orchestrator: Sending to review — ${decision.reasoning}`,
    });
  }
}

/**
 * After tester completes: orchestrator evaluates results.
 * Decisions: send_to_review | send_to_programmer (rework)
 * Fallback: send_to_review
 */
export async function orchestrateAfterTesting(taskId: string): Promise<void> {
  const task = getTask(taskId);
  if (!task) return;

  const settings = getWorkflowSettings();
  const recentComments = listComments(taskId)
    .slice(-10)
    .map((c) => `[${c.author_type}] ${c.content}`)
    .join("\n");

  const reworkCount = task.rework_count ?? 0;
  const maxRework = settings.max_rework_cycles;

  const prompt = `You are a workflow orchestrator. A tester agent just completed validation on this task. Review the results and decide the next step.

## Task
**Title:** ${task.title}
**Description:** ${task.description}
**Rework Count:** ${reworkCount} / ${maxRework} max

## Recent Comments (including test results)
${recentComments || "None"}

## Available Options
- "send_to_review": Tests passed or issues are minor — move to human review
- "send_to_programmer": Tests failed — send back for rework (include feedback in "feedback" field)

Respond with ONLY a JSON object:
{
  "action": "send_to_review" or "send_to_programmer",
  "reasoning": "brief explanation",
  "feedback": "specific rework instructions (only if sending to programmer)"
}`;

  let decision: OrchestratorDecision;
  try {
    decision = await invokeOrchestrator(taskId, prompt);
  } catch (err) {
    console.error(`[Orchestrator] orchestrateAfterTesting failed for ${taskId}:`, err);
    decision = { action: "send_to_review", reasoning: "Orchestrator error — sending to review" };
  }

  logActivity({
    id: uuidv4(),
    type: "orchestrator_decision",
    task_id: taskId,
    message: `Orchestrator after testing: ${decision.action} — ${decision.reasoning}`,
    metadata: { phase: "after_testing", decision, reworkCount },
  });

  if (decision.action === "send_to_programmer") {
    // Check rework limit
    if (reworkCount >= maxRework) {
      addComment({
        id: uuidv4(),
        task_id: taskId,
        author_type: "system",
        content: `Orchestrator: Max rework cycles reached (${maxRework}). Escalating to review despite test issues.`,
      });

      transitionTaskStatus(taskId, "review", {
        actor: "system",
        reason: "orchestrator_max_rework_reached",
        metadata: { reworkCount, maxRework },
      });
      return;
    }

    // Increment rework count and dispatch back to programmer
    updateTask(taskId, { rework_count: reworkCount + 1 });

    addComment({
      id: uuidv4(),
      task_id: taskId,
      author_type: "system",
      content: `Orchestrator: Rework needed (${reworkCount + 1}/${maxRework}) — ${decision.reasoning}`,
    });

    if (task.assigned_agent_id) {
      try {
        await fetch(resolveInternalApiUrl("/api/tasks/dispatch"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId,
            agentId: task.assigned_agent_id,
            feedback: decision.feedback || decision.reasoning,
          }),
        });
      } catch (err) {
        console.error(`[Orchestrator] Rework dispatch failed for ${taskId}:`, err);
        // Fall through to review if dispatch fails
        transitionTaskStatus(taskId, "review", {
          actor: "system",
          reason: "orchestrator_rework_dispatch_failed",
          bypassGuards: true,
        });
      }
    } else {
      // No agent to rework with — go to review
      transitionTaskStatus(taskId, "review", {
        actor: "system",
        reason: "orchestrator_no_agent_for_rework",
      });
    }
  } else {
    // Default: send to review
    transitionTaskStatus(taskId, "review", {
      actor: "system",
      reason: "orchestrator_tests_passed",
      metadata: { orchestratorDecision: decision },
    });

    addComment({
      id: uuidv4(),
      task_id: taskId,
      author_type: "system",
      content: `Orchestrator: Tests evaluated — sending to review. ${decision.reasoning}`,
    });
  }
}

/**
 * Dispatch a task to the tester agent for validation.
 */
export async function dispatchToTesterAgent(
  taskId: string,
  settings?: WorkflowSettings
): Promise<void> {
  const ws = settings ?? getWorkflowSettings();
  const testerId = ws.tester_agent_id;
  if (!testerId) {
    console.warn(`[Orchestrator] No tester agent configured for task ${taskId}`);
    return;
  }

  const task = getTask(taskId);
  if (!task) return;

  let spec = "";
  try {
    const raw = (task as unknown as Record<string, unknown>).planning_spec;
    if (raw) spec = typeof raw === "string" ? raw : JSON.stringify(raw);
  } catch {
    // ignore
  }

  const deliverables = listDeliverables(taskId);
  const recentComments = listComments(taskId)
    .slice(-5)
    .map((c) => `[${c.author_type}] ${c.content}`)
    .join("\n");

  const dispatchId = uuidv4();
  const sessionKey = `agent:${testerId}:testing:${taskId}`;

  const prompt = `## Test Validation Assignment

You are the tester agent. Validate the completed work for this task.

**Title:** ${task.title}
**Description:** ${task.description}
${spec ? `\n**Planning Spec:**\n${spec}\n` : ""}

**Deliverables:**
${deliverables.length > 0 ? deliverables.map((d) => `- [${d.deliverable_type}] ${d.title}: ${d.path || d.description || "no path"}`).join("\n") : "None registered"}

**Recent Comments:**
${recentComments || "None"}

---

**Test Plan:**
1. **Stage 1 — Code validation:** Review code changes, run lint (\`eslint .\`), run type checks (\`tsc --noEmit\`), look for obvious problems.
2. **Stage 2 — Build & browser** (only if stage 1 passes): Run \`next build\`, restart the dev server, validate in the browser that changes work correctly.

**Dispatch ID:** ${dispatchId}

When testing is complete, respond exactly with:
TASK_COMPLETE dispatch_id=${dispatchId}: <brief summary of test results>

Include in your response whether tests passed or failed and specific details about any issues found.`;

  // Transition to testing
  transitionTaskStatus(taskId, "testing", {
    actor: "system",
    reason: "orchestrator_dispatch_to_tester",
    patch: {
      tester_session_key: sessionKey,
      dispatch_id: dispatchId,
      dispatch_started_at: new Date().toISOString(),
      assigned_agent_id: task.assigned_agent_id, // Keep programmer as assigned
    },
    metadata: { testerAgentId: testerId, sessionKey, dispatchId },
  });

  addComment({
    id: uuidv4(),
    task_id: taskId,
    author_type: "system",
    content: `Orchestrator: Dispatching to tester agent "${testerId}" for validation.`,
  });

  try {
    const client = getOpenClawClient();
    await client.connect();

    let baselineAssistantCount = 0;
    try {
      const history = await client.getChatHistory(sessionKey);
      baselineAssistantCount = history.filter((m) => m.role === "assistant").length;
    } catch {
      // New session
    }

    // Update baseline for monitor
    updateTask(taskId, { dispatch_message_count_start: baselineAssistantCount });

    await client.sendMessage(sessionKey, prompt);

    // Start monitoring via AgentTaskMonitor (same as programmer)
    const monitor = getAgentTaskMonitor();
    await monitor.startMonitoring(taskId, sessionKey, testerId, {
      dispatchId,
      dispatchStartedAt: new Date().toISOString(),
      baselineAssistantCount,
    });
  } catch (err) {
    console.error(`[Orchestrator] Tester dispatch failed for ${taskId}:`, err);
    addComment({
      id: uuidv4(),
      task_id: taskId,
      author_type: "system",
      content: `Tester dispatch failed: ${String(err)}. Moving to review.`,
    });
    transitionTaskStatus(taskId, "review", {
      actor: "system",
      reason: "tester_dispatch_failed",
      bypassGuards: true,
    });
  }
}

// --- Helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
