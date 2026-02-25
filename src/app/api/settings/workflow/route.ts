import { NextRequest, NextResponse } from "next/server";
import { getWorkflowSettings, setWorkflowSetting, type WorkflowSettings } from "@/lib/db";

const VALID_KEYS: (keyof WorkflowSettings)[] = [
  "orchestrator_agent_id",
  "planner_agent_id",
  "tester_agent_id",
  "max_rework_cycles",
];

// GET /api/settings/workflow — returns current workflow settings
export async function GET() {
  try {
    const settings = getWorkflowSettings();
    return NextResponse.json(settings);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to load workflow settings", details: String(err) },
      { status: 500 }
    );
  }
}

// PUT /api/settings/workflow — update workflow settings (partial)
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate all keys before writing anything
    const updates: [keyof WorkflowSettings, string][] = [];

    for (const [key, value] of Object.entries(body)) {
      if (!VALID_KEYS.includes(key as keyof WorkflowSettings)) {
        return NextResponse.json(
          { error: `Invalid setting key: ${key}` },
          { status: 400 }
        );
      }

      const validKey = key as keyof WorkflowSettings;

      if (validKey === "max_rework_cycles") {
        const num = Number(value);
        if (!Number.isInteger(num) || num < 0 || num > 10) {
          return NextResponse.json(
            { error: "max_rework_cycles must be an integer between 0 and 10" },
            { status: 400 }
          );
        }
        updates.push([validKey, String(num)]);
      } else {
        // Agent ID fields: string or null/empty to clear
        const strVal = value ? String(value) : "";
        updates.push([validKey, strVal]);
      }
    }

    // All validated — apply writes
    for (const [key, val] of updates) {
      setWorkflowSetting(key, val);
    }

    const settings = getWorkflowSettings();
    return NextResponse.json(settings);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to update workflow settings", details: String(err) },
      { status: 500 }
    );
  }
}
