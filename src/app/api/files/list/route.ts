import { NextRequest, NextResponse } from "next/server";
import { existsSync, readdirSync, realpathSync, statSync } from "fs";
import path from "path";

const PROJECTS_BASE = (process.env.PROJECTS_PATH || "~/projects").replace(/^~/, process.env.HOME || "");

interface ListedFile {
  name: string;
  relativePath: string;
  size: number;
  modifiedAt: string;
}

function collectMarkdownFiles(root: string, baseResolved: string, relativePrefix = ""): ListedFile[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const files: ListedFile[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const absolutePath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(absolutePath, baseResolved, path.join(relativePrefix, entry.name)));
      continue;
    }

    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;

    const resolvedFile = realpathSync(absolutePath);
    if (!resolvedFile.startsWith(baseResolved + path.sep) && resolvedFile !== baseResolved) continue;

    const stats = statSync(absolutePath);
    files.push({
      name: entry.name,
      relativePath: path.join(relativePrefix, entry.name),
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    });
  }

  return files;
}

export async function GET(request: NextRequest) {
  try {
    const dirParam = request.nextUrl.searchParams.get("dir") || "";
    const normalizedDir = path.normalize(dirParam);

    if (normalizedDir.startsWith("..") || path.isAbsolute(normalizedDir)) {
      return NextResponse.json({ error: "Invalid dir: must be relative and cannot traverse upward" }, { status: 400 });
    }

    if (!existsSync(PROJECTS_BASE)) {
      return NextResponse.json({ success: true, basePath: PROJECTS_BASE, dir: normalizedDir, count: 0, files: [] });
    }

    const baseResolved = realpathSync(PROJECTS_BASE);
    const targetPath = path.join(baseResolved, normalizedDir);

    if (!existsSync(targetPath)) {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }

    const resolvedTarget = realpathSync(targetPath);
    if (!resolvedTarget.startsWith(baseResolved + path.sep) && resolvedTarget !== baseResolved) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (!statSync(resolvedTarget).isDirectory()) {
      return NextResponse.json({ error: "dir must point to a directory" }, { status: 400 });
    }

    const files = collectMarkdownFiles(resolvedTarget, baseResolved).sort((a, b) =>
      a.relativePath.localeCompare(b.relativePath)
    );

    return NextResponse.json({
      success: true,
      basePath: PROJECTS_BASE,
      dir: normalizedDir,
      count: files.length,
      files,
    });
  } catch (error) {
    console.error("[FILE LIST] Error listing markdown files:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
