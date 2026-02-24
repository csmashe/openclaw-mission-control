function extractDispatchCompletion(text) {
  const m = text.match(/TASK_COMPLETE(?:\s+dispatch_id=([a-zA-Z0-9-]+))?:/i);
  return { hasCompletionMarker: Boolean(m), dispatchId: m?.[1] ?? null };
}

function evaluateCompletion(task, params) {
  const INSTANT_WINDOW_MS = 15000;
  const dispatchId = task.dispatch_id ?? null;
  const dispatchStartedAt = task.dispatch_started_at ?? null;
  const baseline = task.dispatch_message_count_start ?? 0;

  if (!dispatchId || !dispatchStartedAt) return { accepted: false, completionReason: 'rejected_missing_dispatch_context' };

  const effectivePayloadDispatchId =
    params.payloadDispatchId ?? (params.hasCompletionMarker ? dispatchId : null);

  if (!effectivePayloadDispatchId) return { accepted: false, completionReason: 'rejected_missing_completion_marker' };
  if (effectivePayloadDispatchId !== dispatchId) return { accepted: false, completionReason: 'rejected_stale_dispatch_id' };

  const dispatchMs = Date.parse(dispatchStartedAt);
  const evidenceMs = params.evidenceTimestamp ? Date.parse(params.evidenceTimestamp) : NaN;
  if (Number.isFinite(dispatchMs) && Number.isFinite(evidenceMs) && evidenceMs < dispatchMs) {
    return { accepted: false, completionReason: 'rejected_stale_evidence_timestamp' };
  }

  const newEvidenceCount = Math.max(0, params.assistantMessageCount - baseline);
  const elapsed = Date.parse(params.nowIso ?? new Date().toISOString()) - dispatchMs;
  if (newEvidenceCount <= 0 && Number.isFinite(elapsed) && elapsed < INSTANT_WINDOW_MS) {
    return { accepted: false, completionReason: 'rejected_suspicious_instant_no_new_evidence' };
  }

  return { accepted: true, completionReason: 'accepted' };
}

const task = {
  dispatch_id: 'd-new',
  dispatch_started_at: '2026-02-21T18:00:00.000Z',
  dispatch_message_count_start: 10,
};

const cases = [
  {
    name: 'old stale completion is ignored',
    text: 'TASK_COMPLETE dispatch_id=d-old: done',
    input: { evidenceTimestamp: '2026-02-21T18:00:05.000Z', assistantMessageCount: 11, nowIso: '2026-02-21T18:00:07.000Z' },
    expectAccepted: false,
    expectReason: 'rejected_stale_dispatch_id',
  },
  {
    name: 'real new completion transitions to review',
    text: 'TASK_COMPLETE dispatch_id=d-new: implemented changes and verified output',
    input: { evidenceTimestamp: '2026-02-21T18:01:05.000Z', assistantMessageCount: 11, nowIso: '2026-02-21T18:01:06.000Z' },
    expectAccepted: true,
    expectReason: 'accepted',
  },
  {
    name: 'marker without dispatch id falls back to active dispatch',
    text: 'TASK_COMPLETE: implemented changes, verification: complete, output attached',
    input: { evidenceTimestamp: '2026-02-21T18:01:10.000Z', assistantMessageCount: 12, nowIso: '2026-02-21T18:01:12.000Z' },
    expectAccepted: true,
    expectReason: 'accepted',
  },
];

let fails = 0;
for (const c of cases) {
  const dispatch = extractDispatchCompletion(c.text);
  const r = evaluateCompletion(task, {
    ...c.input,
    payloadDispatchId: dispatch.dispatchId,
    hasCompletionMarker: dispatch.hasCompletionMarker,
  });
  const ok = r.accepted === c.expectAccepted && r.completionReason === c.expectReason;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${c.name}`);
  console.log(`  expected: accepted=${c.expectAccepted} reason=${c.expectReason}`);
  console.log(`  actual:   accepted=${r.accepted} reason=${r.completionReason}`);
}

if (fails) {
  console.error(`\n${fails} case(s) failed.`);
  process.exit(1);
}
console.log('\nAll completion-gate proof cases passed.');
