import type { ColumnId } from "@/lib/types";

export const COLUMNS: { id: ColumnId; label: string }[] = [
  { id: "inbox", label: "INBOX" },
  { id: "planning", label: "PLANNING" },
  { id: "assigned", label: "ASSIGNED" },
  { id: "in_progress", label: "IN PROGRESS" },
  { id: "review", label: "REVIEW" },
  { id: "done", label: "DONE" },
];
