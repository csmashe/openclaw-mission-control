import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getOpenClawClient } from "@/lib/openclaw-client";
import { listTasks, updateTask, addComment, logActivity, listComments } from "@/lib/db";

/**
 * Extract text content from chat message content.
 * The gateway may return content as a string OR as an array of content blocks
 * (e.g. [{type: "text", text: "..."}, ...] from Anthropic API format).
 */
function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: Record<string, unknown>) => block.type === "text" && block.text)
      .map((block: Record<string, unknown>) => block.text as string)
      .join("\n");
  }
  if (content && typeof content === "object") {
    return JSON.stringify(content);
  }
  return "";
}

/**
 * GET /api/tasks/check-completion
 * 
 * Checks all in_progress tasks with assigned agents for completion.
 * Polls chat history and if a new assistant message is found, moves the task to review.
 * 
 * This is called by the frontend on every polling cycle (~5s) to reliably
 * detect agent completion.
 */
export async function GET() {
  const inProgressTasks = listTasks({ status: "in_progress" });
  const tasksToCheck = inProgressTasks.filter(
    (t) => t.assigned_agent_id && t.openclaw_session_key
  );

  if (tasksToCheck.length === 0) {
    return NextResponse.json({ checked: 0, completed: [] });
  }

  const completed: string[] = [];

  try {
    const client = getOpenClawClient();
    await client.connect();

    for (const task of tasksToCheck) {
      try {
        const history = await client.getChatHistory(task.openclaw_session_key!);
        const assistantMsgs = history.filter((m) => m.role === "assistant");

        // If there are assistant messages, the agent has responded
        if (assistantMsgs.length > 0) {
          const latestResponse = assistantMsgs[assistantMsgs.length - 1];
          // Content may be a string or an array of content blocks
          const responseText = extractTextContent(latestResponse.content);

          if (responseText) {
            // Add agent response as comment (check if we already added it)
            const existingComments = listComments(task.id);
            const alreadyHasAgentComment = existingComments.some(
              (c) => c.author_type === "agent"
            );

            if (!alreadyHasAgentComment) {
              addComment({
                id: uuidv4(),
                task_id: task.id,
                agent_id: task.assigned_agent_id!,
                author_type: "agent",
                content: responseText,
              });
            }
          }

          // Move to review
          updateTask(task.id, { status: "review" });

          const createdAt = new Date(task.updated_at).getTime();
          const duration = Math.round((Date.now() - createdAt) / 1000);

          addComment({
            id: uuidv4(),
            task_id: task.id,
            author_type: "system",
            content: `✅ Agent completed in ~${duration}s. Task moved to review.`,
          });

          logActivity({
            id: uuidv4(),
            type: "task_review",
            task_id: task.id,
            agent_id: task.assigned_agent_id ?? undefined,
            message: `Agent "${task.assigned_agent_id}" completed "${task.title}" — moved to review`,
            metadata: { duration },
          });

          completed.push(task.id);
          console.log(
            `[check-completion] Task "${task.title}" moved to REVIEW (agent completed)`
          );
        }
      } catch (err) {
        console.error(
          `[check-completion] Error checking task "${task.title}":`,
          String(err)
        );
      }
    }
  } catch (err) {
    console.error("[check-completion] Client error:", String(err));
  }

  return NextResponse.json({
    checked: tasksToCheck.length,
    completed,
  });
}
