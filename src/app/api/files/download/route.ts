import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync, realpathSync, statSync } from "fs";
import path from "path";

const PROJECTS_BASE = (process.env.PROJECTS_PATH || "~/projects").replace(/^~/, process.env.HOME || "");

export async function GET(request: NextRequest) {
  try {
    const relativePath = request.nextUrl.searchParams.get("relativePath") || "";
    if (!relativePath) {
      return NextResponse.json({ error: "relativePath is required" }, { status: 400 });
    }

    const normalizedPath = path.normalize(relativePath);
    if (normalizedPath.startsWith("..") || path.isAbsolute(normalizedPath)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    if (!existsSync(PROJECTS_BASE)) {
      return NextResponse.json({ error: "Projects base directory not found" }, { status: 404 });
    }

    const baseResolved = realpathSync(PROJECTS_BASE);
    const fullPath = path.join(baseResolved, normalizedPath);

    if (!existsSync(fullPath)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const resolvedFile = realpathSync(fullPath);
    if (!resolvedFile.startsWith(baseResolved + path.sep) && resolvedFile !== baseResolved) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (!statSync(resolvedFile).isFile()) {
      return NextResponse.json({ error: "Path is not a file" }, { status: 400 });
    }

    if (!resolvedFile.toLowerCase().endsWith(".md")) {
      return NextResponse.json({ error: "Only markdown files are supported" }, { status: 400 });
    }

    const content = readFileSync(resolvedFile, "utf-8");
    return NextResponse.json({ success: true, relativePath: normalizedPath, content });
  } catch (error) {
    console.error("[FILE DOWNLOAD] Error reading file:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
