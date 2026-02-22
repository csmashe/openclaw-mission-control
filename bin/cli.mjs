#!/usr/bin/env node

import { createInterface } from "readline";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_ROOT = path.resolve(__dirname, "..");

// ─── Colors ──────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

// ─── Helpers ─────────────────────────────────────────────
function print(msg = "") {
  process.stdout.write(msg + "\n");
}

function banner() {
  print();
  print(
    `  ${c.cyan}${c.bold}╔══════════════════════════════════════════╗${c.reset}`
  );
  print(
    `  ${c.cyan}${c.bold}║${c.reset}   ${c.magenta}//  ${c.bold}MISSION CONTROL${c.reset}  ${c.dim}— Setup Wizard${c.reset}     ${c.cyan}${c.bold}║${c.reset}`
  );
  print(
    `  ${c.cyan}${c.bold}╚══════════════════════════════════════════╝${c.reset}`
  );
  print();
}

function ask(rl, question, defaultValue = "") {
  const suffix = defaultValue ? ` ${c.dim}(${defaultValue})${c.reset}` : "";
  return new Promise((resolve) => {
    rl.question(
      `  ${c.cyan}?${c.reset} ${question}${suffix}: ${c.dim}›${c.reset} `,
      (answer) => {
        resolve(answer.trim() || defaultValue);
      }
    );
  });
}

function maskToken(token) {
  if (!token || token.length < 8) return token;
  return token.slice(0, 4) + "•".repeat(token.length - 8) + token.slice(-4);
}

// ─── Main ────────────────────────────────────────────────
async function main() {
  banner();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // Prompt for configuration
    const gatewayUrl = await ask(
      rl,
      "OpenClaw Gateway URL",
      "ws://127.0.0.1:18789"
    );
    const gatewayToken = await ask(rl, "Gateway Token (from your gateway config)", "");
    const port = await ask(rl, "Dashboard Port", "3000");

    rl.close();
    print();

    // Validate
    if (!gatewayToken) {
      print(
        `  ${c.yellow}⚠${c.reset}  No gateway token provided — connection may fail if gateway requires one.`
      );
      print();
    }

    // Summary
    print(`  ${c.green}✓${c.reset} Configuration:`);
    print(`    ${c.dim}Gateway :${c.reset} ${gatewayUrl}`);
    print(
      `    ${c.dim}Token   :${c.reset} ${gatewayToken ? maskToken(gatewayToken) : c.dim + "none" + c.reset}`
    );
    print(`    ${c.dim}Port    :${c.reset} ${port}`);
    print();

    // Determine how to start the server
    // Next.js 16 standalone output is at .next/standalone/<pkg-dir>/server.js
    const standaloneDir = path.join(PKG_ROOT, ".next", "standalone");
    let standaloneServer = null;
    let standaloneAppDir = null;

    if (fs.existsSync(standaloneDir)) {
      // Find server.js recursively (Next.js nests it under the package directory name)
      const entries = fs.readdirSync(standaloneDir);
      for (const entry of entries) {
        const candidate = path.join(standaloneDir, entry, "server.js");
        if (fs.existsSync(candidate)) {
          standaloneServer = candidate;
          standaloneAppDir = path.join(standaloneDir, entry);
          break;
        }
      }
      // Fallback: server.js directly in standalone/
      if (!standaloneServer) {
        const direct = path.join(standaloneDir, "server.js");
        if (fs.existsSync(direct)) {
          standaloneServer = direct;
          standaloneAppDir = standaloneDir;
        }
      }
    }

    const hasStandalone = !!standaloneServer;

    // Set up environment
    const env = {
      ...process.env,
      OPENCLAW_GATEWAY_URL: gatewayUrl,
      OPENCLAW_GATEWAY_TOKEN: gatewayToken,
      OPENCLAW_API_TOKEN:
        process.env.OPENCLAW_API_TOKEN || gatewayToken,
      PORT: port,
      HOSTNAME: "0.0.0.0",
    };

    // Copy static files for standalone mode if needed
    if (hasStandalone && standaloneAppDir) {
      const staticSrc = path.join(PKG_ROOT, ".next", "static");
      const staticDest = path.join(standaloneAppDir, ".next", "static");
      if (fs.existsSync(staticSrc) && !fs.existsSync(staticDest)) {
        fs.cpSync(staticSrc, staticDest, { recursive: true });
      }

      // Copy public folder if exists
      const publicSrc = path.join(PKG_ROOT, "public");
      const publicDest = path.join(standaloneAppDir, "public");
      if (fs.existsSync(publicSrc) && !fs.existsSync(publicDest)) {
        fs.cpSync(publicSrc, publicDest, { recursive: true });
      }
    }

    print(
      `  ${c.green}✓${c.reset} Starting Mission Control on ${c.bold}http://localhost:${port}${c.reset}`
    );

    if (hasStandalone) {
      print(`    ${c.dim}mode: standalone (production)${c.reset}`);
    } else {
      print(`    ${c.dim}mode: development (next dev)${c.reset}`);
    }
    print();
    print(`  ${c.dim}Press Ctrl+C to stop.${c.reset}`);
    print();

    // Start the server
    let child;
    if (hasStandalone) {
      child = spawn("node", [standaloneServer], {
        cwd: standaloneAppDir,
        env,
        stdio: "inherit",
      });
    } else {
      // Fallback: run next dev (for local development / npm link testing)
      const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
      child = spawn(npxCmd, ["next", "dev", "--port", port], {
        cwd: PKG_ROOT,
        env,
        stdio: "inherit",
      });
    }

    // Graceful shutdown
    const shutdown = () => {
      print(`\n  ${c.yellow}⏻${c.reset}  Shutting down Mission Control...`);
      child.kill("SIGTERM");
      setTimeout(() => process.exit(0), 2000);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    child.on("exit", (code) => {
      process.exit(code ?? 0);
    });
  } catch (err) {
    rl.close();
    print(`  ${c.red}✗${c.reset}  Error: ${err.message}`);
    process.exit(1);
  }
}

main();
