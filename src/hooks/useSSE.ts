"use client";

import { useEffect, useRef } from "react";
import { useMissionControl } from "@/lib/store";
import type { SSEEvent } from "@/lib/sse-types";
import type { Task, ActivityEntry } from "@/lib/types";

export function useSSE() {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const selectedTaskIdRef = useRef<string | undefined>(undefined);
  const {
    updateTask,
    addTask,
    removeTask,
    setIsOnline,
    showTaskDetail,
    setShowTaskDetail,
    addActivity,
  } = useMissionControl();

  // Track selected task ID without causing re-renders
  useEffect(() => {
    selectedTaskIdRef.current = showTaskDetail?.id;
  }, [showTaskDetail]);

  useEffect(() => {
    let isConnecting = false;

    const connect = () => {
      if (isConnecting || eventSourceRef.current?.readyState === EventSource.OPEN) {
        return;
      }

      isConnecting = true;
      const eventSource = new EventSource("/api/events/stream");
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsOnline(true);
        isConnecting = false;
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
      };

      eventSource.onmessage = (event) => {
        try {
          if (event.data.startsWith(":")) return;
          const sseEvent: SSEEvent = JSON.parse(event.data);

          switch (sseEvent.type) {
            case "task_created":
              addTask(sseEvent.payload as Task);
              break;

            case "task_updated": {
              const incomingTask = sseEvent.payload as Task;
              updateTask(incomingTask);
              if (selectedTaskIdRef.current === incomingTask.id) {
                setShowTaskDetail(incomingTask);
              }
              break;
            }

            case "task_deleted": {
              const { taskId } = sseEvent.payload as { taskId: string };
              removeTask(taskId);
              break;
            }

            case "activity_logged":
              addActivity(sseEvent.payload as ActivityEntry);
              break;

            case "deliverable_added":
            case "agent_spawned":
            case "agent_completed":
              // These are handled by components that re-fetch when needed
              break;
          }
        } catch (error) {
          console.error("[SSE] Error parsing event:", error);
        }
      };

      eventSource.onerror = () => {
        setIsOnline(false);
        isConnecting = false;
        eventSource.close();
        eventSourceRef.current = null;

        // Reconnect after 5 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 5000);
      };
    };

    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [addTask, updateTask, removeTask, setIsOnline, setShowTaskDetail, addActivity]);
}
