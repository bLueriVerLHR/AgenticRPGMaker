# AgenticRPGMaker — Vision

> **status: DRAFT — pending consensus**
> This document records the user's stated vision as of kickoff. It is *not* a settled
> spec. Several premises are explicitly under discussion (see
> [02-open-questions.md](./02-open-questions.md)); nothing here is binding until the
> leader confirms it.

## 1. What it is

An **HTML5 RPG game engine** called **AgenticRPGMaker**, built with **AI-agentic
development support**. The tooling and the development workflow are themselves
agent-assisted: the engine is authored by an AI team following the WAL process,
and the product is meant to make building RPGs agent-friendly.

## 2. The game is HTML

The game itself is **HTML, playable in a browser** (no native app required to
play a finished game).

### 2.1 Single-player simplicity

Single-player should be **as simple as RPG Maker MZ/MV**: "you can just run the
HTML game" — double-click and play, no server install, no console, no deployment.

### 2.2 Multiplayer

For **multiplayer**, a **C++ server** is launched to **exchange data between
players** (position/state sync; details of server role are an open question — see
Q2 in [02-open-questions.md](./02-open-questions.md)).

## 3. OPEN QUESTION: is a C++ runtime required for single-player?

> ⚠️ **This is an OPEN QUESTION under discussion by the leader — do NOT treat it
> as settled fact.**

The user asserts that a **C++ runtime is also a must for single-player**, because
**browsers have policies restricting local-resource access** (a plain
`file://`-opened HTML page cannot freely read/write the user's local files).

### What browsers actually can and cannot do (facts, for the discussion)

| Capability | What it is | Availability |
|------------|-----------|--------------|
| **File System Access API** (`showOpenFilePicker`, `showSaveFilePicker`, `FileSystemFileHandle`) | Real read/write of local files with user consent. | **Chromium-only** for real local files (Chrome/Edge/Opera). Not in Firefox or Safari. |
| **OPFS — Origin Private File System** (`navigator.storage.getDirectory()`) | Sandboxed file-like storage. | **Universal** (all modern browsers), but **sandboxed to the origin** — data is invisible to the user's normal file system and tied to the site's origin. |
| `file://` protocol | Opening an HTML file directly. | Works, but many APIs (fetch of local files, storage, workers) are restricted or inconsistent. |
| Local web server (`localhost`) | Serves the game from a real server on the loopback interface. | Universal; this is what RPG Maker MZ/MV-style tools effectively rely on (or an embedded webview). |

### Why the question matters

If OPFS / File System Access API *could* cover the single-player storage needs,
a **pure-HTML single-player without C++** becomes plausible (option (d) in Q1),
which **contradicts the user's stated premise** — hence the premise is being
challenged rather than accepted. The leader is driving this discussion.

## 4. Game Maker (level / scene editor)

The **Game Maker** (level/scene editor) is a **web application launched by C++**,
which **serves the HTML pages** for the editor. So the C++ component doubles as
both a launcher/server and (potentially) the multiplayer host.

## 5. Engineering rules (hard requirements from the user)

These are non-negotiable process requirements, regardless of the open questions:

1. **Keep documentation continuously.** Docs are a first-class artifact, maintained
   alongside the work — never written once and abandoned.
2. **WAL-style.** Docs are written **before** true code writing begins, and the docs
   are **fixed after the real task finishes** (see [03-wal-process.md](./03-wal-process.md)).
3. **Logs are mandatory for debugging.** Every component logs sufficiently well that
   a debugging session does not start from zero.
4. **Tests are mandatory** — before any release, and before any **real-environment
   run**.

## 6. Out of scope for now

Explicitly not decided yet (these are future phases, not today's target): matchmaking,
animation editor, cloud saves (see Q6 — MVP scope — in [02-open-questions.md](./02-open-questions.md)).

---

*Status history: created as DRAFT at kickoff. To be revised once Q1–Q6 are decided.*
