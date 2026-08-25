#!/usr/bin/env node
/**
 * AgenticRPGMaker — verify the deployment (P5 DoD, docs/07-mvp-plan.md §7).
 *
 * Starts the assembled `deploy/` server on a test port and checks, over real
 * HTTP:
 *   - `/` serves the game index.html (200, text/html)
 *   - `/js/runtime.js` serves the bundle (200, text/javascript)
 *   - `/editor/` serves the editor index (200, text/html) and its assets
 *   - static data (map/tileset/manifest/image) resolves with correct MIME
 *   - unknown paths → 404
 *   - path traversal (`..`, encoded `%2e%2e`, backslash, NUL) → 4xx
 *   - the `/ws` endpoint accepts an upgrade (101)
 *   - `--help` exits 0 and lists the flags; AGENTICRPG_PORT env is honoured
 *
 * The browser-level checks (docs/08 §5) still require a real browser / the
 * Playwright E2E runners; this script covers everything the C++ server and the
 * built artifacts can verify headlessly.
 *
 * Usage:
 *   node scripts/verify-deploy.mjs [--out <dir>] [--port <port>]
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const outDir = flagValue(args, "--out") ?? path.join(REPO_ROOT, "deploy");
const port = Number(flagValue(args, "--port") ?? 18100);
const BASE = `http://127.0.0.1:${port}`;

function flagValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

const results = [];
function report(step, ok, detail = "") {
  results.push({ step, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${step}${detail ? ` — ${detail}` : ""}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(urlPath, { method = "GET", headers = {} } = {}) {
  const res = await fetch(BASE + urlPath, { method, headers, redirect: "manual" });
  return { status: res.status, type: res.headers.get("content-type") ?? "" };
}

async function main() {
  if (!existsSync(path.join(outDir, "agenticrpg-server"))) {
    report(
      "deploy exists",
      false,
      `no agenticrpg-server in ${outDir} (run pnpm build:deploy first)`,
    );
    process.exit(1);
  }
  report("deploy layout", true, `${outDir}`);
  for (const rel of ["www/index.html", "www/js/runtime.js", "editor/index.html", "README.md"]) {
    if (!existsSync(path.join(outDir, rel))) {
      report(`deploy file ${rel}`, false, "missing");
      process.exit(1);
    }
  }
  report("deploy layout files", true, "www/, editor/, README.md present");

  // --help
  const { spawnSync } = await import("node:child_process");
  const help = spawnSync(path.join(outDir, "agenticrpg-server"), ["--help"], { encoding: "utf8" });
  const helpHasFlags =
    /--port/.test(help.stdout) &&
    /--www-root/.test(help.stdout) &&
    /--editor-root/.test(help.stdout);
  report(
    "--help",
    help.status === 0 && helpHasFlags,
    "exit 0, lists --port/--www-root/--editor-root",
  );

  // AGENTICRPG_PORT env (start briefly on a separate port, capture config,
  // kill). A distinct port avoids "address already in use" if the main server
  // from a previous run lingers on `port`.
  const envPort = port + 1;
  const envProc = spawn(
    path.join(outDir, "agenticrpg-server"),
    ["--www-root", "www", "--editor-root", "editor", "--log-level", "info"],
    {
      cwd: outDir,
      env: { ...process.env, AGENTICRPG_PORT: String(envPort) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let envLine = "";
  const envReady = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 5000);
    const onData = (chunk) => {
      envLine += chunk.toString();
      if (envLine.includes("listening on")) {
        clearTimeout(timer);
        resolve(true);
      }
    };
    envProc.stdout.on("data", onData);
    envProc.stderr.on("data", onData);
    envProc.on("exit", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
  envProc.kill("SIGTERM");
  await sleep(300);
  report(
    "AGENTICRPG_PORT env",
    envReady && envLine.includes(`port=${envPort}`),
    envLine.trim().split("\n").pop() ?? "no config output",
  );

  // Start the real server for HTTP checks.
  const server = spawn(
    path.join(outDir, "agenticrpg-server"),
    ["--www-root", "www", "--editor-root", "editor", "--port", String(port), "--log-level", "info"],
    { cwd: outDir, stdio: ["ignore", "pipe", "pipe"] },
  );
  let serverLog = "";
  server.stdout.on("data", (c) => (serverLog += c.toString()));
  server.stderr.on("data", (c) => (serverLog += c.toString()));
  await sleep(1200);

  try {
    // Bind address (VPS mode).
    report(
      "bind 0.0.0.0 (VPS mode)",
      /0\.0\.0\.0/.test(serverLog),
      `log: ${serverLog.trim().split("\n").pop() ?? ""}`,
    );

    // Positive serving + MIME.
    const checks = [
      ["/", 200, "text/html; charset=utf-8"],
      ["/js/runtime.js", 200, "text/javascript; charset=utf-8"],
      ["/editor/", 200, "text/html; charset=utf-8"],
      ["/data/manifest.json", 200, "application/json; charset=utf-8"],
      ["/data/maps/town-square.map.json", 200, "application/json; charset=utf-8"],
      ["/data/tilesets/placeholder.tileset.json", 200, "application/json; charset=utf-8"],
      ["/data/project.json", 200, "application/json; charset=utf-8"],
      ["/img/tilesets/placeholder.png", 200, "image/png"],
    ];
    for (const [urlPath, wantStatus, wantType] of checks) {
      const { status, type } = await request(urlPath);
      report(
        `serve ${urlPath}`,
        status === wantStatus && type.startsWith(wantType.split(";")[0]),
        `${status} ${type}`,
      );
    }

    // Editor asset (relativized URL).
    const html = await (await fetch(BASE + "/editor/index.html")).text();
    const asset = /src="(\.\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    if (asset) {
      const { status, type } = await request("/editor/" + asset);
      report(
        `editor asset ${asset}`,
        status === 200 && type.startsWith("text/javascript"),
        `${status} ${type}`,
      );
    } else {
      report(
        "editor asset reference",
        false,
        "no relative ./assets/ URL found in editor index.html",
      );
    }

    // 404s.
    for (const p of ["/nope.txt", "/editor/assets/missing.js"]) {
      const { status } = await request(p);
      report(`404 ${p}`, status === 404, `status ${status}`);
    }

    // Traversal / injection (all must be 4xx, never 200).
    const hostile = [
      "/../etc/passwd",
      "/%2e%2e/%2e%2e/etc/passwd",
      "/..%2f..%2fetc/passwd",
      "/..\\..\\etc\\passwd",
      "/%00",
      "/editor/../../server/src/main.cpp",
    ];
    for (const p of hostile) {
      const { status } = await request(p);
      report(`reject traversal ${p}`, status >= 400 && status < 500, `status ${status}`);
    }

    // WebSocket upgrade: fetch()/undici cannot send an Upgrade request, so use
    // a raw TCP socket and check the 101 response line.
    const { connect } = await import("node:net");
    const wsStatus = await new Promise((resolve) => {
      const sock = connect(port, "127.0.0.1", () => {
        sock.write(
          "GET /ws HTTP/1.1\r\n" +
            "Host: 127.0.0.1\r\n" +
            "Connection: Upgrade\r\n" +
            "Upgrade: websocket\r\n" +
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
            "Sec-WebSocket-Version: 13\r\n\r\n",
        );
      });
      sock.setTimeout(3000, () => {
        sock.destroy();
        resolve(null);
      });
      let data = "";
      sock.on("data", (chunk) => {
        data += chunk.toString();
        if (data.includes("\r\n")) {
          sock.destroy();
          resolve(parseInt(data.split("\r\n")[0].split(" ")[1] ?? "0", 10));
        }
      });
      sock.on("error", () => {
        sock.destroy();
        resolve(null);
      });
    });
    report("WS /ws upgrade", wsStatus === 101, `status ${wsStatus ?? "no response"}`);
  } finally {
    server.kill("SIGTERM");
    await sleep(300);
  }

  const failed = results.filter((r) => !r.ok);
  console.log("---");
  console.log(`verify-deploy: ${results.length} checks, ${failed.length} failed`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("verify-deploy failed:", error);
  process.exit(1);
});
