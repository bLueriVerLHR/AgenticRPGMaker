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
  commandFromSchema,
  type Command,
  type CommandContext,
  type GameEffect,
} from "./commands.js";
import { GameState } from "./game-state.js";

/**
 * Evaluates a page condition against the current state.
 * `null` = always active; otherwise the named switch must equal `value`.
 */
export function evaluateCondition(condition: EventPageCondition, state: GameState): boolean {
  if (condition === null) {
    return true;
  }
  return state.getSwitch(condition.switchId) === condition.value;
}

export interface InterpreterDeps {
  /** Variables/switches state (created fresh when omitted). */
  state?: GameState;
  /** Gameplay event bus (created fresh when omitted). */
  bus?: GameEventBus;
  /** Scene whose entities commands act on (created empty when omitted). */
  scene?: SceneGraph;
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

  constructor(deps: InterpreterDeps = {}) {
    this.state = deps.state ?? new GameState();
    this.bus = deps.bus ?? new TypedEventBus<GameEventMap>();
    this.scene = deps.scene ?? new SceneGraph();
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

    const commands: Command[] = page.commands.map((line) => commandFromSchema(line));
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
