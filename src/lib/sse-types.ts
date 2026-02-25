export type SSEEventType =
  | "task_created"
  | "task_updated"
  | "task_deleted"
  | "activity_logged"
  | "deliverable_added"
  | "agent_spawned"
  | "agent_completed"
  | "plugin_toggled";

export interface SSEEvent {
  type: SSEEventType;
  payload: unknown;
}
