"use client";

import { useState, useEffect, useCallback } from "react";
import { FileText, Globe, Package, Trash2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Deliverable {
  id: string;
  task_id: string;
  deliverable_type: string;
  title: string;
  path: string | null;
  description: string | null;
  created_at: string;
}

function getTypeIcon(type: string) {
  switch (type) {
    case "file": return <FileText className="w-4 h-4 text-blue-400" />;
    case "url": return <Globe className="w-4 h-4 text-green-400" />;
    case "artifact": return <Package className="w-4 h-4 text-purple-400" />;
    default: return <FileText className="w-4 h-4 text-muted-foreground" />;
  }
}

export function DeliverablesList({ taskId }: { taskId: string }) {
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDeliverables = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/deliverables`);
      const data = await res.json();
      setDeliverables(data.deliverables || []);
    } catch { /* retry */ }
    finally { setLoading(false); }
  }, [taskId]);

  useEffect(() => {
    fetchDeliverables();
  }, [fetchDeliverables]);

  const handleDelete = async (deliverableId: string) => {
    await fetch(`/api/tasks/${taskId}/deliverables?deliverableId=${deliverableId}`, {
      method: "DELETE",
    });
    await fetchDeliverables();
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground animate-pulse py-2">Loading deliverables...</div>;
  }

  if (deliverables.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        No deliverables yet. Agents will register output files and artifacts here.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {deliverables.map((d) => (
        <div
          key={d.id}
          className="flex items-center gap-3 p-3 rounded-md border border-border bg-card hover:bg-muted/50 transition-colors group"
        >
          {getTypeIcon(d.deliverable_type)}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{d.title}</div>
            {d.path && (
              <div className="text-[11px] text-muted-foreground font-mono truncate">{d.path}</div>
            )}
            {d.description && (
              <div className="text-[11px] text-muted-foreground mt-0.5">{d.description}</div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {d.deliverable_type === "url" && d.path && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => window.open(d.path!, "_blank")}
              >
                <ExternalLink className="w-3 h-3" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
              onClick={() => handleDelete(d.id)}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
