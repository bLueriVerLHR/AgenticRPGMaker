/**
 * Event interpreter (ADR-001 / ADR-003).
 *
 * Runs event pages: the interpreter is the **only executor** of the command
 * system. A page's condition is evaluated against the current game state; when
 * active, the page's ordered command list runs as a `CompositeCommand` and its
 * effects are recorded deterministically. Page selection follows the standard
 * RPG convention: the FIRST page whose condition is true wins.
 *
 * The interpreter is shared verbatim by the editor preview and the runtime, so
 * a fixture event page produces identical effects in both — deterministic and
 * fully testable in Node (no DOM, no timers).
 */
import type { GameEventBus } from "../events/event-bus.js";
import { TypedEventBus } from "../events/event-bus.js";
import type { GameEventMap } from "../events/game-events.js";
import { SceneGraph } from "../scene/scene-graph.js";
import type { EventPage, EventPageCondition, MapEvent } from "../schema/index.js";
import {
  CompositeCommand,
  defaultCommandRegistry,
  type Command,
  type CommandContext,
  type CommandRegistry,
  type GameEffect,
} from "./commands.js";
import { GameState } from "./game-state.js";

/**
 * Evaluates a page condition against the current state.
 * `null` = always active; `{switchId, value}` = switch equality (legacy);
 * `{variableId, op, value}` = variable comparison (task 15).
 */
export function evaluateCondition(condition: EventPageCondition, state: GameState): boolean {
  if (condition === null) {
    return true;
  }
  if ("switchId" in condition) {
    return state.getSwitch(condition.switchId) === condition.value;
  }
  const current = state.getVariable(condition.variableId);
  switch (condition.op) {
    case "eq":
      return current === condition.value;
    case "ne":
      return current !== condition.value;
    case "gt":
      return current > condition.value;
    case "gte":
      return current >= condition.value;
    case "lt":
      return current < condition.value;
    case "lte":
      return current <= condition.value;
  }
}

export interface InterpreterDeps {
  /** Variables/switches state (created fresh when omitted). */
  state?: GameState;
  /** Gameplay event bus (created fresh when omitted). */
  bus?: GameEventBus;
  /** Scene whose entities commands act on (created empty when omitted). */
  scene?: SceneGraph;
  /**
   * Command catalog. Defaults to `defaultCommandRegistry` (the six built-in
   * commands); games / AI-authored data pass a registry with custom commands
   * registered (D24, RPG-Maker plugin-command model).
   */
  registry?: CommandRegistry;
}

export interface RunEventOptions {
  /**
   * The entity that acts as this event's actor for `move` routes. Defaults to
   * the event's own entity id.
   */
  actorId?: string;
}

export interface InterpretationResult {
  /** Whether a page was selected and executed. */
  ran: boolean;
  /** The page that executed, or null when no condition matched. */
  page: EventPage | null;
  /** Deterministic effect log produced by the executed page. */
  effects: GameEffect[];
}

export class EventInterpreter {
  private readonly state: GameState;
  private readonly bus: GameEventBus;
  private readonly scene: SceneGraph;
  private readonly registry: CommandRegistry;
  /**
   * Parsed commands per event page (task 10): a page's command list is
   * immutable after construction, so repeated executions (dialogue/NPC
   * triggers) reuse the parsed `Command[]` instead of re-running the
   * schema→Command factory every time. WeakMap keeps entries bound to the
   * page object's lifetime (no leak; pages live as long as the map data).
   * Non-readonly so `clearCommandCache()` can swap it for a fresh map.
   */
  private commandCache = new WeakMap<EventPage, readonly Command[]>();

  constructor(deps: InterpreterDeps = {}) {
    this.state = deps.state ?? new GameState();
    this.bus = deps.bus ?? new TypedEventBus<GameEventMap>();
    this.scene = deps.scene ?? new SceneGraph();
    this.registry = deps.registry ?? defaultCommandRegistry;
  }

  /**
   * Drops all cached parsed commands. Needed only if a `CommandRegistry` is
   * mutated after the interpreter has already run (register custom commands
   * BEFORE first use; call this to pick up late registrations).
   */
  clearCommandCache(): void {
    this.commandCache = new WeakMap();
  }

  get gameState(): GameState {
    return this.state;
  }

  get eventBus(): GameEventBus {
    return this.bus;
  }

  get sceneGraph(): SceneGraph {
    return this.scene;
  }

  /**
   * Selects the first page whose condition holds (standard RPG semantics).
   */
  selectPage(pages: readonly EventPage[]): EventPage | null {
    for (const page of pages) {
      if (evaluateCondition(page.condition, this.state)) {
        return page;
      }
    }
    return null;
  }

  /**
   * Runs the event's active page (if any) against the interpreter's state,
   * bus, and scene. Returns whether a page ran and its deterministic effects.
   */
  runEvent(event: MapEvent, options: RunEventOptions = {}): InterpretationResult {
    const page = this.selectPage(event.pages);
    if (page === null) {
      return { ran: false, page: null, effects: [] };
    }

    let commands: readonly Command[] | undefined = this.commandCache.get(page);
    if (commands === undefined) {
      commands = page.commands.map((line) => this.registry.build(line));
      this.commandCache.set(page, commands);
    }
    const composite = new CompositeCommand(commands);
    const context: CommandContext = {
      state: this.state,
      bus: this.bus,
      scene: this.scene,
      actorId: options.actorId ?? event.id,
      effects: [],
    };
    composite.execute(context);
    return { ran: true, page, effects: context.effects };
  }
}
