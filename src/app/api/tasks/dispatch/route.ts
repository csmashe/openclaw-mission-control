import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getOpenClawClient } from "@/lib/openclaw-client";
import {
  getTask,
  updateTask,
  addComment,
  logActivity,
} from "@/lib/db";

// POST /api/tasks/dispatch - Send a task to an agent for processing
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, agentId } = body;

    if (!taskId || !agentId) {
      return NextResponse.json(
        { error: "taskId and agentId are required" },
        { status: 400 }
      );
    }

    const task = getTask(taskId);
    if (!task) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 }
      );
    }

    // Generate a unique session key for this task
    const sessionKey = `mission-control:${agentId}:task-${taskId.slice(0, 8)}`;

    // Update task to assigned with the session key and agent
    updateTask(taskId, {
      status: "assigned",
      assigned_agent_id: agentId,
      openclaw_session_key: sessionKey,
    });

    logActivity({
      id: uuidv4(),
      type: "task_assigned",
      task_id: taskId,
      agent_id: agentId,
      message: `Task "${task.title}" assigned to agent "${agentId}"`,
      metadata: { sessionKey },
    });

    // Connect to OpenClaw and send the task to the agent
    const client = getOpenClawClient();
    await client.connect();

    const prompt = buildTaskPrompt(task);

    // Move to in_progress
    updateTask(taskId, { status: "in_progress" });

    logActivity({
      id: uuidv4(),
      type: "task_in_progress",
      task_id: taskId,
      agent_id: agentId,
      message: `Agent "${agentId}" started working on "${task.title}"`,
    });

    // Send to agent via chat.send
    try {
      await client.sendMessage(sessionKey, prompt);

      // Add a comment that the message was sent
      addComment({
        id: uuidv4(),
        task_id: taskId,
        agent_id: agentId,
        author_type: "system",
        content: `Task sent to agent ${agentId} via session ${sessionKey}`,
      });

      // Move to review once the agent has been notified
      // (In a real flow, you'd wait for the agent to complete, 
      // but for demo we auto-advance after sending)
      setTimeout(async () => {
        try {
          // Fetch the chat history to get the agent's response
          const history = await client.getChatHistory(sessionKey);
          const assistantMessages = history.filter(
            (m) => m.role === "assistant"
          );
          
          if (assistantMessages.length > 0) {
            const latestResponse = assistantMessages[assistantMessages.length - 1];
            
            // Add agent response as comment
            addComment({
              id: uuidv4(),
              task_id: taskId,
              agent_id: agentId,
              author_type: "agent",
              content: latestResponse.content,
            });

            // Move to review
            updateTask(taskId, { status: "review" });

            logActivity({
              id: uuidv4(),
              type: "task_review",
              task_id: taskId,
              agent_id: agentId,
              message: `Agent "${agentId}" completed work on "${task.title}" — moved to review`,
            });
          }
        } catch {
          // If we can't get history yet, still move to review
          updateTask(taskId, { status: "review" });
          logActivity({
            id: uuidv4(),
            type: "task_review",
            task_id: taskId,
            agent_id: agentId,
            message: `Task "${task.title}" moved to review (agent processing)`,
          });
        }
      }, 15000); // Wait 15 seconds for agent to respond

      return NextResponse.json({
        ok: true,
        status: "dispatched",
        sessionKey,
        message: "Task sent to agent. Will auto-advance to review after processing.",
      });
    } catch (sendError) {
      // If send fails, still log it
      addComment({
        id: uuidv4(),
        task_id: taskId,
        agent_id: agentId,
        author_type: "system",
        content: `Failed to send to agent: ${String(sendError)}`,
      });

      return NextResponse.json(
        {
          ok: false,
          error: "Failed to send task to agent",
          details: String(sendError),
        },
        { status: 502 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: "Dispatch failed", details: String(error) },
      { status: 500 }
    );
  }
}

function buildTaskPrompt(task: { title: string; description: string; priority: string }): string {
  return `## Task Assignment

**Title:** ${task.title}
**Priority:** ${task.priority.toUpperCase()}

**Description:**
${task.description || "No additional details provided."}

---

Please complete this task. Provide a clear, actionable response with your findings or deliverables. Be concise but thorough.`;
}
