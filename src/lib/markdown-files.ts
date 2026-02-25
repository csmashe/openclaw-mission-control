import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "fs";
import path from "path";
import crypto from "crypto";

export type AuditOutcome = "allow" | "deny" | "error";

export class FileAccessError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code:
      | "INVALID_PATH"
      | "NOT_FOUND"
      | "NOT_FILE"
      | "NOT_DIRECTORY"
      | "OUTSIDE_ALLOWLIST"
      | "DENYLIST"
      | "TOO_LARGE"
      | "READ_ONLY"
      | "BINARY_OR_NON_UTF8"
      | "CONFLICT"
      | "BAD_REQUEST"
  ) {
    super(message);
  }
}

export interface MarkdownFileConfig {
  roots: Array<{ key: string; label: string; path: string }>;
  denylist: string[];
  extensions: string[];
  maxFileSizeBytes: number;
  readOnly: boolean;
}

export interface FileEntry {
  name: string;
  relativePath: string;
  size: number;
  modifiedAt: string;
  modifiedAtMs: number;
  etag: string;
}

export interface DirectoryEntry {
  name: string;
  relativePath: string;
}

const AUDIT_LOG_PATH = path.join(process.cwd(), "data", "markdown-files.audit.log");

function expandHome(input: string): string {
  return input.replace(/^~/, process.env.HOME || "");
}

function toRegexPattern(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function isLikelyUtf8Text(content: Buffer): boolean {
  if (content.includes(0)) return false;
  return true;
}

function makeEtag(size: number, mtimeMs: number): string {
  return crypto.createHash("sha1").update(`${size}:${mtimeMs}`).digest("hex");
}

export function getMarkdownFileConfig(): MarkdownFileConfig {
  const defaultRoot = expandHome(process.env.PROJECTS_PATH || "~/projects");
  const rootsRaw = process.env.MARKDOWN_FILE_ROOTS || defaultRoot;
  const roots = rootsRaw
    .split(",")
    .map((v) => expandHome(v.trim()))
    .filter(Boolean)
    .map((rootPath, index) => ({
      key: `root-${index + 1}`,
      label: index === 0 ? "Default" : `Root ${index + 1}`,
      path: rootPath,
    }));

  const denylist = (process.env.MARKDOWN_FILE_DENYLIST || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const extensions = (process.env.MARKDOWN_FILE_EXTENSIONS || ".md,.markdown")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  const maxFileSizeBytes = Number(process.env.MARKDOWN_FILE_MAX_BYTES || 1024 * 1024);
  const readOnly = String(process.env.MARKDOWN_FILE_READ_ONLY || "false").toLowerCase() === "true";

  return { roots, denylist, extensions, maxFileSizeBytes, readOnly };
}

function getRootByKeyOrDefault(config: MarkdownFileConfig, key?: string) {
  const root = key ? config.roots.find((r) => r.key === key) : config.roots[0];
  if (!root) throw new FileAccessError("No markdown roots configured", 500, "BAD_REQUEST");
  return root;
}

function normalizeRelative(relativePath: string): string {
  const normalized = path.normalize(relativePath || "").replace(/^\/+/, "");
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new FileAccessError("Invalid path", 400, "INVALID_PATH");
  }
  return normalized === "." ? "" : normalized;
}

function matchesDenylist(config: MarkdownFileConfig, relativePath: string): boolean {
  return config.denylist.some((pattern) => toRegexPattern(pattern).test(relativePath));
}

function ensureAllowedExtension(config: MarkdownFileConfig, fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (!config.extensions.includes(ext)) {
    throw new FileAccessError(`Only ${config.extensions.join(", ")} files are allowed`, 400, "BAD_REQUEST");
  }
}

function resolveScopedPath(config: MarkdownFileConfig, rootKey: string | undefined, relativePath: string) {
  const root = getRootByKeyOrDefault(config, rootKey);
  const normalized = normalizeRelative(relativePath);
  const rootReal = existsSync(root.path) ? realpathSync(root.path) : root.path;
  const absolute = path.join(rootReal, normalized);
  const parent = path.dirname(absolute);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });

  const parentReal = realpathSync(parent);
  const scoped = parentReal === rootReal || parentReal.startsWith(`${rootReal}${path.sep}`);
  if (!scoped) {
    throw new FileAccessError("Path escapes configured root", 403, "OUTSIDE_ALLOWLIST");
  }

  if (matchesDenylist(config, normalized)) {
    throw new FileAccessError("Path matches denylist", 403, "DENYLIST");
  }

  return { root, normalized, absolute, rootReal };
}

export function auditLog(args: {
  action: "list" | "read" | "write";
  path: string;
  outcome: AuditOutcome;
  message?: string;
  session?: string;
  user?: string;
}) {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...args,
    });
    mkdirSync(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    appendFileSync(AUDIT_LOG_PATH, `${line}\n`);
  } catch {
    // best-effort
  }
}

