# AgenticRPGMaker

An agentic HTML5 RPG engine: a portable HTML5 game runtime, a Web-based editor ("Game Maker"), and a Linux C++ relay/hosting server.

AgenticRPGMaker is designed to be built *by agents, for agents*: the project follows a Write-Ahead-Log (WAL) workflow in which every feature is designed, documented, and agreed in the docs tree **before** any implementation begins, then the docs are corrected again after the work lands. The runtime targets portable HTML5 (including weak-device and JoiPlay constraints), with a Web editor for content authoring and a C++ relay/state-sync server for multiplayer and hosting.

## Documentation

See [docs/README.md](docs/README.md) — the single source of truth for the project: vision, open questions, WAL process, architecture, MVP plan, compatibility checklist, and Architecture Decision Records (ADRs).

## Status

**Phase A (design) complete & approved.** MVP implementation is next.

---

*Docs come before code. No feature starts before its design doc and ADR exist.*
