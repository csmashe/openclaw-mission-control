/**
 * Task Test API
 * Runs automated browser tests on task deliverables.
 * Uses Playwright for HTML/URL testing with JS error detection,
 * CSS validation, and resource loading checks.
 * Falls back to lightweight validation if Playwright is unavailable.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getTask, listDeliverables, addComment, logActivity, type TaskDeliverable } from "@/lib/db";
import { transitionTaskStatus } from "@/lib/task-state";
import { existsSync, readFileSync, mkdirSync } from "fs";
import path from "path";

interface CssValidationError {
  message: string;
}

interface ResourceError {
  type: "image" | "script" | "stylesheet" | "link" | "other";
  url: string;
  error: string;
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
  resourceErrors: ResourceError[];
  screenshotPath: string | null;
  duration: number;
  error?: string;
}

const SCREENSHOTS_DIR = ((process.env.PROJECTS_PATH || "~/projects").replace(/^~/, process.env.HOME || "")) + "/.screenshots";

/**
 * Validate CSS syntax using css-tree
 */
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

/**
 * Test a single deliverable using Playwright
 */
async function testDeliverableWithBrowser(
  browser: Awaited<ReturnType<typeof import("playwright").chromium.launch>>,
  deliverable: TaskDeliverable,
  taskId: string
): Promise<TestResult> {
  const startTime = Date.now();
  const consoleErrors: string[] = [];
  const resourceErrors: ResourceError[] = [];
  let cssErrors: CssValidationError[] = [];
  let httpStatus: number | null = null;
  let screenshotPath: string | null = null;

  const isUrlDeliverable = deliverable.deliverable_type === "url";
  const testPath = deliverable.path || "";

  try {
    if (!isUrlDeliverable) {
      if (!testPath || !existsSync(testPath)) {
        return {
          passed: false,
          deliverable: { id: deliverable.id, title: deliverable.title, path: testPath || "unknown", type: "file" },
          httpStatus: null, consoleErrors: [`File does not exist: ${testPath}`],
          cssErrors: [], resourceErrors: [], screenshotPath: null,
          duration: Date.now() - startTime, error: "File not found",
        };
      }

      if (!testPath.endsWith(".html") && !testPath.endsWith(".htm")) {
        return {
          passed: true,
          deliverable: { id: deliverable.id, title: deliverable.title, path: testPath, type: "file" },
          httpStatus: null, consoleErrors: [], cssErrors: [], resourceErrors: [],
          screenshotPath: null, duration: Date.now() - startTime,
        };
      }

      const htmlContent = readFileSync(testPath, "utf-8");
      cssErrors = extractAndValidateCss(htmlContent);
    }

    let testUrl: string;
    if (isUrlDeliverable) {
      if (isHttpUrl(testPath)) {
        testUrl = testPath;
      } else {
        if (!existsSync(testPath)) {
          return {
            passed: false,
            deliverable: { id: deliverable.id, title: deliverable.title, path: testPath, type: "url" },
            httpStatus: null, consoleErrors: [`URL path does not exist: ${testPath}`],
            cssErrors: [], resourceErrors: [], screenshotPath: null,
            duration: Date.now() - startTime, error: "Path not found",
          };
        }
        testUrl = `file://${testPath}`;
      }
    } else {
      testUrl = `file://${testPath}`;
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(`Page error: ${error.message}`);
    });
    page.on("requestfailed", (request) => {
      const url = request.url();
      const failure = request.failure();
      const resourceType = request.resourceType();
      let type: ResourceError["type"] = "other";
      if (resourceType === "image") type = "image";
      else if (resourceType === "script") type = "script";
      else if (resourceType === "stylesheet") type = "stylesheet";
      else if (resourceType === "document") type = "link";
      resourceErrors.push({ type, url, error: failure?.errorText || "Request failed" });
    });

    const response = await page.goto(testUrl, { waitUntil: "networkidle", timeout: 30000 });
    httpStatus = response?.status() || null;

    if (isHttpUrl(testUrl) && httpStatus && (httpStatus < 200 || httpStatus >= 400)) {
      consoleErrors.push(`HTTP error: Server returned status ${httpStatus}`);
    }

    await page.waitForTimeout(1000);

    if (!existsSync(SCREENSHOTS_DIR)) {
      mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    }
    const screenshotFilename = `${taskId}-${deliverable.id}-${Date.now()}.png`;
    screenshotPath = path.join(SCREENSHOTS_DIR, screenshotFilename);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    await context.close();

    const passed = consoleErrors.length === 0 && cssErrors.length === 0 && resourceErrors.length === 0;

    return {
      passed,
      deliverable: { id: deliverable.id, title: deliverable.title, path: testPath, type: isUrlDeliverable ? "url" : "file" },
      httpStatus, consoleErrors, cssErrors, resourceErrors, screenshotPath,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      passed: false,
      deliverable: { id: deliverable.id, title: deliverable.title, path: testPath || "unknown", type: isUrlDeliverable ? "url" : "file" },
      httpStatus, consoleErrors: [...consoleErrors, `Test error: ${error}`],
      cssErrors, resourceErrors, screenshotPath,
      duration: Date.now() - startTime, error: String(error),
    };
  }
}