export function listMarkdownDirectory(args: {
  rootKey?: string;
  dir?: string;
  filter?: string;
  search?: string;
}) {
  const config = getMarkdownFileConfig();
  const root = getRootByKeyOrDefault(config, args.rootKey);
  if (!existsSync(root.path)) mkdirSync(root.path, { recursive: true });

  const dirRelative = normalizeRelative(args.dir || "");
  const { normalized, absolute, rootReal } = resolveScopedPath(config, root.key, dirRelative);

  if (!existsSync(absolute)) {
    throw new FileAccessError("Directory not found", 404, "NOT_FOUND");
  }
  const st = statSync(absolute);
  if (!st.isDirectory()) throw new FileAccessError("Path is not a directory", 400, "NOT_DIRECTORY");

  const entries = readdirSync(absolute, { withFileTypes: true });
  const directories: DirectoryEntry[] = [];
  const files: Array<FileEntry & { matchCount?: number }> = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const childRel = path.join(normalized, entry.name).replace(/\\/g, "/");
    if (matchesDenylist(config, childRel)) continue;

    if (entry.isDirectory()) {
      directories.push({ name: entry.name, relativePath: childRel });
      continue;
    }

    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!config.extensions.includes(ext)) continue;

    const filePath = path.join(absolute, entry.name);
    const resolved = realpathSync(filePath);
    if (!(resolved === rootReal || resolved.startsWith(`${rootReal}${path.sep}`))) continue;

    const fileStat = statSync(resolved);
    if (fileStat.size > config.maxFileSizeBytes) continue;

    if (args.filter && !entry.name.toLowerCase().includes(args.filter.toLowerCase())) continue;

    let matchCount = 0;
    if (args.search) {
      try {
        const buf = readFileSync(resolved);
        if (!isLikelyUtf8Text(buf)) continue;
        const text = buf.toString("utf-8").toLowerCase();
        const needle = args.search.toLowerCase();
        let idx = text.indexOf(needle);
        while (idx >= 0) {
          matchCount += 1;
          idx = text.indexOf(needle, idx + needle.length);
        }
        if (matchCount === 0) continue;
      } catch {
        continue;
      }
    }

    files.push({
      name: entry.name,
      relativePath: childRel,
      size: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
      modifiedAtMs: fileStat.mtimeMs,
      etag: makeEtag(fileStat.size, fileStat.mtimeMs),
      ...(args.search ? { matchCount } : {}),
    });
  }

  directories.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));

  return {
    config: {
      roots: config.roots,
      extensions: config.extensions,
      maxFileSizeBytes: config.maxFileSizeBytes,
      readOnly: config.readOnly,
      denylistEnabled: config.denylist.length > 0,
    },
    root,
    dir: normalized,
    directories,
    files,
  };
}

export function readMarkdownFile(args: { rootKey?: string; relativePath: string }) {
  const config = getMarkdownFileConfig();
  const { normalized, absolute, root } = resolveScopedPath(config, args.rootKey, args.relativePath);
  ensureAllowedExtension(config, normalized);

  if (!existsSync(absolute)) throw new FileAccessError("File not found", 404, "NOT_FOUND");
  const resolved = realpathSync(absolute);
  const st = statSync(resolved);
  if (!st.isFile()) throw new FileAccessError("Path is not a file", 400, "NOT_FILE");
  if (st.size > config.maxFileSizeBytes) {
    throw new FileAccessError("File exceeds maximum allowed size", 413, "TOO_LARGE");
  }

  const buf = readFileSync(resolved);
  if (!isLikelyUtf8Text(buf)) {
    throw new FileAccessError("File is binary or non-UTF8", 415, "BINARY_OR_NON_UTF8");
  }

  const content = buf.toString("utf-8");
  return {
    root,
    relativePath: normalized,
    content,
    size: st.size,
    modifiedAt: st.mtime.toISOString(),
    modifiedAtMs: st.mtimeMs,
    etag: makeEtag(st.size, st.mtimeMs),
  };
}

export function writeMarkdownFile(args: {
  rootKey?: string;
  relativePath: string;
  content: string;
  expectedEtag?: string;
  expectedMtimeMs?: number;
  force?: boolean;
}) {
  const config = getMarkdownFileConfig();
  if (config.readOnly) throw new FileAccessError("Markdown editor is read-only", 403, "READ_ONLY");

  const { normalized, absolute, root } = resolveScopedPath(config, args.rootKey, args.relativePath);
  ensureAllowedExtension(config, normalized);

  if (existsSync(absolute)) {
    const current = statSync(absolute);
    const currentEtag = makeEtag(current.size, current.mtimeMs);
    const mismatch =
      (!args.force && args.expectedEtag && args.expectedEtag !== currentEtag) ||
      (!args.force && typeof args.expectedMtimeMs === "number" && Math.round(args.expectedMtimeMs) !== Math.round(current.mtimeMs));

    if (mismatch) {
      throw new FileAccessError("File changed on disk since last read", 409, "CONFLICT");
    }
  }

  writeFileSync(absolute, args.content, { encoding: "utf-8" });
  const st = statSync(absolute);

  return {
    root,
    relativePath: normalized,
    size: st.size,
    modifiedAt: st.mtime.toISOString(),
    modifiedAtMs: st.mtimeMs,
    etag: makeEtag(st.size, st.mtimeMs),
  };
}
