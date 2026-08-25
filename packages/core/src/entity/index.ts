/**
 * Entity/Component model barrel (ADR-001).
 *
 * Entities are composed from components: `GameObject` (container + scene-graph
 * node), the built-in `Transform` / `Sprite` / `Collider` / `BehaviorComponent`,
 * and the `Component` base class with its attach/detach lifecycle.
 */
export { Component } from "./component.js";
export {
  GameObject,
  type ComponentTypeRegistry,
  type ComponentTypeName,
  type GameObjectInit,
} from "./game-object.js";
export { Transform, TRANSFORM_TYPE, type TransformInit, type Vec2 } from "./transform.js";
export { Sprite, SPRITE_TYPE, type SpriteInit } from "./sprite.js";
export {
  Collider,
  COLLIDER_TYPE,
  type ColliderInit,
  type ColliderShape,
  type RectShape,
  type CircleShape,
  type AABB,
  shapeToLocalAABB,
  aabbsOverlap,
} from "./collider.js";
export { BehaviorComponent, BEHAVIOR_TYPE } from "./behavior-component.js";
