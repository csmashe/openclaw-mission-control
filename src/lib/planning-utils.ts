import { getOpenClawClient } from "./openclaw-client";
import { extractTextContent } from "./completion-gate";

const MAX_EXTRACT_JSON_LENGTH = 1_000_000;

/**
 * Extract JSON from a response that might have markdown code blocks or surrounding text.
 */
export function extractJSON(text: string): object | null {
  if (text.length > MAX_EXTRACT_JSON_LENGTH) {
    return null;
  }

  try {
    return JSON.parse(text.trim());
  } catch {
    // Continue
  }

  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Continue
    }
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      // Continue
    }
  }

  return null;
}

/**
 * Get assistant messages from OpenClaw for a given session.
 */
export async function getMessagesFromOpenClaw(
  sessionKey: string
): Promise<Array<{ role: string; content: string }>> {
  try {
    const client = getOpenClawClient();
    await client.connect();
    const history = await client.getChatHistory(sessionKey);

    const messages: Array<{ role: string; content: string }> = [];
    for (const msg of history) {
      if (msg.role === "assistant") {
        const content = extractTextContent(msg.content);
        if (content.trim().length > 0) {
          messages.push({ role: "assistant", content });
        }
      }
    }
    return messages;
  } catch (err) {
    console.error("[Planning Utils] Failed to get messages from OpenClaw:", err);
    return [];
  }
}
