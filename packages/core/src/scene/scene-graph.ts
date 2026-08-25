/**
 * Scene graph (ADR-001).
 *
 * Entities live in a tree: the `SceneGraph` owns the root, a by-id registry,
 * and the queries (by id, by component type, by culling group, in layer
 * order). World transforms accumulate across parent/child chains. The scene is
 * **driven by the map data model** (ADR-003): `SceneGraph.fromMap(map)` builds
 * the player entity plus one entity per map event, so editor preview and
 * runtime construct identical worlds from the same `MapData` document.
 */
import { BehaviorComponent } from "../entity/behavior-component.js";
import { Collider } from "../entity/collider.js";
import type { ComponentTypeName } from "../entity/game-object.js";
import { GameObject } from "../entity/game-object.js";
import { Sprite } from "../entity/sprite.js";
import { Transform } from "../entity/transform.js";
import type { Vec2 } from "../entity/transform.js";
import type { Direction, MapData, MapEvent } from "../schema/index.js";

export interface SceneGraphOptions {
  /** Initial player position in tile units (defaults to the map origin). */
  playerPosition?: Vec2;
  /** Initial player facing direction. */
  playerDirection?: Direction;
  /** Player sprite texture reference. */
  playerSprite?: string;
  /** Default layer for placed event entities. */
  eventLayer?: number;
}

/** The id used for the scene's player entity (a stable convention). */
export const PLAYER_ENTITY_ID = "player";

export class SceneGraph {
  readonly root: GameObject;

  private readonly byId = new Map<string, GameObject>();

  /** Builds an empty scene with a root node. */
  constructor(root?: GameObject) {
    this.root = root ?? new GameObject({ id: "root", name: "Root" });
    this.index(this.root);
  }

  /**
   * Builds a scene from a map document (ADR-003): a player entity plus one
   * entity per map event (Transform at the event's tile position, Sprite when
   * the event references one). Events with a sprite also get a
   * `BehaviorComponent` seam for NPC strategies.
   */
  static fromMap(map: MapData, options: SceneGraphOptions = {}): SceneGraph {
    const scene = new SceneGraph();

    const player = new GameObject({
      id: PLAYER_ENTITY_ID,
      name: "Player",
      layer: 1,
    });
    player.addComponent(
      new Transform({
        x: options.playerPosition?.x ?? 0,
        y: options.playerPosition?.y ?? 0,
        direction: options.playerDirection ?? "down",
      }),
    );
    player.addComponent(new Sprite({ texture: options.playerSprite ?? "characters/player" }));
    player.addComponent(
      new Collider({
        shape: { kind: "rect", width: 1, height: 1, offsetX: 0, offsetY: 0 },
        solid: true,
      }),
    );
    scene.addEntity(player);

    for (const event of map.events) {
      scene.addEntity(scene.buildEventEntity(event, options.eventLayer ?? 2));
    }
    return scene;
  }

  /** Builds an entity for a map event (does not register it). */
  buildEventEntity(event: MapEvent, layer = 2): GameObject {
    const entity = new GameObject({ id: event.id, name: event.name, layer });
    entity.addComponent(new Transform({ x: event.x, y: event.y }));
    if (event.sprite !== undefined) {
      entity.addComponent(new Sprite({ texture: event.sprite }));
      entity.addComponent(new BehaviorComponent());
    }
    return entity;
  }

  /** Registers an entity under the given parent (defaults to root). */
  addEntity(entity: GameObject, parent: GameObject = this.root): this {
    if (this.byId.has(entity.id)) {
      throw new Error(`scene already contains entity "${entity.id}"`);
    }
    parent.addChild(entity);
    this.index(entity);
    return this;
  }

  /** Removes an entity and all its descendants from the scene. */
  removeEntity(id: string): boolean {
    const entity = this.byId.get(id);
    if (entity === undefined) {
      return false;
    }
    entity.traverse((node) => {
      this.byId.delete(node.id);
    });
    entity.destroy();
    return true;
  }

  /** Lookup by entity id. */
  getEntityById(id: string): GameObject | null {
    return this.byId.get(id) ?? null;
  }

  /** Every entity that has a component of the given type (depth-first). */
  findEntitiesByComponent(type: ComponentTypeName): GameObject[] {
    const matches: GameObject[] = [];
    this.root.traverse((entity) => {
      if (entity.hasComponent(type)) {
        matches.push(entity);
      }
    });
    return matches;
  }

  /** Every entity in the given culling group. */
  findEntitiesByCullingGroup(group: string): GameObject[] {
    const matches: GameObject[] = [];
    this.root.traverse((entity) => {
      if (entity.cullingGroup === group) {
        matches.push(entity);
      }
    });
    return matches;
  }

  /** All culling groups present in the scene (insertion order, deduped). */
  getCullingGroups(): string[] {
    const groups: string[] = [];
    const seen = new Set<string>();
    this.root.traverse((entity) => {
      if (entity.cullingGroup !== null && !seen.has(entity.cullingGroup)) {
        seen.add(entity.cullingGroup);
        groups.push(entity.cullingGroup);
      }
    });
    return groups;
  }

  /**
   * Depth-first traversal in layer order: siblings are visited in ascending
   * `layer`, ties broken by id for determinism.
   */
  getEntitiesInLayerOrder(): GameObject[] {
    const ordered: GameObject[] = [];
    const visit = (entity: GameObject): void => {
      ordered.push(entity);
      const siblings = [...entity.children].sort((a, b) => {
        if (a.layer !== b.layer) {
          return a.layer - b.layer;
        }
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
      for (const child of siblings) {
        visit(child);
      }
    };
    visit(this.root);
    return ordered;
  }

  /** World position (tile units), accumulated across parent transforms. */
  getWorldPosition(entity: GameObject): Vec2 {
    return entity.getWorldPosition();
  }

  /** Number of registered entities (excluding the root node). */
  get size(): number {
    // The root is always registered; subtract it so `size` counts real entities.
    return Math.max(0, this.byId.size - 1);
  }

  private index(entity: GameObject): void {
    entity.traverse((node) => {
      if (this.byId.has(node.id) && this.byId.get(node.id) !== node) {
        throw new Error(`duplicate entity id "${node.id}" in scene`);
      }
      this.byId.set(node.id, node);
    });
  }
}