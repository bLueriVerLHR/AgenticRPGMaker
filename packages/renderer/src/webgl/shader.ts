/**
 * Minimal textured-quad shader pair (P1b, ADR-002).
 *
 * ONE vertex + fragment shader pair for everything: position, uv, tint/alpha.
 * No post-processing, shadow, or lighting shaders in the MVP. GLSL ES 1.00 so
 * the same pair compiles on both WebGL1 and WebGL2 contexts. Programs are
 * compiled once and cached; uniform/attribute locations are resolved at link
 * time.
 */
import type { RendererLogger } from "../logger.js";

export const QUAD_VERTEX_SHADER = `
attribute vec2 aPosition;
attribute vec2 aUv;
attribute vec4 aColor;
uniform mat3 uProjection;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec3 pos = uProjection * vec3(aPosition, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
  vUv = aUv;
  vColor = aColor;
}
`;

export const QUAD_FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D uTexture;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  gl_FragColor = texture2D(uTexture, vUv) * vColor;
}
`;

export interface ShaderLocations {
  aPosition: number;
  aUv: number;
  aColor: number;
  uProjection: WebGLUniformLocation | null;
  uTexture: WebGLUniformLocation | null;
}

export interface ShaderProgramOptions {
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  vertexSource?: string;
  fragmentSource?: string;
  logger?: RendererLogger;
}

/** Compiles/links the textured-quad pair and caches its locations. */
export class ShaderProgram {
  readonly program: WebGLProgram;
  readonly locations: ShaderLocations;
  private readonly gl: WebGLRenderingContext | WebGL2RenderingContext;

  constructor(options: ShaderProgramOptions) {
    this.gl = options.gl;
    this.program = this.createProgram(
      options.vertexSource ?? QUAD_VERTEX_SHADER,
      options.fragmentSource ?? QUAD_FRAGMENT_SHADER,
    );
    this.locations = this.cacheLocations();
  }

  use(): void {
    this.gl.useProgram(this.program);
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }

  private compile(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (shader === null) {
      throw new Error("failed to create shader");
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`shader compile failed: ${log ?? "unknown error"}`);
    }
    return shader;
  }

  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;
    const vs = this.compile(gl.VERTEX_SHADER, vertexSource);
    const fs = this.compile(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (program === null) {
      throw new Error("failed to create program");
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, "aPosition");
    gl.bindAttribLocation(program, 1, "aUv");
    gl.bindAttribLocation(program, 2, "aColor");
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`program link failed: ${log ?? "unknown error"}`);
    }
    return program;
  }

  private cacheLocations(): ShaderLocations {
    const gl = this.gl;
    return {
      aPosition: 0,
      aUv: 1,
      aColor: 2,
      uProjection: gl.getUniformLocation(this.program, "uProjection"),
      uTexture: gl.getUniformLocation(this.program, "uTexture"),
    };
  }
}
