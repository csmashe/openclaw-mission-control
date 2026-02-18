import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

// Use globalThis to ensure a true singleton across Next.js module boundaries.
// Turbopack/webpack may re-instantiate module-level variables for different API routes.
const globalForDb = globalThis as typeof globalThis & {
  __missionControlDb?: Database.Database;
};

export function getDb(): Database.Database {
  if (globalForDb.__missionControlDb) return globalForDb.__missionControlDb;

  const dbPath = path.resolve(process.cwd(), "data", "mission-control.db");

  // Ensure data directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  initializeSchema(db);
  globalForDb.__missionControlDb = db;
  return db;
}

function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'completed', 'archived')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'inbox' CHECK(status IN ('inbox', 'assigned', 'in_progress', 'review', 'done')),
      priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
      mission_id TEXT,
      assigned_agent_id TEXT,
      openclaw_session_key TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS task_comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT,
      author_type TEXT DEFAULT 'agent' CHECK(author_type IN ('agent', 'user', 'system')),
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      agent_id TEXT,
      task_id TEXT,
      mission_id TEXT,
      message TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_mission ON tasks(mission_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(assigned_agent_id);
    CREATE INDEX IF NOT EXISTS idx_comments_task ON task_comments(task_id);
    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_log(type);
  `);
}

// --- Missions ---

export interface Mission {
  id: string;
  name: string;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export function listMissions(): Mission[] {
  return getDb()
    .prepare("SELECT * FROM missions ORDER BY created_at DESC")
    .all() as Mission[];
}

export function getMission(id: string): Mission | undefined {
  return getDb().prepare("SELECT * FROM missions WHERE id = ?").get(id) as
    | Mission
    | undefined;
}

export function createMission(data: {
  id: string;
  name: string;
  description?: string;
}): Mission {
  getDb()
    .prepare(
      "INSERT INTO missions (id, name, description) VALUES (?, ?, ?)"
    )
    .run(data.id, data.name, data.description ?? "");
  return getMission(data.id)!;
}

export function updateMission(
  id: string,
  patch: Partial<{ name: string; description: string; status: string }>
): Mission | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (patch.name !== undefined) {
    fields.push("name = ?");
    values.push(patch.name);
  }
  if (patch.description !== undefined) {
    fields.push("description = ?");
    values.push(patch.description);
  }
  if (patch.status !== undefined) {
    fields.push("status = ?");
    values.push(patch.status);
  }

  if (fields.length === 0) return getMission(id);

  fields.push("updated_at = datetime('now')");
  values.push(id);

  getDb()
    .prepare(`UPDATE missions SET ${fields.join(", ")} WHERE id = ?`)
    .run(...values);
  return getMission(id);
}

export function deleteMission(id: string): void {
  getDb().prepare("DELETE FROM missions WHERE id = ?").run(id);
}

// --- Tasks ---

export interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  mission_id: string | null;
  assigned_agent_id: string | null;
  openclaw_session_key: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export function listTasks(filters?: {
  status?: string;
  mission_id?: string;
  assigned_agent_id?: string;
}): Task[] {
  let sql = "SELECT * FROM tasks WHERE 1=1";
  const params: unknown[] = [];

  if (filters?.status) {
    sql += " AND status = ?";
    params.push(filters.status);
  }
  if (filters?.mission_id) {
    sql += " AND mission_id = ?";
    params.push(filters.mission_id);
  }
  if (filters?.assigned_agent_id) {
    sql += " AND assigned_agent_id = ?";
    params.push(filters.assigned_agent_id);
  }

  sql += " ORDER BY sort_order ASC, created_at DESC";
  return getDb().prepare(sql).all(...params) as Task[];
}

export function getTask(id: string): Task | undefined {
  return getDb().prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
    | Task
    | undefined;
}

export function createTask(data: {
  id: string;
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  mission_id?: string;
  assigned_agent_id?: string;
}): Task {
  const maxOrder = getDb()
    .prepare(
      "SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM tasks WHERE status = ?"
    )
    .get(data.status ?? "inbox") as { next: number };

  getDb()
    .prepare(
      `INSERT INTO tasks (id, title, description, status, priority, mission_id, assigned_agent_id, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.id,
      data.title,
      data.description ?? "",
      data.status ?? "inbox",
      data.priority ?? "medium",
      data.mission_id ?? null,
      data.assigned_agent_id ?? null,
      maxOrder.next
    );
  return getTask(data.id)!;
}

export function updateTask(
  id: string,
  patch: Partial<{
    title: string;
    description: string;
    status: string;
    priority: string;
    mission_id: string | null;
    assigned_agent_id: string | null;
    openclaw_session_key: string | null;
    sort_order: number;
  }>
): Task | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return getTask(id);

  fields.push("updated_at = datetime('now')");
  values.push(id);

  getDb()
    .prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`)
    .run(...values);
  return getTask(id);
}

export function deleteTask(id: string): void {
  getDb().prepare("DELETE FROM tasks WHERE id = ?").run(id);
}

// --- Comments ---

export interface TaskComment {
  id: string;
  task_id: string;
  agent_id: string | null;
  author_type: string;
  content: string;
  created_at: string;
}

export function listComments(taskId: string): TaskComment[] {
  return getDb()
    .prepare(
      "SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC"
    )
    .all(taskId) as TaskComment[];
}

export function addComment(data: {
  id: string;
  task_id: string;
  agent_id?: string;
  author_type?: string;
  content: string;
}): TaskComment {
  getDb()
    .prepare(
      `INSERT INTO task_comments (id, task_id, agent_id, author_type, content)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      data.id,
      data.task_id,
      data.agent_id ?? null,
      data.author_type ?? "agent",
      data.content
    );
  return getDb()
    .prepare("SELECT * FROM task_comments WHERE id = ?")
    .get(data.id) as TaskComment;
}

// --- Activity Log ---

export interface ActivityEntry {
  id: string;
  type: string;
  agent_id: string | null;
  task_id: string | null;
  mission_id: string | null;
  message: string;
  metadata: string;
  created_at: string;
}

export function logActivity(data: {
  id: string;
  type: string;
  agent_id?: string;
  task_id?: string;
  mission_id?: string;
  message: string;
  metadata?: Record<string, unknown>;
}): void {
  getDb()
    .prepare(
      `INSERT INTO activity_log (id, type, agent_id, task_id, mission_id, message, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.id,
      data.type,
      data.agent_id ?? null,
      data.task_id ?? null,
      data.mission_id ?? null,
      data.message,
      JSON.stringify(data.metadata ?? {})
    );
}

export function listActivity(opts?: {
  limit?: number;
  type?: string;
}): ActivityEntry[] {
  let sql = "SELECT * FROM activity_log WHERE 1=1";
  const params: unknown[] = [];

  if (opts?.type) {
    sql += " AND type = ?";
    params.push(opts.type);
  }

  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(opts?.limit ?? 50);

  return getDb().prepare(sql).all(...params) as ActivityEntry[];
}
