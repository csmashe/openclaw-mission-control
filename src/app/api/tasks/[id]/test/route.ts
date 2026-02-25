/**
 * Task Test API
 * Runs lightweight MC-side checks (file existence, CSS validation, build/lint),
 * then delegates code review and browser testing to the agent via OpenClaw.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getTask, listDeliverables, addComment, logActivity, type TaskDeliverable } from "@/lib/db";
import { transitionTaskStatus } from "@/lib/task-state";
import { existsSync, readFileSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { getOpenClawClient } from "@/lib/openclaw-client";
import { extractJSON } from "@/lib/planning-utils";
import { extractTextContent } from "@/lib/completion-gate";

const execAsync = promisify(exec);

interface CssValidationError {
  message: string;
}

interface TestResult {
  passed: boolean;
  deliverable: {
    id: string;
    title: string;
    path: string;
    type: "file" | "url";
  };
  httpStatus: number | null;
  consoleErrors: string[];
  cssErrors: CssValidationError[];
  screenshotPath: string | null;
  duration: number;
  error?: string;
}

interface AgentTestResponse {
  passed: boolean;
  summary: string;
  issues?: string[];
}

// --- Utility functions (kept from original) ---

function validateCss(css: string): CssValidationError[] {
  const errors: CssValidationError[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const csstree = require("css-tree");
    csstree.parse(css, {
      parseAtrulePrelude: false,
      parseRulePrelude: false,
      parseValue: false,
      onParseError: (error: { rawMessage?: string; message: string }) => {
        errors.push({ message: error.rawMessage || error.message });
      },
    });
  } catch (error) {
    errors.push({ message: `CSS parse error: ${error instanceof Error ? error.message : String(error)}` });
  }
  return errors;
}

function extractAndValidateCss(htmlContent: string): CssValidationError[] {
  const errors: CssValidationError[] = [];
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let match;
  while ((match = styleRegex.exec(htmlContent)) !== null) {
    errors.push(...validateCss(match[1]));
  }
  return errors;
}

function isHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

function resolveDeliverablePath(inputPath: string): string {
  if (!inputPath) return inputPath;
  if (path.isAbsolute(inputPath)) return inputPath;

  const candidates = [
    path.resolve(process.cwd(), inputPath),
    ...(process.env.OPENCLAW_WORKSPACE ? [path.resolve(process.env.OPENCLAW_WORKSPACE, inputPath)] : []),
    ...(process.env.HOME ? [path.resolve(process.env.HOME, ".openclaw", "workspace", inputPath)] : []),
  ];

  const found = candidates.find((p) => existsSync(p));
  return found || candidates[0];
}

// --- Lightweight MC-side test (kept from original) ---

async function testDeliverableLightweight(deliverable: TaskDeliverable): Promise<TestResult> {
  const startTime = Date.now();
  const testPath = deliverable.path || "";
  const resolvedPath = resolveDeliverablePath(testPath);
  const isUrlDeliverable = deliverable.deliverable_type === "url";
  const consoleErrors: string[] = [];
  let cssErrors: CssValidationError[] = [];
  let httpStatus: number | null = null;

  if (isUrlDeliverable && isHttpUrl(testPath)) {
    try {
      const res = await fetch(testPath, { method: "HEAD", signal: AbortSignal.timeout(10000) });
      httpStatus = res.status;
      if (httpStatus < 200 || httpStatus >= 400) {
        consoleErrors.push(`HTTP error: status ${httpStatus}`);
      }
    } catch (err) {
      consoleErrors.push(`HTTP request failed: ${err}`);
    }
  } else {
    if (!testPath || !existsSync(resolvedPath)) {
      return {
        passed: false,
        deliverable: { id: deliverable.id, title: deliverable.title, path: testPath || "unknown", type: isUrlDeliverable ? "url" : "file" },
        httpStatus: null, consoleErrors: [`File does not exist: ${testPath}`],
        cssErrors: [], screenshotPath: null,
        duration: Date.now() - startTime, error: "File not found",
      };
    }

    if (testPath.endsWith(".html") || testPath.endsWith(".htm")) {
      const htmlContent = readFileSync(resolvedPath, "utf-8");
      cssErrors = extractAndValidateCss(htmlContent);
      if (htmlContent.trim().length < 10) {
        consoleErrors.push("File appears empty or too short");
      }
    }
  }

  const passed = consoleErrors.length === 0 && cssErrors.length === 0;

  return {
    passed,
    deliverable: { id: deliverable.id, title: deliverable.title, path: testPath, type: isUrlDeliverable ? "url" : "file" },
    httpStatus, consoleErrors, cssErrors, screenshotPath: null,
    duration: Date.now() - startTime,
  };
}

// --- Build & lint (new) ---

async function runBuildAndLint(): Promise<{ passed: boolean; lintOutput: string; buildOutput: string }> {
  const cwd = process.env.OPENCLAW_WORKSPACE || process.cwd();
  let lintOutput = "";
  let buildOutput = "";
  let lintPassed = true;
  let buildPassed = true;

  try {
    const lint = await execAsync("npm run lint 2>&1", { cwd, timeout: 60_000 });
    lintOutput = (lint.stdout + lint.stderr).trim();
  } catch (err) {
    lintPassed = false;
    const e = err as { stdout?: string; stderr?: string; message?: string };
    lintOutput = ((e.stdout || "") + (e.stderr || "") || e.message || "lint failed").trim();
  }

  try {
    const build = await execAsync("npm run build 2>&1", { cwd, timeout: 120_000 });
    buildOutput = (build.stdout + build.stderr).trim();
  } catch (err) {
    buildPassed = false;
    const e = err as { stdout?: string; stderr?: string; message?: string };
    buildOutput = ((e.stdout || "") + (e.stderr || "") || e.message || "build failed").trim();
  }

  return { passed: lintPassed && buildPassed, lintOutput, buildOutput };
}

// --- Agent delegation (new) ---

const AGENT_POLL_INTERVAL_MS = 5_000;
const AGENT_POLL_TIMEOUT_MS = 180_000; // 3 minutes

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function askAgentToTest(
  sessionKey: string,
  prompt: string
): Promise<AgentTestResponse> {
  const client = getOpenClawClient();
  await client.connect();

  // Get baseline assistant message count
  let baseline = 0;
  try {
    const history = await client.getChatHistory(sessionKey);
    baseline = history.filter((m) => m.role === "assistant").length;
  } catch {
    // New session
  }

  // Send the prompt
  await client.sendMessage(sessionKey, prompt);

  // Poll for response
  const startTime = Date.now();
  let retried = false;

  while (Date.now() - startTime < AGENT_POLL_TIMEOUT_MS) {
    await sleep(AGENT_POLL_INTERVAL_MS);

    try {
      const history = await client.getChatHistory(sessionKey);
      const assistantMsgs = history.filter((m) => m.role === "assistant");

      if (assistantMsgs.length > baseline) {
        const latest = assistantMsgs[assistantMsgs.length - 1];
        const content = extractTextContent(latest.content);

        const parsed = parseAgentTestResponse(content);
        if (parsed) return parsed;

        // Retry once with a JSON nudge
        if (!retried) {
          retried = true;
          baseline = assistantMsgs.length;
          await client.sendMessage(
            sessionKey,
            'Your previous response was not valid JSON. Please respond ONLY with a JSON object: { "passed": true/false, "summary": "...", "issues": ["..."] }'
          );
          continue;
        }

        // Second failure — heuristic text analysis
        return parseAgentTextFallback(content);
      }
    } catch (err) {
      console.error(`[Test] Poll error:`, err);
    }
  }

  // Timeout
  return { passed: false, summary: "Agent did not respond within 3 minutes" };
}

function parseAgentTestResponse(text: string): AgentTestResponse | null {
  const parsed = extractJSON(text) as Record<string, unknown> | null;
  if (parsed && typeof parsed.passed === "boolean") {
    return {
      passed: parsed.passed,
      summary: typeof parsed.summary === "string" ? parsed.summary : String(parsed.summary ?? ""),
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : undefined,
    };
  }
  return null;
}

function parseAgentTextFallback(text: string): AgentTestResponse {
  const lower = text.toLowerCase();
  const hasPass = /\bpass(ed|ing|es)?\b/.test(lower) || /\ball\s+(tests?\s+)?pass/.test(lower);
  const hasFail = /\bfail(ed|ing|ure|s)?\b/.test(lower) || /\berror(s)?\b/.test(lower) || /\bbug(s)?\b/.test(lower);

  // If both present, bias toward fail; if neither, assume fail (conservative)
  const passed = hasPass && !hasFail;

  return {
    passed,
    summary: text.slice(0, 500),
  };
}

// --- POST handler ---

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const task = getTask(taskId);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const allDeliverables = listDeliverables(taskId);
    const deliverables = allDeliverables.filter(
      (d) => d.deliverable_type === "file" || d.deliverable_type === "url"
    );

    if (deliverables.length === 0) {
      return NextResponse.json({ error: "No testable deliverables found" }, { status: 400 });
    }

    const phases: { name: string; passed: boolean; details: string }[] = [];

    // --- Phase 1: Lightweight checks ---
    const lightweightResults: TestResult[] = [];
    for (const deliverable of deliverables) {
      lightweightResults.push(await testDeliverableLightweight(deliverable));
    }
    const lightweightPassed = lightweightResults.every((r) => r.passed);
    const lightweightIssues = lightweightResults
      .filter((r) => !r.passed)
      .map((r) => {
        const errors: string[] = [];
        if (r.consoleErrors.length > 0) errors.push(`${r.consoleErrors.length} errors`);
        if (r.cssErrors.length > 0) errors.push(`${r.cssErrors.length} CSS errors`);
        return `${r.deliverable.title}: ${errors.join(", ")}`;
      });

    phases.push({
      name: "lightweight_checks",
      passed: lightweightPassed,
      details: lightweightPassed
        ? `All ${lightweightResults.length} deliverable(s) passed basic checks`
        : `Issues: ${lightweightIssues.join("; ")}`,
    });

    // --- Phase 2: Build & lint ---
    const buildLint = await runBuildAndLint();
    phases.push({
      name: "build_and_lint",
      passed: buildLint.passed,
      details: buildLint.passed
        ? "Build and lint passed"
        : `Build/lint failed. Lint: ${buildLint.lintOutput.slice(0, 300)}. Build: ${buildLint.buildOutput.slice(0, 300)}`,
    });

    // --- Phase 3 & 4: Agent delegation (code review + browser testing) ---
    const sessionKey = task.tester_session_key || task.openclaw_session_key;
    let agentCodeReview: AgentTestResponse | null = null;
    let agentBrowserTest: AgentTestResponse | null = null;

    if (sessionKey) {
      // Phase 3: Code review
      const buildLintContext = buildLint.passed
        ? ""
        : `\n\n**Build/lint errors to address:**\nLint: ${buildLint.lintOutput.slice(0, 500)}\nBuild: ${buildLint.buildOutput.slice(0, 500)}`;

      const codeReviewPrompt = `You are reviewing code changes for a task. Please review the code for bugs, logic errors, security issues, and best practice violations.

**Task:** ${task.title}
**Description:** ${task.description}

**Deliverables:**
${deliverables.map((d) => `- [${d.deliverable_type}] ${d.title}: ${d.path || "no path"}`).join("\n")}
${buildLintContext}

Review the code changes and respond with ONLY a JSON object:
{
  "passed": true/false,
  "summary": "brief summary of findings",
  "issues": ["issue 1", "issue 2"]
}

Set "passed" to true if the code is acceptable (minor style issues are OK). Set to false if there are bugs, logic errors, or significant problems.`;

      agentCodeReview = await askAgentToTest(sessionKey, codeReviewPrompt);
      phases.push({
        name: "code_review",
        passed: agentCodeReview.passed,
        details: agentCodeReview.summary,
      });

      // Phase 4: Browser testing
      const browserTestPrompt = `Do you have access to a browser or browser testing tool? If so, please test these deliverables:

${deliverables.map((d) => `- [${d.deliverable_type}] ${d.title}: ${d.path || "no path"}`).join("\n")}

If you have browser access, open each deliverable and verify it renders correctly, has no console errors, and functions as expected.
If you do NOT have browser access, describe what testing you can perform instead (e.g., reading the HTML/CSS, checking file structure).

Respond with ONLY a JSON object:
{
  "passed": true/false,
  "summary": "what you tested and results",
  "issues": ["issue 1", "issue 2"]
}`;

      agentBrowserTest = await askAgentToTest(sessionKey, browserTestPrompt);
      phases.push({
        name: "browser_testing",
        passed: agentBrowserTest.passed,
        details: agentBrowserTest.summary,
      });
    } else {
      // No session key — skip agent phases
      phases.push({
        name: "code_review",
        passed: true,
        details: "Skipped — no agent session available",
      });
      phases.push({
        name: "browser_testing",
        passed: true,
        details: "Skipped — no agent session available",
      });
    }

    // --- Aggregate results ---
    const passed = phases.every((p) => p.passed);
    const failedPhases = phases.filter((p) => !p.passed);
    const summary = passed
      ? `All ${phases.length} test phases passed.`
      : `${failedPhases.length}/${phases.length} phase(s) failed: ${failedPhases.map((p) => p.name).join(", ")}`;

    // Log test activity
    logActivity({
      id: uuidv4(),
      type: passed ? "test_passed" : "test_failed",
      task_id: taskId,
      agent_id: task.assigned_agent_id ?? undefined,
      message: passed
        ? `Automated test passed — ${phases.length} phases verified`
        : `Automated test failed — ${summary}`,
      metadata: { phases },
    });

    // Update task status
    let newStatus: string | undefined;
    if (passed) {
      transitionTaskStatus(taskId, "review", {
        actor: "system",
        reason: "automated_tests_passed",
        agentId: task.assigned_agent_id ?? undefined,
      });
      newStatus = "review";
      addComment({
        id: uuidv4(),
        task_id: taskId,
        author_type: "system",
        content: `Automated tests passed. Task moved to review.`,
      });
    } else {
      transitionTaskStatus(taskId, "assigned", {
        actor: "system",
        reason: "automated_tests_failed",
        agentId: task.assigned_agent_id ?? undefined,
        bypassGuards: true,
      });
      newStatus = "assigned";
      addComment({
        id: uuidv4(),
        task_id: taskId,
        author_type: "system",
        content: `Automated tests failed. ${summary}\nTask sent back to agent for fixes.`,
      });
    }

    return NextResponse.json({
      taskId,
      taskTitle: task.title,
      passed,
      phases,
      lightweightResults,
      summary,
      testedAt: new Date().toISOString(),
      newStatus,
    });
  } catch (error) {
    console.error("Test execution error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  const task = getTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const allDeliverables = listDeliverables(taskId);
  const deliverables = allDeliverables.filter(
    (d) => d.deliverable_type === "file" || d.deliverable_type === "url"
  );

  return NextResponse.json({
    taskId,
    taskTitle: task.title,
    taskStatus: task.status,
    deliverableCount: deliverables.length,
    testableItems: deliverables.map((d) => ({ id: d.id, title: d.title, path: d.path, type: d.deliverable_type })),
    workflow: {
      phases: ["lightweight_checks", "build_and_lint", "code_review", "browser_testing"],
      expectedStatus: "testing",
      onPass: "Moves to review for human approval",
      onFail: "Moves to assigned for agent to fix issues",
    },
  });
}
