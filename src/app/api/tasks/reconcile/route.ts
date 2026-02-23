import { NextResponse } from "next/server";
import { reconcileTaskRuntimeTruth } from "@/lib/task-reconciler";

// POST /api/tasks/reconcile - Deterministically reconcile board state with runtime truth
export async function POST() {
  try {
    const result = await reconcileTaskRuntimeTruth();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: String(error) },
      { status: 500 }
    );
  }
}
