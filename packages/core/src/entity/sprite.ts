/**
 * Sprite component (ADR-001).
 *
 * A Sprite **references** a texture/atlas and an optional frame index — it
 * describes *what* to draw, never *how*. Actual rendering is the renderer's
 * job (packages/renderer, ADR-002); the core stays DOM/GL-free.
 */
import { Component } from "./component.js";

export const SPRITE_TYPE = "sprite";

export interface SpriteInit {
  /** Texture/atlas reference, e.g. "characters/npc_innkeeper". */
  texture: string;
  /** Frame index into the texture (0 = first frame). */
  frame?: number;
}

export class Sprite extends Component {
  readonly type: string = SPRITE_TYPE;

  /** Texture/atlas reference, e.g. "characters/npc_innkeeper". */
  texture: string;
  /** Frame index into the texture (0 = first frame). */
  frame: number;

  constructor(init: SpriteInit) {
    super();
    this.texture = init.texture;
    this.frame = init.frame ?? 0;
  }
}
