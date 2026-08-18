// Animated background: a domain-warped fbm noise field rendered on the GPU,
// giving the slow liquid-marble swirl the rest of the theme is built around.
// Falls back to a static CSS gradient if WebGL is unavailable.

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_res;
uniform float u_time;
uniform float u_intensity;

const vec3 COL_DEEP  = vec3(0.043, 0.055, 0.145); // near-black navy
const vec3 COL_BLUE  = vec3(0.106, 0.239, 0.478); // electric blue
const vec3 COL_PLUM  = vec3(0.286, 0.129, 0.404); // violet
const vec3 COL_ROUGE = vec3(0.592, 0.106, 0.243); // crimson
const vec3 COL_TEAL  = vec3(0.063, 0.400, 0.451); // teal highlight

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
  float t = u_time * 0.045;

  // Two levels of domain warping turn plain fbm into flowing liquid bands.
  vec2 q = vec2(
    fbm(uv * 1.4 + vec2(0.0, t)),
    fbm(uv * 1.4 + vec2(5.2, 1.3) - t * 0.8)
  );
  vec2 r = vec2(
    fbm(uv * 1.7 + 3.0 * q + vec2(1.7, 9.2) + t * 0.5),
    fbm(uv * 1.7 + 3.0 * q + vec2(8.3, 2.8) - t * 0.4)
  );
  float f = fbm(uv * 1.6 + 2.6 * r);

  // smoothstep on each layer keeps the colours as distinct ribbons instead of
  // blending into a single muddy wash.
  float mBlue  = smoothstep(0.25, 0.72, f);
  float mPlum  = smoothstep(0.35, 0.95, length(q));
  float mRouge = smoothstep(0.42, 0.88, r.x);
  float mTeal  = smoothstep(0.55, 0.92, r.y);

  vec3 col = COL_DEEP;
  col = mix(col, COL_BLUE,  mBlue * 0.95);
  col = mix(col, COL_PLUM,  mPlum * 0.75);
  col = mix(col, COL_ROUGE, mRouge * 0.85);
  col = mix(col, COL_TEAL,  mTeal * 0.6);

  // Thin bright seams along the ribbon edges, like light through liquid.
  float seam = smoothstep(0.48, 0.5, f) - smoothstep(0.5, 0.52, f);
  col += vec3(0.45, 0.62, 0.95) * seam * 0.5;

  col = mix(COL_DEEP, col, 0.62 + 0.38 * u_intensity);
  col *= 0.8 + 0.45 * f;

  // Vignette keeps focus on the table in the middle of the screen.
  float vig = 1.0 - 0.75 * dot(uv * 0.85, uv * 0.85);
  col *= clamp(vig, 0.0, 1.0);

  // Fine grain stops the large gradients from banding.
  col += (hash(gl_FragCoord.xy + fract(u_time)) - 0.5) * 0.018;

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('Shader compile failed:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export class ShaderBackground {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = null;
    this.raf = null;
    this.startTime = performance.now();
    this.intensity = 1;
    this.targetIntensity = 1;
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  }

  start() {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const gl =
      this.canvas.getContext('webgl', { antialias: false, depth: false, alpha: false }) ||
      this.canvas.getContext('experimental-webgl', { antialias: false, depth: false, alpha: false });

    if (!gl) {
      document.body.classList.add('no-webgl');
      return false;
    }
    this.gl = gl;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) {
      document.body.classList.add('no-webgl');
      return false;
    }

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('Program link failed:', gl.getProgramInfoLog(program));
      document.body.classList.add('no-webgl');
      return false;
    }
    gl.useProgram(program);
    this.program = program;

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );
    const loc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.uRes = gl.getUniformLocation(program, 'u_res');
    this.uTime = gl.getUniformLocation(program, 'u_time');
    this.uIntensity = gl.getUniformLocation(program, 'u_intensity');

    this.resize();
    window.addEventListener('resize', () => this.resize());

    if (reduce) {
      // Draw a single static frame rather than animating.
      this.render(0);
    } else {
      this.loop();
    }
    return true;
  }

  resize() {
    const { canvas, gl } = this;
    if (!gl) return;
    const w = Math.floor(window.innerWidth * this.dpr);
    const h = Math.floor(window.innerHeight * this.dpr);
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  }

  /** Briefly brighten the swirl — used as a flourish on big game moments. */
  pulse() {
    this.intensity = 1.9;
  }

  render(timeSeconds) {
    const gl = this.gl;
    gl.uniform2f(this.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uTime, timeSeconds);
    gl.uniform1f(this.uIntensity, this.intensity);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  loop() {
    const tick = () => {
      const elapsed = (performance.now() - this.startTime) / 1000;
      this.intensity += (this.targetIntensity - this.intensity) * 0.04;
      this.render(elapsed);
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }
}
