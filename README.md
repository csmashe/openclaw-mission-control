<p align="center">
  <img src="resources/home-screen.png" alt="Mission Control Dashboard — AI Agent Management Interface" width="100%" />
</p>

<h1 align="center">// MISSION CONTROL</h1>

<p align="center">
  <strong>A real-time dashboard to manage, monitor, and orchestrate your AI agents</strong>
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-features">Features</a> •
  <a href="#%EF%B8%8F-setup">Setup</a> •
  <a href="#-tech-stack">Tech Stack</a> •
  <a href="#-contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/React-19-blue?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-38B2AC?logo=tailwind-css" alt="Tailwind CSS 4" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
</p>

---

**Mission Control** is an open-source, real-time command-center dashboard for [OpenClaw](https://github.com/openclaw/openclaw) — the open-source AI agent framework. It gives you a visual interface to create tasks, dispatch them to AI agents, monitor agent activity, and track progress through a Kanban-style workflow.

Based on [openclaw-mission-control](https://github.com/navjotdhanawat/openclaw-mission-control) by Navjot Dhanawat.

Think of it as **your personal AI operations center** — a single pane of glass for everything your AI agents are doing.

---

## 🚀 Quick Start

Run Mission Control instantly with a single command — no cloning required:

```bash
npx openclaw-mission-control
```

The interactive setup wizard will ask for:

| Prompt          | Default                | Description                                   |
| --------------- | ---------------------- | --------------------------------------------- |
| **Gateway URL** | `ws://127.0.0.1:18789` | Your OpenClaw gateway WebSocket address       |
| **Auth Token**  | —                      | Authentication token from your gateway config |
| **Port**        | `3000`                 | Port to serve the dashboard on                |

Once configured, Mission Control starts in **under 1 second** and opens at `http://localhost:3000`.

---

## ✨ Features

### 📋 Kanban Task Board

Organize AI agent work across seven workflow stages with drag-and-drop:

- **Inbox** → **Planning** → **Assigned** → **In Progress** → **Testing** → **Review** → **Done**
- Create tasks with priority levels (Low, Medium, High, Urgent)
- Drag tasks between columns to update status
- Task cards show assigned agent, priority badge, and time elapsed

### 🧠 AI Planning Phase

Before dispatching work, tasks can go through an AI-driven planning phase:

- **Clarifying Q&A** — the planner agent asks questions to refine requirements before producing a spec
- **Spec review** — once the spec is ready, review the title, summary, deliverables, and success criteria
- **Revision workflow** — send feedback to the planner to revise the spec before approving
- **Auto-approve & dispatch** — optionally skip the approval gate and dispatch automatically once the spec is ready (useful for automated/CI-driven task creation)
- **Agent assignment at approval** — assign or change the target agent at approval time

### 🔄 Multi-Agent Orchestration

Configure dedicated agents for each workflow role:

1. Click the **Settings** gear icon at the bottom of the sidebar
2. Select the **Workflow Roles** tab
3. Assign agents to each role using the dropdowns:

- **Orchestrator** — coordinates handoffs between planning, coding, and testing phases
- **Planner** — handles spec clarification during the planning phase
- **Tester** — validates completed work via code review, lint, type checks, and browser testing
- **Max Rework Cycles** — how many test-fix loops before escalating to manual review (default: 3)

When no roles are configured, behavior is identical to default direct routing.

### 🧪 Testing Column & Quality Gate

Completed tasks can be routed through a dedicated testing stage:

- Automated test agent validates deliverables
- Failed tests trigger rework cycles back to the assigned agent
- Configurable max rework cycles before escalating to manual review

### 👥 Who's Working Panel

A real-time view of every active agent and what they are doing:

- Agent name, current task, session status, and activity type
- Stall detection — healthy, idle warning, stalled, or error states
- Elapsed time and idle time tracking per worker
- One-click refresh to get the latest snapshot

### 🤖 Agent Monitoring

- Real-time agent status (Online / Offline / Busy)
- View connected agents with model info and capabilities
- Dispatch tasks directly to specific agents
- Track which agent is working on what

### 📡 Live Terminal

- Floating, collapsible terminal panel (slides from right)
- Real-time activity feed with color-coded entries
- Timestamps for every event (task created, agent assigned, status changes)
- Toggle visibility with the terminal button in the header

### 🎯 Mission Management

- Group related tasks into missions
- Track mission progress and completion status
- Organize complex multi-task workflows

### 🧩 Plugin System

Extend Mission Control with custom plugins — no need to modify core source.

#### Installing & Managing Plugins

1. Drop a plugin folder into `~/.openclaw/mission-control/plugins/` (each folder needs a `plugin.json` manifest and a bundled JS entry file)
2. Click the **Settings** gear icon at the bottom of the sidebar
3. Select the **Plugins** tab
4. Click the **rescan** button (top-right) to discover new plugins
5. Toggle a plugin **Enabled** — its icon immediately appears in the sidebar after the core nav items
6. Click the plugin icon in the sidebar to open it

**Features:**

- **Sidebar integration** — enabled plugins get their own icon in the sidebar nav (any [Lucide icon](https://lucide.dev/icons/))
- **Full API access** — plugins receive a context object with `api.get/post/patch/delete`, navigation, and per-plugin settings
- **Error boundaries** — broken plugins are caught and display an error UI with a retry button
- **SSE events** — `plugin_toggled` event broadcasts enable/disable changes in real time

#### Writing a Plugin

Create `~/.openclaw/mission-control/plugins/my-plugin/plugin.json`:

```json
{
  "name": "My Plugin",
  "slug": "my-plugin",
  "version": "1.0.0",
  "description": "What it does",
  "author": "Your Name",
  "icon": "puzzle",
  "entry": "index.js"
}
```

Create `index.js` (pre-bundled, React provided by host):

```js
(function(React, mc) {
  function MyPlugin({ context }) {
    const [data, setData] = React.useState(null);
    React.useEffect(() => {
      context.api.get('/api/tasks').then(setData);
    }, []);
    return React.createElement('div', { className: 'flex-1 p-6' },
      React.createElement('h2', { className: 'text-xl font-bold' }, 'My Plugin')
    );
  }
  mc.register('my-plugin', MyPlugin);
})(window.__MC_REACT, window.__MC_PLUGINS);
```

A sample `hello-world` plugin is included in the repository.

### 💬 Chat Panel

Interactive chat interface for conversing with AI agents directly from the dashboard.

### 🌗 Dark & Light Mode

- Beautiful dark mode with glassmorphism effects (default)
- Clean light mode with proper contrast
- One-click toggle in the header

### ⚡ Real-Time Sync

- Server-Sent Events (SSE) for instant UI updates
- WebSocket connection to OpenClaw gateway
- Live status indicator (System Online / Offline)
- Auto-reconnection on connection loss
- Zustand store for client-side state management

---

## ⚙️ Setup

### Prerequisites

- **Node.js** 18+ ([download](https://nodejs.org/))
- **OpenClaw Gateway** running locally or remotely ([setup guide](https://github.com/openclaw/openclaw))

### Option 1: npx (Recommended)

```bash
npx openclaw-mission-control
```

No installation required. The wizard handles everything.

### Option 2: Clone & Run

```bash
# Clone the repository
git clone https://github.com/openclaw/openclaw.git
cd openclaw/mission-control

# Install dependencies
npm install

# Configure environment
cp .env.example .env.local
```

Edit `.env.local` with your settings:

```env
# OpenClaw Gateway
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=your_gateway_token_here

# Mission Control API auth
OPENCLAW_API_TOKEN=your_api_token_here
```

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Option 3: Production Build

```bash
npm run build
npm start
```

The production build uses Next.js standalone output for minimal footprint and fast startup (~35ms).

---

## 🔧 Configuration

| Environment Variable   | Required | Default                | Description                                |
| ---------------------- | -------- | ---------------------- | ------------------------------------------ |
| `OPENCLAW_GATEWAY_URL`   | No       | `ws://127.0.0.1:18789` | WebSocket URL of your OpenClaw gateway                     |
| `OPENCLAW_GATEWAY_TOKEN` | Yes      | —                      | Gateway token used for WebSocket connect/auth handshake    |
| `OPENCLAW_API_TOKEN`     | Yes      | —                      | Token required by privileged Mission Control API endpoints |
| `PORT`                   | No       | `3000`                 | Port number for the dashboard                              |

### Finding Your Gateway Token

Your OpenClaw gateway token is in your gateway config (usually `~/.openclaw/openclaw.json`) under `gateway.auth.token`.

You can inspect it with:

```bash
openclaw gateway config get
```

Config shape example:

```json
{
  "gateway": {
    "auth": {
      "mode": "token",
      "token": "your_token_here"
    }
  }
}
```

### API Authentication for Privileged Routes

`/api/openclaw/*` and `/api/chat` are protected by token auth.

For **programmatic clients** (curl, scripts, external integrations), send one of:

- `Authorization: Bearer <token>`
- `x-openclaw-token: <token>`

For the **Mission Control frontend**, no client-side token wiring is needed:

- The server issues an HTTP-only browser session proof cookie (`mc_browser_session`) on normal page loads.
- Protected API requests from the browser are validated against that proof.
- On success, the server injects `x-openclaw-token` internally before route handlers run.
- The API token never needs to be exposed in browser code, localStorage, or UI logs.

Set `OPENCLAW_API_TOKEN` explicitly; Mission Control does not fall back to any other token variable.

---

## 🏗️ Tech Stack

| Technology                                      | Purpose                                         |
| ----------------------------------------------- | ----------------------------------------------- |
| [Next.js 16](https://nextjs.org/)               | Full-stack React framework with App Router      |
| [React 19](https://react.dev/)                  | UI components with React Compiler               |
| [TypeScript 5](https://www.typescriptlang.org/) | Type-safe development                           |
| [Tailwind CSS 4](https://tailwindcss.com/)      | Utility-first styling                           |
| [Radix UI](https://www.radix-ui.com/)           | Accessible, unstyled UI primitives              |
| [shadcn/ui](https://ui.shadcn.com/)             | Pre-built component library                     |
| [Zustand](https://zustand.docs.pmnd.rs/)        | Client-side state management                    |
| [SQLite](https://www.sqlite.org/)               | Lightweight local database (via better-sqlite3) |
| [dnd-kit](https://dndkit.com/)                  | Drag-and-drop for Kanban board                  |
| [Lucide Icons](https://lucide.dev/)             | Beautiful icon set                              |

### Project Structure

```
mission-control/
├── bin/
│   └── cli.mjs              # npx entry point & setup wizard
├── plugins/                  # User-installed plugins
│   └── hello-world/          # Sample plugin
│       ├── plugin.json       # Manifest (name, slug, icon, entry)
│       └── index.js          # Pre-bundled JS component
├── src/
│   ├── app/
│   │   ├── page.tsx          # Main dashboard (Kanban, Agents, Missions)
│   │   ├── globals.css       # Design tokens & theme variables
│   │   └── api/
│   │       ├── tasks/        # CRUD + dispatch + planning + testing + orchestration
│   │       ├── agents/       # Agent listing from gateway
│   │       ├── missions/     # Mission management
│   │       ├── activity/     # Activity log feed
│   │       ├── plugins/      # Plugin list, enable/disable, bundles, settings
│   │       ├── settings/     # Workflow role settings
│   │       ├── who-working/  # Active worker snapshot
│   │       └── openclaw/     # Gateway status, tools, logs, device-pair, usage
│   ├── components/
│   │   ├── board/            # KanbanBoard, TaskCard, PlanningTab
│   │   ├── layout/           # Sidebar, Header, LiveTerminal, PluginIcon
│   │   ├── modals/           # CreateTaskModal, DispatchModal, TaskDetailModal
│   │   ├── views/            # Panel views (settings, who-working, plugins, chat, etc.)
│   │   └── ui/               # shadcn primitives (Button, Dialog, Select, etc.)
│   ├── hooks/
│   │   ├── useSSE.ts         # Server-Sent Events client
│   │   └── usePlugins.ts     # Plugin loader & registry
│   └── lib/
│       ├── db.ts             # SQLite database & schema
│       ├── migrations.ts     # Schema migrations (001–009)
│       ├── store.ts          # Zustand client state store
│       ├── orchestrator.ts   # Multi-agent orchestration engine
│       ├── plugins.ts        # Server-side plugin scanner & cache
│       ├── plugin-db.ts      # Plugin enable/disable & settings DB
│       ├── plugin-types.ts   # Plugin type definitions
│       ├── who-working.ts    # Active worker detection & stall analysis
│       └── openclaw-client.ts # WebSocket client for gateway
├── data/                     # SQLite database (auto-created)
└── public/                   # Static assets
```

---

## 📚 API Reference

Mission Control exposes REST API endpoints for programmatic access:

### Tasks

| Method   | Endpoint                              | Description                                           |
| -------- | ------------------------------------- | ----------------------------------------------------- |
| `GET`    | `/api/tasks`                          | List all tasks (filterable by status, agent, mission) |
| `POST`   | `/api/tasks`                          | Create a new task                                     |
| `PATCH`  | `/api/tasks`                          | Update task fields (status, priority, assignment)     |
| `DELETE` | `/api/tasks`                          | Delete a task                                         |
| `POST`   | `/api/tasks/dispatch`                 | Dispatch a task to an AI agent                        |
| `GET`    | `/api/tasks/check-completion`         | Run completion gate checks on in-progress tasks       |
| `GET/POST` | `/api/tasks/comments`               | List or add task comments                             |

### Planning

| Method   | Endpoint                              | Description                                           |
| -------- | ------------------------------------- | ----------------------------------------------------- |
| `GET`    | `/api/tasks/{id}/planning`            | Get planning state (messages, spec, status)           |
| `POST`   | `/api/tasks/{id}/planning`            | Start a planning session                              |
| `DELETE` | `/api/tasks/{id}/planning`            | Cancel planning and reset to inbox                    |
| `GET`    | `/api/tasks/{id}/planning/poll`       | Poll for new planner messages / spec completion       |
| `POST`   | `/api/tasks/{id}/planning/answer`     | Answer a planner clarifying question                  |
| `POST`   | `/api/tasks/{id}/planning/approve`    | Approve the spec and dispatch to an agent             |
| `POST`   | `/api/tasks/{id}/planning/revise`     | Send revision feedback to the planner                 |

### Orchestration & Testing

| Method   | Endpoint                              | Description                                           |
| -------- | ------------------------------------- | ----------------------------------------------------- |
| `POST`   | `/api/tasks/{id}/orchestrate`         | Trigger orchestrator evaluation for a task            |
| `POST`   | `/api/tasks/{id}/test`                | Run the tester agent against a completed task         |
| `POST`   | `/api/tasks/rework`                   | Send a task back to the assigned agent with feedback  |

### Plugins

| Method   | Endpoint                              | Description                                           |
| -------- | ------------------------------------- | ----------------------------------------------------- |
| `GET`    | `/api/plugins`                        | List discovered plugins (`?rescan=1` to refresh)      |
| `POST`   | `/api/plugins`                        | Enable or disable a plugin                            |
| `GET`    | `/api/plugins/{slug}/bundle`          | Serve a plugin's JS bundle                            |
| `GET`    | `/api/plugins/{slug}/settings`        | Get plugin-specific settings                          |
| `PATCH`  | `/api/plugins/{slug}/settings`        | Update plugin-specific settings                       |

### Other

| Method   | Endpoint                              | Description                                           |
| -------- | ------------------------------------- | ----------------------------------------------------- |
| `GET`    | `/api/agents`                         | List connected agents from gateway                    |
| `POST`   | `/api/agents`                         | Create a new agent in OpenClaw                        |
| `GET`    | `/api/missions`                       | List all missions                                     |
| `POST`   | `/api/missions`                       | Create a new mission                                  |
| `GET`    | `/api/activity`                       | Get recent activity log                               |
| `GET`    | `/api/who-working`                    | Get active workers with stall detection               |
| `GET`    | `/api/models`                         | List available AI models from gateway                 |
| `GET/PUT`| `/api/settings/workflow`              | Get or update workflow role settings                  |
| `GET`    | `/api/openclaw/status`                | Check gateway connection status                       |
| `GET`    | `/api/openclaw/tools`                 | List available tools from gateway                     |
| `GET`    | `/api/openclaw/logs`                  | Retrieve gateway logs                                 |
| `GET`    | `/api/openclaw/usage`                 | Get usage/cost data from gateway                      |
| `POST`   | `/api/openclaw/device-pair`           | Approve pending device pairing requests               |
| `GET`    | `/api/events/stream`                  | SSE stream for real-time updates                      |
| `POST`   | `/api/chat`                           | Send a message to an AI agent via chat                |

---

## 🤝 Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/your-username/openclaw.git`
3. **Create a branch**: `git checkout -b feature/your-feature`
4. **Make changes** and test locally
5. **Submit a Pull Request**

### Development

```bash
# Install dependencies
npm install

# Start dev server with hot-reload
npm run dev

# Run linter
npm run lint

# Production build
npm run build
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

## 🔗 Links

- [OpenClaw Framework](https://github.com/openclaw/openclaw) — The AI agent framework
- [OpenClaw Website](https://openclaw.ai/) — Official website
- [Report a Bug](https://github.com/openclaw/openclaw/issues) — Found an issue? Let us know
- [Request a Feature](https://github.com/openclaw/openclaw/issues) — Have an idea? We'd love to hear it

---

<p align="center">
  Built with ❤️ for the AI agent community
</p>
