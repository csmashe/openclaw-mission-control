"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/helpers";

export function MissionsView() {
  const [missions, setMissions] = useState<{ id: string; name: string; description: string; status: string; created_at: string }[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const fetchMissions = useCallback(async () => {
    try {
      const res = await fetch("/api/missions");
      const data = await res.json();
      setMissions(data.missions || []);
    } catch { /* retry */ }
  }, []);

  useEffect(() => { fetchMissions(); }, [fetchMissions]);

  const createMission = async () => {
    if (!newName.trim()) return;
    await fetch("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() }),
    });
    setNewName("");
    setNewDesc("");
    setShowCreate(false);
    await fetchMissions();
  };

  return (
    <div className="flex-1 overflow-auto p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold">Your Missions</h3>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4 mr-1" /> New Mission
        </Button>
      </div>

      {missions.length === 0 && !showCreate ? (
        <div className="text-center py-12 space-y-3">
          <Rocket className="w-10 h-10 mx-auto text-muted-foreground/30" />
          <p className="text-muted-foreground text-sm">No missions yet. Create your first mission.</p>
          <Button onClick={() => setShowCreate(true)}>Create Mission</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {showCreate && (
            <div className="bg-card border border-primary/20 rounded-lg p-5 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Mission Name</label>
                <input
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., Content Marketing Campaign"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Description</label>
                <textarea
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring min-h-[60px] resize-y"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="What's the goal?"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button size="sm" onClick={createMission}>Create</Button>
              </div>
            </div>
          )}
          {missions.map((m) => (
            <div key={m.id} className="bg-card border border-border rounded-lg p-5 hover:border-primary/50 transition-all">
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-semibold flex items-center gap-2">
                    <Rocket className="w-4 h-4 text-primary" /> {m.name}
                  </div>
                  {m.description && (
                    <div className="text-sm text-muted-foreground mt-1">{m.description}</div>
                  )}
                </div>
                <Badge variant="outline" className="capitalize">{m.status}</Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-3">{timeAgo(m.created_at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
