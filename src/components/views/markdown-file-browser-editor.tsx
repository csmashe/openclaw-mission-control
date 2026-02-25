"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, RefreshCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MarkdownFile {
  name: string;
  relativePath: string;
  size: number;
  modifiedAt: string;
}

export function MarkdownFileBrowserEditor() {
  const [files, setFiles] = useState<MarkdownFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty = useMemo(() => content !== originalContent, [content, originalContent]);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const res = await fetch("/api/files/list");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to list markdown files");

      const markdownFiles: MarkdownFile[] = data.files || [];
      setFiles(markdownFiles);

      if (markdownFiles.length === 0) {
        setSelectedPath(null);
        setContent("");
        setOriginalContent("");
      } else if (!selectedPath || !markdownFiles.some((f) => f.relativePath === selectedPath)) {
        setSelectedPath(markdownFiles[0].relativePath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
    } finally {
      setLoadingList(false);
    }
  }, [selectedPath]);

  const loadFile = useCallback(async (relativePath: string) => {
    setLoadingFile(true);
    setError(null);
    try {
      const res = await fetch(`/api/files/download?relativePath=${encodeURIComponent(relativePath)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load file");

      const loadedContent = typeof data.content === "string" ? data.content : "";
      setContent(loadedContent);
      setOriginalContent(loadedContent);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load file");
    } finally {
      setLoadingFile(false);
    }
  }, []);

  const saveFile = async () => {
    if (!selectedPath) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/files/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relativePath: selectedPath, content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save file");

      setOriginalContent(content);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save file");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedPath) {
      void loadFile(selectedPath);
    }
  }, [selectedPath, loadFile]);

  return (
    <div className="flex-1 overflow-hidden flex min-h-0">
      <div className="w-80 border-r border-border bg-card/30 flex flex-col min-h-0">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Markdown Files</span>
          <Button variant="ghost" size="sm" onClick={() => void loadList()} title="Refresh files" className="h-7 w-7 p-0">
            <RefreshCcw className={`w-4 h-4 ${loadingList ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-2 space-y-1">
          {files.length === 0 && !loadingList && (
            <div className="text-xs text-muted-foreground p-2">No .md files found under PROJECTS_PATH.</div>
          )}

          {files.map((file) => {
            const isSelected = file.relativePath === selectedPath;
            return (
              <button
                key={file.relativePath}
                onClick={() => setSelectedPath(file.relativePath)}
                className={`w-full text-left px-2 py-2 rounded border transition-colors ${
                  isSelected ? "border-primary bg-primary/10" : "border-transparent hover:border-border hover:bg-background/80"
                }`}
              >
                <div className="flex items-start gap-2">
                  <FileText className="w-4 h-4 mt-0.5 text-primary" />
                  <div className="min-w-0">
                    <div className="text-xs text-foreground truncate">{file.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{file.relativePath}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        <div className="p-3 border-b border-border flex items-center justify-between gap-3 bg-card/30">
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{selectedPath || "Select a markdown file"}</div>
            {isDirty && <div className="text-xs text-amber-400">Unsaved changes</div>}
          </div>
          <Button onClick={saveFile} disabled={!selectedPath || !isDirty || saving} className="gap-2">
            <Save className="w-4 h-4" />
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>

        <div className="flex-1 min-h-0 p-3">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={!selectedPath || loadingFile}
            className="w-full h-full min-h-[280px] resize-none rounded border border-border bg-card/50 p-3 font-mono text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder={loadingFile ? "Loading..." : "Select a markdown file to edit"}
          />
        </div>

        {error && <div className="px-3 pb-3 text-xs text-red-400">{error}</div>}
      </div>
    </div>
  );
}
