import { NextRequest, NextResponse } from "next/server";
import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from "fs";
import path from "path";

const PROJECTS_BASE = (process.env.PROJECTS_PATH || "~/projects").replace(/^~/, process.env.HOME || "");

interface UploadRequest {
  relativePath: string;
  content: string;
  encoding?: BufferEncoding;
}

export async function POST(request: NextRequest) {
  try {
    const body: UploadRequest = await request.json();
    const { relativePath, content, encoding = "utf-8" } = body;

    if (!relativePath || content === undefined) {
      return NextResponse.json({ error: "relativePath and content are required" }, { status: 400 });
    }

    const normalizedPath = path.normalize(relativePath);
    if (normalizedPath.startsWith("..") || path.isAbsolute(normalizedPath)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    if (!existsSync(PROJECTS_BASE)) {
      mkdirSync(PROJECTS_BASE, { recursive: true });
    }

    const baseResolved = realpathSync(PROJECTS_BASE);
    const fullPath = path.join(baseResolved, normalizedPath);
    const parentDir = path.dirname(fullPath);

    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    const resolvedParent = realpathSync(parentDir);
    if (!resolvedParent.startsWith(baseResolved + path.sep) && resolvedParent !== baseResolved) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (!fullPath.toLowerCase().endsWith(".md")) {
      return NextResponse.json({ error: "Only markdown files are supported" }, { status: 400 });
    }

    writeFileSync(fullPath, content, { encoding });

    const stats = statSync(fullPath);
    return NextResponse.json(
      {
        success: true,
        relativePath: normalizedPath,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[FILE UPLOAD] Error writing file:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
