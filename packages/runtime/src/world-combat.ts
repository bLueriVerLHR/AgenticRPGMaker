/**
 * On-map real-time combat system (ADR-009 §5, S4).
 *
 * Zelda-minimal, grid-step based: the player's confirm key is a sword swing
 * toward the facing tile; chasing enemies step on the same grid and deal
 * contact damage when their next step would enter the player's tile; a
 * stationary turret fires a straight projectile every 2.4 s within 8 tiles
 * along its row/column. HP, i-frames, knock-back and the death flow live in
 * the scene (via the deps callbacks) — this module owns enemies,
 * projectiles, and their AI ticks, all in world (global) tile coordinates.
 *
 * Freeze gate (ADR-009 §5.5) is external: the scene skips `update()` while
 * a dialogue box or a CG is active.
 */
import type { SceneGraph, Vec2, WorldData } from "@agenticrpg/core";
import { GameObject, Transform, type CombatType } from "@agenticrpg/core";

import { DIRECTION_VECTORS, type InputDirection } from "./input.js";
import type { Logger } from "./logger.js";
import { createNoopLogger } from "./logger.js";

export interface CombatantView {
  /** World-document combatant id (the save's defeatedIds entry). */
  docId: string;
  chunkId: string;
  entityId: string;
  type: string;
  /** Global tile position. */
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  behavior: "chase" | "turret";
  alive: boolean;
}

export interface ProjectileView {
  x: number;
  y: number;
}

/** What the combat system needs from the surrounding world scene. */
export interface CombatSystemDeps {
  world: WorldData;
  sceneGraph: SceneGraph;
  logger?: Logger;
  /** The player's global tile position. */
  playerTile(): Vec2;
  /** The player's facing direction. */
  playerDirection(): InputDirection;
  /** Tile solidity: world bounds, solids, NPCs, other combatants. */
  isTileBlocked(tile: Vec2): boolean;
  /** Apply `amount` damage to the player (scene owns HP/i-frames/death). */
  applyDamageToPlayer(amount: number): void;
  /** A combatant died: persist a defeated id + trigger the battle autosave. */
  onCombatantDefeated(chunkId: string, combatantId: string): void;
  /** Play a combat sfx ref. */
  sfx(ref: string): void;
}

const PROJECTILE_STEP_SECONDS = 0.35;
const PROJECTILE_MAX_TILES = 8;
const TURRET_FIRE_INTERVAL_SECONDS = 2.4;
const ATTACK_COOLDOWN_SECONDS = 0.35;
const HIT_FLASH_SECONDS = 0.15;
const PLAYER_ATTACK_DAMAGE = 1;

interface CombatantState extends CombatantView {
  speed: number;
  /** Step accumulator (steps per `speed`). */
  stepAccum: number;
  /** Turret: seconds until the next shot. */
  fireIn: number;
  /** Blink white for this many seconds after a hit. */
  flash: number;
  /** Projectile owned by this combatant (turret only, one at a time). */
  projectile: ProjectileState | null;
}

interface ProjectileState extends ProjectileView {
  dx: number;
  dy: number;
  originX: number;
  originY: number;
  accum: number;
}

export class CombatSystem {
  private readonly world: WorldData;
  private readonly sceneGraph: SceneGraph;
  private readonly deps: CombatSystemDeps;
  private readonly logger: Logger;

  private readonly combatants = new Map<string, CombatantState>(); // entityId → state
  private readonly byDocId = new Map<string, CombatantState>(); // docId → state
  private attackCooldown = 0;

  constructor(deps: CombatSystemDeps) {
    this.world = deps.world;
    this.sceneGraph = deps.sceneGraph;
    this.deps = deps;
    this.logger = deps.logger ?? createNoopLogger();
  }

