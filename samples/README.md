# Samples

Runnable example maps, projects, and (later) generated `www` bundles that prove
the **editor → core → runtime → server** pipeline end to end (architecture
[06-architecture.md](../docs/06-architecture.md) §2).

## Layout

| Path | Purpose |
|---|---|
| `maps/*.map.json` | Sample maps in the versioned map format v1 ([ADR-003](../docs/04-adr/ADR-003.md)); used by the `packages/core` schema test suite and later phases. |

`town-square.map.json` is the P0 fixture: a small 8×6 map with two tile layers,
one event (two pages), variables, and switches — every field exercised against
the `map` schema in `packages/core`.