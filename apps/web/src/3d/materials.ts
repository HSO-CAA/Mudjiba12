import { Color, ShaderMaterial } from 'three';

/** Elegant animated "no signal" placeholder for screens without a video (empty portfolio). */
export function createPlaceholderMaterial(accent: string, seed: number): ShaderMaterial {
  const a = new Color(accent);
  const b = new Color(accent).multiplyScalar(0.12);
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uA: { value: a },
      uB: { value: b },
      uSeed: { value: seed },
      uPower: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uA;
      uniform vec3 uB;
      uniform float uSeed;
      uniform float uPower;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0; float a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
        return v;
      }
      float box(vec2 uv, vec2 c, vec2 s) {
        vec2 d = abs(uv - c) - s;
        return 1.0 - step(0.0, max(d.x, d.y));
      }
      void main() {
        vec2 uv = vUv;
        vec2 p = uv * vec2(1.0, 1.9);
        float t = uTime * 0.07 + uSeed * 11.0;
        vec2 q = vec2(fbm(p * 1.6 + t), fbm(p * 1.6 - t + 3.1));
        float n = fbm(p * 2.2 + q * 1.8);
        vec3 col = mix(uB, uA * 0.62, smoothstep(0.3, 0.95, n));
        col += uA * 0.55 * pow(smoothstep(0.6, 1.0, n), 3.0);
        float vig = smoothstep(0.95, 0.15, length((uv - 0.5) * vec2(1.4, 1.0)));
        col *= 0.25 + 0.75 * vig;
        // viewfinder brackets + centre mark
        vec2 c = abs(uv - 0.5);
        float lw = 0.006;
        float corner = 0.0;
        corner += box(c, vec2(0.36, 0.42), vec2(0.06, lw * 0.6)) ;
        corner += box(c, vec2(0.415, 0.375), vec2(lw, 0.05));
        corner = clamp(corner, 0.0, 1.0) * step(0.3, c.x) * step(0.32, c.y);
        float cross = box(uv, vec2(0.5), vec2(0.03, lw * 0.35)) + box(uv, vec2(0.5), vec2(lw * 0.6, 0.017));
        col += vec3(0.95, 0.92, 0.88) * (corner * 0.55 + clamp(cross, 0.0, 1.0) * 0.35);
        col *= 0.93 + 0.07 * sin(uv.y * 820.0 + uTime * 6.0);
        gl_FragColor = vec4(col * uPower, 1.0);
      }
    `,
    toneMapped: false,
  });
}
