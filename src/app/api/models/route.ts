import { NextResponse } from "next/server";
import { getOpenClawClient } from "@/lib/openclaw-client";

interface GatewayModel {
  id: string;
  name?: string;
  provider?: string;
  description?: string;
  canStream?: boolean;
  supportedFeatures?: string[];
}

/**
 * GET /api/models
 *
 * Fetches available models from the OpenClaw gateway and returns them
 * grouped by provider. This powers the model/provider selector in Settings.
 */
export async function GET() {
  try {
    const client = getOpenClawClient();
    await client.connect();

    const result = (await client.listModels()) as {
      models?: GatewayModel[];
      defaultModel?: string;
      defaultProvider?: string;
    };

    const models = result?.models ?? [];

    // Group models by provider
    const byProvider: Record<string, GatewayModel[]> = {};
    for (const model of models) {
      const provider = model.provider || "unknown";
      if (!byProvider[provider]) byProvider[provider] = [];
      byProvider[provider].push(model);
    }

    // Sort providers: prioritize well-known ones
    const providerOrder = [
      "anthropic",
      "google-antigravity",
      "google",
      "openai",
      "openai-codex",
    ];
    const sortedProviders = Object.keys(byProvider).sort((a, b) => {
      const ai = providerOrder.indexOf(a);
      const bi = providerOrder.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a.localeCompare(b);
    });

    return NextResponse.json({
      models,
      byProvider,
      providers: sortedProviders,
      defaultModel: result?.defaultModel,
      defaultProvider: result?.defaultProvider,
    });
  } catch (err) {
    console.error("[models] Error:", String(err));
    return NextResponse.json(
      { error: "Failed to fetch models", details: String(err) },
      { status: 500 }
    );
  }
}
