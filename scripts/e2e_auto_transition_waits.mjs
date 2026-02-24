#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const BASE_URL = process.env.MC_BASE_URL || "http://127.0.0.1:3080";
const AGENT_ID = process.env.MC_E2E_AGENT_ID || "researcher";
const OUT_DIR = process.env.MC_E2E_OUT_DIR || "/home/csmashe/.openclaw/workspace/memory/e2e_auto_transition";

// Many MC deployments protect API routes. Prefer explicit token so these scripts can run headlessly.
const TOKEN = process.env.MC_TOKEN || process.env.OPENCLAW_API_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN;

const STATUSES = ["inbox", "planning", "assigned", "in_progress", "testing", "review", "done"];
const STATUS_HEADINGS = ["INBOX", "PLANNING", "ASSIGNED", "IN PROGRESS", "TESTING", "REVIEW", "DONE"];

function argFlag(name) {
  return process.argv.includes(name);
}
function argValue(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function nowIso() {
  return new Date().toISOString();
}

async function apiFetch(url, opts = {}) {
  const headers = { "content-type": "application/json", ...(opts.headers || {}) };
  // Support both token header styles used across MC routes.
  if (TOKEN && !headers.authorization && !headers["x-openclaw-token"]) {
    headers.authorization = `Bearer ${TOKEN}`;
    headers["x-openclaw-token"] = TOKEN;
  }

  const res = await fetch(url, { ...opts, headers });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function createTask() {
  // API shape has changed a few times (sometimes returns {task}, sometimes task directly).
  const created = await apiFetch(`${BASE_URL}/api/tasks`, {
    method: "POST",
    body: JSON.stringify({
      title: `E2E auto-transition waits (${nowIso()})`,
      description: "E2E validation task with timed waits.",
      status: "assigned",
      priority: "high",
      assigned_agent_id: AGENT_ID,
    }),
  });
  const task = created?.task || created;
  if (!task?.id) throw new Error(`createTask: unexpected response: ${JSON.stringify(created).slice(0, 300)}`);

  await apiFetch(`${BASE_URL}/api/tasks/${task.id}/deliverables`, {
    method: "POST",
    body: JSON.stringify({
      title: "Mission Control home (URL deliverable for testing)",
      deliverable_type: "url",
      path: `${BASE_URL}/`,
      description: "Used to exercise Testing -> Review auto-transition via test endpoint.",
    }),
  });

  return task;
}

async function fetchTask(taskId) {
  // Mission Control exposes task listing at /api/tasks; there is no /api/tasks/:id route.
  const data = await apiFetch(`${BASE_URL}/api/tasks`);
  return (data?.tasks || []).find((t) => t?.id === taskId) || null;
}

async function waitForApiStatusAny(taskId, expectedStatuses, timeoutMs, { intervalMs = 1200 } = {}) {
  const expected = new Set(expectedStatuses);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const t = await fetchTask(taskId).catch(() => null);
    const st = t?.status;
    if (st && expected.has(st)) return st;
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return null;
}

async function waitForTransitionLog(taskId, from, to, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const data = await apiFetch(`${BASE_URL}/api/activity`);
    const hit = (data?.activity || []).find((a) => {
      if (a.task_id !== taskId) return false;
      if (a.type !== "task_status_changed") return false;
      let m = a.metadata;
      if (typeof m === "string") {
        try {
          m = JSON.parse(m);
        } catch {
          m = null;
        }
      }
      return m?.from === from && m?.to === to;
    });
    if (hit) return true;
    await new Promise((r) => setTimeout(r, 1200));
  }
  return false;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const ackTimeoutMs = Number(argValue("--ackTimeoutMs", process.env.MC_E2E_ACK_TIMEOUT_MS || "150000"));
  const milestoneTimeoutMs = Number(argValue("--milestoneTimeoutMs", process.env.MC_E2E_MILESTONE_TIMEOUT_MS || "780000"));
  const reviewTimeoutMs = Number(argValue("--reviewTimeoutMs", process.env.MC_E2E_REVIEW_TIMEOUT_MS || "360000"));
  const doneTimeoutMs = Number(argValue("--doneTimeoutMs", process.env.MC_E2E_DONE_TIMEOUT_MS || "90000"));
  const uiTimeoutMs = Number(argValue("--uiTimeoutMs", process.env.MC_E2E_UI_TIMEOUT_MS || "120000"));
  const noDispatch = argFlag("--no-dispatch");

  const evidence = {
    startedAt: nowIso(),
    baseUrl: BASE_URL,
    tokenUsed: Boolean(TOKEN),
    agentId: AGENT_ID,
    timeouts: { ackTimeoutMs, milestoneTimeoutMs, reviewTimeoutMs, doneTimeoutMs, uiTimeoutMs },
    steps: [],
  };

  const task = await createTask();
  evidence.task = { id: task.id, title: task.title };

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium-browser",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.setDefaultTimeout(60_000);

  const snap = async (label) => {
    const p = path.join(OUT_DIR, `${String(evidence.steps.length + 1).padStart(2, "0")}_${label}.png`);
    await page.screenshot({ path: p, fullPage: true });
    evidence.steps.push({ at: nowIso(), label, screenshot: p });
  };

  const taskHeading = () => page.locator("h4", { hasText: task.title }).first();
  const taskCard = () => taskHeading().locator('xpath=ancestor::div[contains(@class,"group min-w-0 bg-card")][1]');

  async function getUiColumnForCard() {
    const heading = taskHeading();
    if (!(await heading.count())) return null;
    return heading.evaluate((node) => {
      const norm = (t) => String(t || "").replace(/\s+/g, " ").trim().toUpperCase();
      let el = node;
      for (let i = 0; i < 20 && el; i++) {
        const h3 = el.querySelector("h3");
        if (h3) {
          const txt = norm(h3.textContent);
          if (["INBOX", "PLANNING", "ASSIGNED", "IN PROGRESS", "TESTING", "REVIEW", "DONE"].includes(txt)) return txt;
        }
        el = el.parentElement;
      }
      return null;
    });
  }

  async function waitForUiColumnAny(expectedHeadings, timeoutMs) {
    const expected = new Set(expectedHeadings.map((s) => s.toUpperCase()));
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const col = await getUiColumnForCard();
      if (col && expected.has(col.toUpperCase())) return col;
      await page.waitForTimeout(1000);
      await page.reload({ waitUntil: "load" });
    }
    return null;
  }

  try {
    await page.goto(BASE_URL, { waitUntil: "load" });
    for (const col of STATUS_HEADINGS) {
      await page.getByRole("heading", { name: col, exact: true }).waitFor({ timeout: 30_000 });
    }
    await snap("board_loaded");

    const preDispatchVisible = await taskHeading().count().then((c) => c > 0).catch(() => false);
    evidence.steps.push({ at: nowIso(), label: `pre_dispatch_visible:${preDispatchVisible}` });
    await snap("task_pre_dispatch");

    if (noDispatch) {
      evidence.steps.push({ at: nowIso(), label: "no_dispatch_mode" });
      await snap("created_no_dispatch");
    } else {
      const dispatchRes = await apiFetch(`${BASE_URL}/api/tasks/dispatch`, {
        method: "POST",
        body: JSON.stringify({ taskId: task.id, agentId: AGENT_ID }),
      });
      evidence.steps.push({ at: nowIso(), label: "dispatch_api_response", dispatchRes });
      await snap("dispatched_waiting_for_ack");

      const ackMilestone = await waitForApiStatusAny(task.id, ["in_progress", "testing", "review", "done"], ackTimeoutMs);
      if (!ackMilestone) throw new Error(`API: task did not progress past assigned within ${ackTimeoutMs}ms (ack window)`);

      const sawAssignedToInProgress = await waitForTransitionLog(task.id, "assigned", "in_progress", Math.min(ackTimeoutMs, 120_000));
      if (!sawAssignedToInProgress) throw new Error("Activity: missing assigned -> in_progress transition evidence");

      if (ackMilestone === "in_progress") {
        const inProgressUi = await waitForUiColumnAny(["IN PROGRESS"], Math.min(uiTimeoutMs, 90_000));
        if (!inProgressUi) throw new Error("UI: task did not appear in IN PROGRESS after API ack");
        await snap("task_in_in_progress");
      } else {
        evidence.steps.push({ at: nowIso(), label: `ack_milestone_fast_forward:${ackMilestone}` });
      }

      // Progression milestone: testing can be very brief or skipped in some configurations.
      const completionMilestone = await waitForApiStatusAny(task.id, ["testing", "review", "done"], milestoneTimeoutMs);
      if (!completionMilestone) throw new Error(`API: task did not progress beyond in_progress within ${milestoneTimeoutMs}ms`);
      evidence.steps.push({ at: nowIso(), label: `completion_milestone:${completionMilestone}` });

      // Evidence: prefer to see in_progress->testing, but don't fail if the system transitions too quickly.
      if (completionMilestone === "testing") {
        const sawInProgressToTesting = await waitForTransitionLog(task.id, "in_progress", "testing", 180_000);
        if (!sawInProgressToTesting) throw new Error("Activity: missing in_progress -> testing transition evidence");
      }

      const reviewOrDone = await waitForApiStatusAny(task.id, ["review", "done"], reviewTimeoutMs);
      if (!reviewOrDone) throw new Error(`API: task did not reach review/done after milestone within ${reviewTimeoutMs}ms`);

      if (reviewOrDone === "review") {
        const reviewUi = await waitForUiColumnAny(["REVIEW"], uiTimeoutMs);
        if (!reviewUi) throw new Error("UI: task did not appear under REVIEW");
        await snap("task_in_review");

        await taskCard().click();
        await page.waitForTimeout(300);
        await snap("task_detail_open_review");

        const approveBtn = page.getByRole("button", { name: /approve.*done|done/i }).first();
        if (!(await approveBtn.count())) throw new Error("Approve & Done button not found");
        await approveBtn.click();
        await page.waitForTimeout(800);
        await snap("approved_done_clicked");

        const doneApi = await waitForApiStatusAny(task.id, ["done"], doneTimeoutMs);
        if (!doneApi) throw new Error(`API: task did not reach done within ${doneTimeoutMs}ms after approval`);
      }

      const doneUi = await waitForUiColumnAny(["DONE"], uiTimeoutMs);
      if (!doneUi) throw new Error("UI: task did not appear under DONE");
      await snap("task_in_done");
    }

    const outJson = path.join(OUT_DIR, `evidence_${task.id}.json`);
    fs.writeFileSync(outJson, JSON.stringify({ ...evidence, finishedAt: nowIso() }, null, 2));
    console.log(JSON.stringify({ ok: true, taskId: task.id, outDir: OUT_DIR, evidenceJson: outJson }, null, 2));
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(String(err?.stack || err?.message || err));
  process.exit(1);
});
