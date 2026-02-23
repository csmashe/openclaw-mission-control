import type Database from "better-sqlite3";

interface Migration {
  id: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    id: "001_task_deliverables",
    sql: `
      CREATE TABLE IF NOT EXISTS task_deliverables (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        deliverable_type TEXT NOT NULL CHECK(deliverable_type IN ('file', 'url', 'artifact')),
        title TEXT NOT NULL,
        path TEXT,
        description TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_deliverables_task ON task_deliverables(task_id);
    `,
  },
  {
    id: "002_planning_columns",
    sql: `
      ALTER TABLE tasks ADD COLUMN planning_session_key TEXT;
      ALTER TABLE tasks ADD COLUMN planning_messages TEXT DEFAULT '[]';
      ALTER TABLE tasks ADD COLUMN planning_complete INTEGER DEFAULT 0;
      ALTER TABLE tasks ADD COLUMN planning_spec TEXT;
      ALTER TABLE tasks ADD COLUMN planning_agents TEXT;
      ALTER TABLE tasks ADD COLUMN planning_dispatch_error TEXT;
    `,
  },
  {
    id: "004_expand_status_check",
    sql: `
      CREATE TABLE IF NOT EXISTS tasks_new (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        status TEXT DEFAULT 'inbox' CHECK(status IN ('inbox', 'planning', 'assigned', 'in_progress', 'testing', 'review', 'done')),
        priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
        mission_id TEXT,
        assigned_agent_id TEXT,
        openclaw_session_key TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        gateway_id TEXT,
        dispatch_id TEXT,
        dispatch_started_at TEXT,
        dispatch_message_count_start INTEGER DEFAULT 0,
        planning_session_key TEXT,
        planning_messages TEXT DEFAULT '[]',
        planning_complete INTEGER DEFAULT 0,
        planning_spec TEXT,
        planning_agents TEXT,
        planning_dispatch_error TEXT,
        FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE SET NULL
      );
      INSERT INTO tasks_new SELECT * FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_mission ON tasks(mission_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(assigned_agent_id);
    `,
  },
  {
    id: "003_openclaw_sessions",
    sql: `
      CREATE TABLE IF NOT EXISTS openclaw_sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        openclaw_session_id TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        session_type TEXT DEFAULT 'persistent' CHECK(session_type IN ('persistent', 'subagent')),
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        ended_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_openclaw_sessions_task ON openclaw_sessions(task_id);
    `,
  },
];

export function runMigrations(db: Database.Database): void {
  // Create migrations table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    (db.prepare("SELECT id FROM _migrations").all() as { id: string }[]).map((r) => r.id)
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;

    try {
      // Execute each statement in the migration separately
      // (ALTER TABLE statements cannot be in a transaction with other ALTER TABLE statements in some cases)
      const statements = migration.sql
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const stmt of statements) {
        try {
          db.exec(stmt);
        } catch (err) {
          // Ignore "duplicate column" errors for ALTER TABLE ADD COLUMN
          const msg = String(err);
          if (msg.includes("duplicate column name")) continue;
          throw err;
        }
      }

      db.prepare("INSERT INTO _migrations (id) VALUES (?)").run(migration.id);
      console.log(`[migrations] Applied: ${migration.id}`);
    } catch (err) {
      console.error(`[migrations] Failed to apply ${migration.id}:`, err);
      throw err;
    }
  }
}