/**
 * Lightweight fallback test when Playwright is unavailable.
 * Checks file existence, HTTP status (for URLs), and CSS syntax.
 */
async function testDeliverableLightweight(deliverable: TaskDeliverable): Promise<TestResult> {
  const startTime = Date.now();
  const testPath = deliverable.path || "";
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
    if (!testPath || !existsSync(testPath)) {
      return {
        passed: false,
        deliverable: { id: deliverable.id, title: deliverable.title, path: testPath || "unknown", type: isUrlDeliverable ? "url" : "file" },
        httpStatus: null, consoleErrors: [`File does not exist: ${testPath}`],
        cssErrors: [], resourceErrors: [], screenshotPath: null,
        duration: Date.now() - startTime, error: "File not found",
      };
    }

    if (testPath.endsWith(".html") || testPath.endsWith(".htm")) {
      const htmlContent = readFileSync(testPath, "utf-8");
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
    httpStatus, consoleErrors, cssErrors, resourceErrors: [], screenshotPath: null,
    duration: Date.now() - startTime,
  };
}

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

    const results: TestResult[] = [];

    // Try Playwright first, fall back to lightweight
    let usedPlaywright = false;
    try {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true });
      usedPlaywright = true;

      for (const deliverable of deliverables) {
        results.push(await testDeliverableWithBrowser(browser, deliverable, taskId));
      }

      await browser.close();
    } catch {
      // Playwright unavailable - use lightweight tests
      for (const deliverable of deliverables) {
        results.push(await testDeliverableLightweight(deliverable));
      }
    }

    const passed = results.every((r) => r.passed);
    const failedCount = results.filter((r) => !r.passed).length;

    let summary: string;
    if (passed) {
      summary = `All ${results.length} deliverable(s) passed automated testing.`;
    } else {
      const issues: string[] = [];
      for (const r of results.filter((r) => !r.passed)) {
        const errorTypes: string[] = [];
        if (r.consoleErrors.length > 0) errorTypes.push(`${r.consoleErrors.length} errors`);
        if (r.cssErrors.length > 0) errorTypes.push(`${r.cssErrors.length} CSS errors`);
        if (r.resourceErrors.length > 0) errorTypes.push(`${r.resourceErrors.length} broken resources`);
        issues.push(`${r.deliverable.title}: ${errorTypes.join(", ")}`);
      }
      summary = `${failedCount}/${results.length} deliverable(s) failed. Issues: ${issues.join("; ")}`;
    }

    // Log test activity
    logActivity({
      id: uuidv4(),
      type: passed ? "test_passed" : "test_failed",
      task_id: taskId,
      agent_id: task.assigned_agent_id ?? undefined,
      message: passed
        ? `Automated test passed - ${results.length} deliverable(s) verified`
        : `Automated test failed - ${summary}`,
      metadata: {
        usedPlaywright,
        results: results.map((r) => ({
          deliverable: r.deliverable.title,
          type: r.deliverable.type,
          passed: r.passed,
          consoleErrors: r.consoleErrors.length,
          cssErrors: r.cssErrors.length,
          resourceErrors: r.resourceErrors.length,
        })),
      },
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
      results,
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
      expectedStatus: "testing",
      onPass: "Moves to review for human approval",
      onFail: "Moves to assigned for agent to fix issues",
    },
  });
}
