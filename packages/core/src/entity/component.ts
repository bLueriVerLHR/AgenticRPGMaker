/**
 * Entity/Component model (ADR-001).
 *
 * `GameObject` is a lightweight container of `Component`s. Components own data
 * and behavior; the engine and game code compose entities from components (no
 * deep inheritance hierarchies). This file defines the `Component` base class
 * and the attach/detach lifecycle.
 */
import type { GameObject } from "./game-object.js";

/**
 * Base class for every entity component.
 *
 * Subclasses declare a stable `type` discriminator (e.g. `"transform"`) used for
 * typed lookup on the owning `GameObject`, and may override the
 * `onAttach`/`onDetach` lifecycle hooks. Components are attached and detached
 * exclusively through the `GameObject` API — never by hand.
 */
export abstract class Component {
  private _owner: GameObject | null = null;

  /** Stable component-type discriminator used for typed lookup. */
  abstract readonly type: string;

  /** The entity this component is attached to, or null while detached. */
  get owner(): GameObject | null {
    return this._owner;
  }

  /** Managed by `GameObject.addComponent`. Not for direct calls. */
  attach(owner: GameObject): void {
    if (this._owner !== null && this._owner !== owner) {
      throw new Error(
        `component type "${this.type}" is already attached to entity "${this._owner.id}"`,
      );
    }
    this._owner = owner;
    this.onAttach(owner);
  }

  /** Managed by `GameObject.removeComponent`. Not for direct calls. */
  detach(): void {
    const previous = this._owner;
    this._owner = null;
    if (previous !== null) {
      this.onDetach();
    }
  }

  /** Lifecycle hook: runs once when the component is attached to an entity. */
  protected onAttach(_owner: GameObject): void {}

  /** Lifecycle hook: runs once when the component is detached from its entity. */
  protected onDetach(): void {}
}