#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const BASE_URL = process.env.MC_BASE_URL || "http://127.0.0.1:3080";
const OUT_DIR = process.env.MC_E2E_OUT_DIR || "/home/csmashe/.openclaw/workspace/memory/e2e_board_semantics";

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}: ${text}`);
  return json;
}

function nowIso() {
  return new Date().toISOString();
}

async function createTask(titleSuffix, status = "inbox") {
  const { task } = await apiFetch(`${BASE_URL}/api/tasks`, {
    method: "POST",
    body: JSON.stringify({
      title: `E2E semantics ${titleSuffix} (${nowIso()})`,
      description: "Browser semantics validation",
      status,
      priority: "medium",
    }),
  });
  return task;
}

async function fetchTaskById(taskId) {
  const data = await apiFetch(`${BASE_URL}/api/tasks`);
  return (data?.tasks || []).find((t) => t?.id === taskId) || null;
}

async function waitForTaskStatus(taskId, expectedStatus, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = await fetchTaskById(taskId);
    if (task?.status === expectedStatus) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const evidence = { startedAt: nowIso(), baseUrl: BASE_URL, checks: [] };

  const activityTask = await createTask("activity");
  await apiFetch(`${BASE_URL}/api/tasks/comments`, {
    method: "POST",
    body: JSON.stringify({
      taskId: activityTask.id,
      content: "E2E seeded activity comment",
    }),
  });
  const deleteTask = await createTask("delete");
  const dragAssignedTask = await createTask("drag-assigned", "assigned");
  const reviewDoneTask = await createTask("review-done", "review");
  const blockedTransitionTask = await createTask("blocked-transition", "in_progress");

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium-browser",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(60_000);

  const snap = async (name) => {
    const p = path.join(OUT_DIR, `${String(evidence.checks.length + 1).padStart(2, "0")}_${name}.png`);
    await page.screenshot({ path: p, fullPage: true });
    evidence.checks.push({ at: nowIso(), snap: p, name });
  };

  try {
    await page.goto(BASE_URL, { waitUntil: "load" });

    for (const col of ["INBOX", "PLANNING", "ASSIGNED", "IN PROGRESS", "TESTING", "REVIEW", "DONE"]) {
      await page.getByRole("heading", { name: col, exact: true }).waitFor({ timeout: 30_000 });
    }
    await snap("board_columns_visible");

    // Task detail activity loads.
    await page.locator(`text=${activityTask.title}`).first().click();
    await page.locator("text=E2E seeded activity comment").first().waitFor({ timeout: 30_000 });
    await snap("task_detail_activity_loaded");
    await page.getByRole("button", { name: "Close" }).first().click();

    // Delete confirmation appears and cancel keeps card.
    const deleteTitle = page.locator("h4", { hasText: deleteTask.title }).first();
    const deleteCard = deleteTitle.locator('xpath=ancestor::div[contains(@class,"group min-w-0 bg-card")][1]');
    await deleteCard.locator('button[aria-label="Delete task"]').click();
    await page.getByRole("heading", { name: "Delete task?" }).waitFor({ timeout: 10_000 });
    await snap("delete_confirm_dialog");
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.locator(`text=${deleteTask.title}`).first().waitFor({ timeout: 10_000 });

    // Confirm delete removes card for real.
    await deleteCard.locator('button[aria-label="Delete task"]').click();
    await page.locator('[role="dialog"]').getByRole("button", { name: "Delete task", exact: true }).click();
    await page.locator("h4", { hasText: deleteTask.title }).first().waitFor({ state: "detached", timeout: 20_000 });
    await snap("delete_confirmed_removed");

    // Drag/drop: assigned -> in_progress
    const assignedHeading = page.locator("h4", { hasText: dragAssignedTask.title }).first();
    const assignedCard = assignedHeading.locator('xpath=ancestor::div[contains(@class,"group min-w-0 bg-card")][1]');
    const inProgressDropZone = page
      .getByRole("heading", { name: "IN PROGRESS", exact: true })
      .locator('xpath=ancestor::div[contains(@class,"basis-[20rem]")][1]//div[contains(@class,"p-3") and contains(@class,"flex") and contains(@class,"gap-3")]')
      .first();
    await assignedCard.dragTo(inProgressDropZone);
    const movedToInProgress = await waitForTaskStatus(dragAssignedTask.id, "in_progress", 30_000);
    if (!movedToInProgress) throw new Error("Drag/drop failed: assigned task did not move to in_progress");
    await page.reload({ waitUntil: "load" });
    await snap("drag_assigned_to_in_progress");

    // Review -> done via card button.
    const reviewHeading = page.locator("h4", { hasText: reviewDoneTask.title }).first();
    const reviewCard = reviewHeading.locator('xpath=ancestor::div[contains(@class,"group min-w-0 bg-card")][1]');
    await reviewCard.getByRole("button", { name: /done/i }).first().click();
    const movedToDone = await waitForTaskStatus(reviewDoneTask.id, "done", 30_000);
    if (!movedToDone) throw new Error("Review->Done failed: task did not reach done");
    await page.reload({ waitUntil: "load" });
    await snap("review_to_done_button");

    // Blocked transition check: in_progress -> planning should remain blocked.
    const blockedHeading = page.locator("h4", { hasText: blockedTransitionTask.title }).first();
    const blockedCard = blockedHeading.locator('xpath=ancestor::div[contains(@class,"group min-w-0 bg-card")][1]');
    const planningDropZone = page
      .getByRole("heading", { name: "PLANNING", exact: true })
      .locator('xpath=ancestor::div[contains(@class,"basis-[20rem]")][1]//div[contains(@class,"p-3") and contains(@class,"flex") and contains(@class,"gap-3")]')
      .first();
    await blockedCard.dragTo(planningDropZone);
    await new Promise((r) => setTimeout(r, 2000));
    const stillInProgress = await waitForTaskStatus(blockedTransitionTask.id, "in_progress", 10_000);
    if (!stillInProgress) throw new Error("Blocked transition regression: in_progress task moved to planning");
    await page.reload({ waitUntil: "load" });
    await snap("blocked_transition_held");

    // Terminal timestamp + non-blank feed.
    await page.locator('button:has(svg.lucide-terminal)').first().click();
    await page.locator("text=LIVE TERMINAL").waitFor({ timeout: 10_000 });
    const timeRe = /\[[0-9]{2}:[0-9]{2}:[0-9]{2}\]/;
    await page.locator("span").filter({ hasText: timeRe }).first().waitFor({ timeout: 20_000 });
    await snap("terminal_timestamp_visible");

    // No blank-board regression check (columns still present after interactions).
    for (const col of ["INBOX", "PLANNING", "ASSIGNED", "IN PROGRESS", "TESTING", "REVIEW", "DONE"]) {
      await page.getByRole("heading", { name: col, exact: true }).waitFor({ timeout: 10_000 });
    }
    await snap("board_not_blank_post_actions");

    const outJson = path.join(OUT_DIR, `evidence_${Date.now()}.json`);
    fs.writeFileSync(
      outJson,
      JSON.stringify(
        {
          ...evidence,
          finishedAt: nowIso(),
          activityTaskId: activityTask.id,
          deleteTaskId: deleteTask.id,
          dragAssignedTaskId: dragAssignedTask.id,
          reviewDoneTaskId: reviewDoneTask.id,
          blockedTransitionTaskId: blockedTransitionTask.id,
        },
        null,
        2
      )
    );
    console.log(
      JSON.stringify(
        {
          ok: true,
          outDir: OUT_DIR,
          evidenceJson: outJson,
          activityTaskId: activityTask.id,
          deleteTaskId: deleteTask.id,
          dragAssignedTaskId: dragAssignedTask.id,
          reviewDoneTaskId: reviewDoneTask.id,
          blockedTransitionTaskId: blockedTransitionTask.id,
        },
        null,
        2
      )
    );
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(String(err?.stack || err?.message || err));
  process.exit(1);
});
