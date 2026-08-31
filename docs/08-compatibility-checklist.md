# AgenticRPGMaker — Compatibility Checklist (Portable / Runtime)

> Status: **DRAFT — for the user to verify on real devices/browsers.** Part of the
> WAL docs; pairs with [ADR-008](./04-adr/ADR-008.md) (portable-first, multi-backend)
> and the decided portable target (Q1/RQ1, docs/02-open-questions.md). The editor
> (ADR-006) is **archived** (D20) — this checklist covers the **portable runtime**
> and the **data-first authoring** path.

## 1. What this checklist covers

The **portable build** is the RPG-Maker-style `www` folder (`index.html` + `data/` +
`js/` + `img/` + `audio/`) that must run on **any static host, any modern browser,
and JoiPlay-type mobile HTML runtimes** (Q1/RQ1, docs/01-vision.md §3). This document
states what the portable build must **avoid**, what constraints weak devices /
JoiPlay impose, and gives the **user a concrete verification procedure** for desktop
browsers and a real JoiPlay device.

**JoiPlay is a first-class target** (D21): it runs RPG Maker MV/MZ from their
`www` HTML5 folder (verified from JoiPlay's own FAQ), so our portable package is
exactly what JoiPlay executes. Browser and JoiPlay are **configurations of the same
runtime** — see [ADR-008](./04-adr/ADR-008.md).

## 2. Target matrix

| Target | What it is | Baseline |
|--------|-----------|----------|
| Chrome | Desktop evergreen | latest − 2 |
| Firefox | Desktop evergreen | latest − 2 |
| Safari | Desktop evergreen | latest − 2 |
| Edge | Desktop evergreen (Chromium) | latest − 2 |
| JoiPlay | Android app running RPG-Maker-style HTML games in an embedded WebView | A current-ish Android System WebView; **cannot be pinned to a version** → never rely on bleeding-edge APIs |

Because the JoiPlay WebView version cannot be pinned, the rule is: **if an API is not
in the conservative evergreen baseline, it is not used.**

## 3. What the portable build MUST AVOID

| # | API / technique | Why it is banned | Audit hint |
|---|-----------------|------------------|------------|
| 1 | **File System Access API** (`showOpenFilePicker`, `showSaveFilePicker`, `FileSystemFileHandle`, `FileSystemWritableFileStream`) | Chromium-only; absent in Firefox/Safari and most WebViews (vision §3.1). | `grep -rn "showOpenFilePicker\|showSaveFilePicker\|FileSystemFileHandle"` in the runtime bundle/source |
| 2 | **OPFS as a required path** (`navigator.storage.getDirectory`) | Origin-sandboxed and newer; WebView support is spotty. Saves use IndexedDB (RQ1); OPFS is never a requirement. | `grep -rn "getDirectory()"` |
| 3 | **Node-only APIs** (`fs`, `path`, `process`, `require`, `Buffer`, `node:…`) | Do not exist in the browser; must never leak into the runtime bundle. | `grep -rn "require(\\|process\\.\\|Buffer(\\|node:"` on the built bundle — **see `Buffer(` note below** |
| 4 | **Experimental / flag-gated / origin-trial web APIs** | Anything not yet standard or behind a flag breaks older WebViews silently. | Keep a dependencies review: no `--experimental` or origin-trial APIs |
| 5 | **`fetch()` of local `file://` paths** | Blocked/inconsistent across browsers; the portable build is served over HTTP(S) by the C++ launcher or a static host, never relied on `file://` fetch. | Grep for `file://` URLs in the bundle |
| 6 | **Service Workers as a required feature** | JoiPlay WebView support is inconsistent; the portable build must work without them. | No hard dependency on `navigator.serviceWorker` |
| 7 | **Bleeding-edge JS/TS features without transpilation** | Old WebViews choke on newest syntax. Define a conservative baseline (ES2019-era) and transpile. | Keep `tsconfig`/build targets aligned to the baseline |
| 8 | **WebGL2-only / WebGPU** | Weak devices may lack WebGL2; WebGPU is out of scope. The renderer is WebGL (WebGL1-compatible subset) with an automatic **Canvas2D fallback** (RQ2, docs/02-open-questions.md). | Feature-detect; never hard-require WebGL2 |
| 9 | **Web Audio advanced features** (AudioWorklet, spatialisation, etc.) | MVP **audio is deferred**; when added, only Web Audio **basics** (see §4). | — |

> **Note on the `Buffer(` pattern (verified against implementation, P6):** the
> `Buffer(` grep in row 3 above is a **known false-positive source** — it also
> matches the **legitimate WebGL API** `gl.createBuffer()` / `gl.bindBuffer()`
> (used by `packages/renderer/src/webgl/webgl-renderer.ts`), which is **not** Node's
> `Buffer`. The actual banned-API smoke check
> (`scripts/build-www.mjs`, `BANNED_PATTERNS`) therefore omits a `Buffer(` pattern —
> it checks the real Node-specific signals (`require(`, `process.`, `node:`,
> `file://`, plus File System Access/OPFS APIs) so the D1/D2 run stays correct in
> intent. When grepping manually, use `\bBuffer\b` or check for Node's `Buffer`
> specifically, and treat `createBuffer`/`bindBuffer` as false positives.

## 4. JoiPlay / weak-device constraints

These constraints apply to the portable runtime wherever it runs, and are especially
binding on JoiPlay/weak devices.

### 4.1 Rendering (RQ2)

- **Capability detection before context creation**; **WebGL by default**, automatic
  **Canvas2D fallback renderer**, both sharing the **same upper layers**.
- MVP renderer uses a **WebGL1-compatible subset** (no WebGL2-only features).
- Keep texture atlas sizes ≤ 2048 px for weak GPUs; avoid relying on
  `image-rendering: pixelated`/mipmap behavior.
- Respect `devicePixelRatio` with a cap (avoid rasterising at absurd DPR on phones).

### 4.2 Audio (deferred, but note the basics)

- **MVP has no audio dependency.** When audio lands, use **only Web Audio basics**:
  `AudioContext` + `createBufferSource` + `decodeAudioData`, playback through a
  simple mixer.
- **Resume the `AudioContext` on a user gesture** (autoplay policies block
  unattended start on mobile).
- Degrade **silently** (no crash, log a warn) when `AudioContext` is unavailable or
  suspended.

### 4.3 Fonts — system fonts only

- **No remote webfonts, no `@font-face` fetches, no `FontFace` API as a
  requirement.** Text uses the system font stack (`system-ui`, `sans-serif`,
  `serif`, `monospace`) — nothing to download, nothing that can block first paint on
  a weak device.
- Keep text rendering simple (no exotic glyphs expected).

### 4.4 Input

- JoiPlay has **no physical keyboard** → the runtime must provide **on-screen
  controls** (virtual D-pad + confirm/cancel buttons) that work with touch events.
- Keyboard (arrow keys + Z/Enter/X/Esc) remains supported on desktop.

### 4.5 Memory / CPU / assets

- Keep per-map asset sizes small; load lazily; avoid huge JSON maps in a single
  parse; use typed arrays for map data where cheap.
- Weak devices stall on layout thrash and large canvas draw calls — keep draw calls
  and layer count modest; the Canvas2D fallback is the floor the game must still
  feel playable on.

### 4.6 Networking (multiplayer client)

- The client uses **standard `WebSocket`** (per ADR-004) — well-supported in
  WebViews; the server must be reachable (no NAT punch-through/P2P per RQ4), and
  `wss://` is the phase-2 concern for public deployment.
- Heartbeat (`ping`/`pong` per ADR-004) keeps weak-device connections alive across
  WebView suspension.

### 4.7 Storage

- **Saves = IndexedDB (RQ1)**; `localStorage` fallback for small data where
  acceptable; OPFS never required (§3.2). Handle IndexedDB unavailable/cleared
  gracefully (warn + export hint, never crash).

## 5. User verification checklist

Run **every** item before a release. Record pass/fail per row (and note the
device/browser + version).

### A. Desktop browsers — Chrome, Firefox, Safari, Edge (each!)

| # | Step | Pass criteria |
|---|------|---------------|
| A1 | Serve the `www` folder from a static host (e.g. `python3 -m http.server 8000`, or the C++ launcher) and open `index.html`. | Game boots to title/map; no script errors in console. |
| A2 | Walk the player (arrow keys/WASD + confirm buttons) into tiles, walls, and NPCs. | Movement, collision, and facing all correct. |
| A3 | Trigger a dialogue event. | Dialogue opens/advances/closes correctly. |
| A4 | Play a session, then reload the page / reopen the game. | Saves persist (IndexedDB); state restored. |
| A5 | Open DevTools → Console. | **Zero errors/warnings from our code** (expected: none). |
| A6 | DevTools → Application → check renderer context. | WebGL context created (or Canvas2D fallback engaged — verify fallback by disabling WebGL in browser flags at least once). |
| A7 | Resize the window; use DevTools mobile viewport; zoom. | Layout adapts; no clipping/crash; virtual controls appear when touch-only. |
| A8 | Tab away for 30 s, come back; suspend/resume. | Game resumes; frame timing recovers; no crash. |

### B. Real device — JoiPlay

| # | Step | Pass criteria |
|---|------|---------------|
| B1 | Copy the `www` folder onto the device; import/run it in JoiPlay pointing at `index.html`. | Game boots; title/map render. |
| B2 | Walk with the **on-screen D-pad**; interact with touch. | Movement, collision, dialogue all work by touch. |
| B3 | Force/observe rendering capability. | If WebGL is weak/unavailable, the **Canvas2D fallback** engages automatically and the game is still playable (RQ2). |
| B4 | Play, exit to the JoiPlay menu, relaunch. | Saves persist (IndexedDB) and load. |
| B5 | Leave it running ~5 min (screen may sleep). | No crash; returning resumes; heartbeat reconnects if needed (check server logs). |
| B6 | System fonts render all text (title, dialogue, chat, menus). | No missing/tofu glyphs. |
| B7 | **IndexedDB on the JoiPlay WebView** (pending real-device verification, D21). | Saves survive a relaunch and are re-created if storage is cleared; the runtime logs a warn and never crashes when IndexedDB is unavailable/cleared (§4.7). |

### C. Multiplayer session (desktop + device)

| # | Step | Pass criteria |
|---|------|---------------|
| C1 | Start `agenticrpg-server` (ADR-005); open the game in **two** browser windows (same or different machines) and join the same room. | Both see a `welcome` with the other player listed. |
| C2 | Move player 1; watch player 2. | Player 2's avatar moves in real time (~10 Hz per ADR-004). |
| C3 | Send chat from both sides. | Chat appears on both clients in order; server rate-limits apply. |
| C4 | Close player 1 (leave). | Player 2 gets a `leave`; player 1 is removed from the room. |
| C5 | Run one session on JoiPlay + one on desktop in the same room. | Both see each other; controls work on both. |
| C6 | Leave both clients idle 3+ min (heartbeat). | No spurious disconnects; server logs show healthy ping/pong. |

### D. Anti-regression / build hygiene

| # | Step | Pass criteria |
|---|------|---------------|
| D1 | Run the banned-API greps from §3 against the **built** runtime bundle. | Zero hits. |
| D2 | Confirm the runtime bundle has no Node-only references and no `file://` fetches. | Zero hits. |
| D3 | Run the full test suite (unit + E2E) on the same commit (WAL doc §3). | All green before this checklist is considered passing. |
| D4 | Check server logs after each session above. | Mandatory log entries present; **no secrets, no chat text** logged (ADR-005 policy). |

## 6. How to record results

Append a dated result block to this file (or the project log,
[docs/05-project-log.md](./05-project-log.md)) when a release is verified:

```md
### Verified 2026-MM-DD
- Chrome <ver>: A1–A8 ✅ · Firefox <ver>: … · Safari <ver>: … · Edge <ver>: …
- JoiPlay on <device/WebView ver>: B1–B6 ✅
- Multiplayer: C1–C6 ✅ · Build hygiene: D1–D4 ✅
- Notes / failures: …
```

---

*Pairs with [ADR-004](./04-adr/ADR-004.md), [ADR-005](./04-adr/ADR-005.md) and
[ADR-008](./04-adr/ADR-008.md); decided by Q1/RQ1, Q3/RQ2, Q5, D21 in
[docs/02-open-questions.md](./02-open-questions.md).*