  /** Spawn every not-yet-defeated combatant of a resident chunk. */
  spawnForChunk(chunkId: string): void {
    const chunk = this.world.chunks.find((c) => c.id === chunkId);
    if (chunk === undefined) {
      return;
    }
    for (const def of chunk.combatants) {
      if (this.byDocId.has(def.id)) {
        continue; // already alive in this session
      }
      const type = this.world.combatTypes[def.type];
      if (type === undefined) {
        this.logger.warn("combat: unknown combatant type", { type: def.type });
        continue;
      }
      const entityId = `combatant:${chunkId}:${def.id}`;
      const entity = new GameObject({ id: entityId, name: def.id, layer: 3 });
      entity.addComponent(
        new Transform({
          x: chunk.col * this.world.chunkSize + def.x,
          y: chunk.row * this.world.chunkSize + def.y,
        }),
      );
      this.sceneGraph.addEntity(entity);
      const state: CombatantState = {
        docId: def.id,
        chunkId,
        entityId,
        type: def.type,
        x: entity.getComponent("transform")!.x,
        y: entity.getComponent("transform")!.y,
        hp: type.hp,
        maxHp: type.hp,
        behavior: type.behavior,
        alive: true,
        speed: type.speed,
        stepAccum: 0,
        fireIn: TURRET_FIRE_INTERVAL_SECONDS,
        flash: 0,
        projectile: null,
      };
      this.combatants.set(entityId, state);
      this.byDocId.set(def.id, state);
      this.logger.info("combat: spawned", { id: def.id, type: def.type, at: [state.x, state.y] });
    }
  }

  /** Remove a chunk's combatants + projectiles (chunk eviction). */
  despawnForChunk(chunkId: string): void {
    for (const state of [...this.combatants.values()]) {
      if (state.chunkId !== chunkId) {
        continue;
      }
      this.combatants.delete(state.entityId);
      this.byDocId.delete(state.docId);
      this.sceneGraph.removeEntity(state.entityId);
    }
  }

  /** Snapshot of every alive combatant (tests / HUD extras). */
  views(): CombatantView[] {
    return [...this.combatants.values()]
      .filter((c) => c.alive)
      .map((c) => ({
        docId: c.docId,
        chunkId: c.chunkId,
        entityId: c.entityId,
        type: c.type,
        x: c.x,
        y: c.y,
        hp: c.hp,
        maxHp: c.maxHp,
        behavior: c.behavior,
        alive: true,
      }));
  }

  /** Projectile snapshot (tests / render). */
  projectiles(): ProjectileView[] {
    const out: ProjectileView[] = [];
    for (const state of this.combatants.values()) {
      if (state.projectile !== null) {
        out.push({ x: state.projectile.x, y: state.projectile.y });
      }
    }
    return out;
  }

  /** The combatant standing on a global tile (or null). */
  atTile(tile: Vec2): CombatantView | null {
    for (const state of this.combatants.values()) {
      if (state.alive && state.x === tile.x && state.y === tile.y) {
        return state;
      }
    }
    return null;
  }

  /**
   * Player sword toward the facing tile. Returns true (press consumed) only
   * when an actual swing at a combatant happened — facing an NPC/tile falls
   * through to the scene's interaction (one key for talk + attack).
   */
  attack(): boolean {
    if (this.attackCooldown > 0) {
      return false;
    }
    const facing = DIRECTION_VECTORS[this.deps.playerDirection()];
    const player = this.deps.playerTile();
    const target: Vec2 = { x: player.x + facing.x, y: player.y + facing.y };
    const enemy = this.atTile(target);
    if (enemy === null || !enemy.alive) {
      return false; // nothing to hit: the press is free for interaction
    }
    this.attackCooldown = ATTACK_COOLDOWN_SECONDS;
    const state = this.combatants.get(enemy.entityId);
    if (state === undefined) {
      return true;
    }
    this.deps.sfx("sword");
    state.hp -= PLAYER_ATTACK_DAMAGE;
    state.flash = HIT_FLASH_SECONDS;
    this.deps.sfx("hit");
    this.logger.info("combat: hit", { id: state.docId, hp: state.hp });
    if (state.hp <= 0) {
      this.defeat(state);
    }
    return true;
  }

  /** Advance enemies and projectiles by `dt` seconds. */
  update(dt: number): void {
    if (this.attackCooldown > 0) {
      this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    }
    const player = this.deps.playerTile();
    for (const state of this.combatants.values()) {
      if (!state.alive) {
        continue;
      }
      if (state.flash > 0) {
        state.flash = Math.max(0, state.flash - dt);
      }
      if (state.behavior === "chase") {
        this.updateChase(state, dt, player);
      } else if (state.behavior === "turret") {
        state.fireIn -= dt;
        if (state.fireIn <= 0 && state.projectile === null) {
          this.fireTurret(state, player);
        }
      }
      this.updateProjectile(state, player, dt);
    }
  }

  /** Public test hook: make a turret fire immediately. */
  fireNow(docId: string): void {
    const state = this.byDocId.get(docId);
    if (state !== undefined && state.behavior === "turret" && state.alive) {
      this.fireTurret(state, this.deps.playerTile());
    }
  }

  clear(): void {
    for (const state of this.combatants.values()) {
      this.sceneGraph.removeEntity(state.entityId);
    }
    this.combatants.clear();
    this.byDocId.clear();
    this.attackCooldown = 0;
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private updateChase(state: CombatantState, dt: number, player: Vec2): void {
    state.stepAccum += dt * state.speed;
    while (state.stepAccum >= 1 && state.alive) {
      state.stepAccum -= 1;
      const dx = Math.sign(player.x - state.x);
      const dy = Math.sign(player.y - state.y);
      const candidates: Vec2[] =
        dx !== 0 && dy !== 0
          ? [
              { x: state.x + dx, y: state.y },
              { x: state.x, y: state.y + dy },
            ]
          : dx !== 0
            ? [{ x: state.x + dx, y: state.y }]
            : dy !== 0
              ? [{ x: state.x, y: state.y + dy }]
              : [];
      const stepTo = candidates.find((tile) => !this.deps.isTileBlocked(tile));
      if (stepTo === undefined) {
        return; // boxed in; stay
      }
      if (stepTo.x === player.x && stepTo.y === player.y) {
        // Contact: entering the player's tile deals damage instead (ADR-009 §5.1).
        this.deps.applyDamageToPlayer(this.combatType(state).damage);
        this.logger.debug("combat: contact", { id: state.docId });
        return;
      }
      state.x = stepTo.x;
      state.y = stepTo.y;
      const transform = this.sceneGraph.getEntityById(state.entityId)?.getComponent("transform");
      transform?.setPosition(stepTo.x, stepTo.y);
    }
  }

  private fireTurret(state: CombatantState, player: Vec2): void {
    const dist = Math.max(Math.abs(player.x - state.x), Math.abs(player.y - state.y));
    if (dist > PROJECTILE_MAX_TILES) {
      state.fireIn = TURRET_FIRE_INTERVAL_SECONDS;
      return; // out of range: no shot, retry later
    }
    const dx = Math.sign(player.x - state.x);
    const dy = Math.sign(player.y - state.y);
    const axis = Math.abs(player.x - state.x) >= Math.abs(player.y - state.y) ? "x" : "y";
    const projectile: ProjectileState = {
      x: state.x,
      y: state.y,
      originX: state.x,
      originY: state.y,
      dx: axis === "x" ? dx : 0,
      dy: axis === "y" ? dy : 0,
      accum: 0,
    };
    state.projectile = projectile;
    state.fireIn = TURRET_FIRE_INTERVAL_SECONDS;
    this.deps.sfx("hit");
    this.logger.debug("combat: turret fired", { id: state.docId, axis });
  }

  private updateProjectile(state: CombatantState, player: Vec2, dt: number): void {
    const projectile = state.projectile;
    if (projectile === null) {
      return;
    }
    projectile.accum += dt;
    while (projectile.accum >= PROJECTILE_STEP_SECONDS) {
      projectile.accum -= PROJECTILE_STEP_SECONDS;
      projectile.x += projectile.dx;
      projectile.y += projectile.dy;
      const travelled = Math.max(
        Math.abs(projectile.x - projectile.originX),
        Math.abs(projectile.y - projectile.originY),
      );
      const tile: Vec2 = { x: projectile.x, y: projectile.y };
      if (this.deps.isTileBlocked(tile) || travelled > PROJECTILE_MAX_TILES) {
        state.projectile = null; // died on a wall / at range
        return;
      }
      if (tile.x === player.x && tile.y === player.y) {
        state.projectile = null;
        this.deps.applyDamageToPlayer(this.combatType(state).damage);
        this.logger.debug("combat: projectile hit", { id: state.docId });
        return;
      }
    }
  }

  private combatType(state: CombatantState): CombatType {
    return (
      this.world.combatTypes[state.type] ?? {
        hp: 1,
        damage: 1,
        behavior: "chase",
        speed: 0,
      }
    );
  }

  private defeat(state: CombatantState): void {
    state.alive = false;
    state.projectile = null;
    this.combatants.delete(state.entityId);
    this.byDocId.delete(state.docId);
    this.sceneGraph.removeEntity(state.entityId);
    this.deps.sfx("defeated");
    this.logger.info("combat: defeated", { id: state.docId, chunk: state.chunkId });
    this.deps.onCombatantDefeated(state.chunkId, state.docId);
  }
}
