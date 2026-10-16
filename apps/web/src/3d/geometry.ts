import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Matrix4,
  Quaternion,
  Vector3,
  Float32BufferAttribute,
  LatheGeometry,
  Shape,
  ShapeGeometry,
  Vector2,
} from 'three';

export type RidgeProfile = 'gear' | 'rib';

export interface RidgedRingOptions {
  /** Radius at the bottom of the ridges. */
  radius: number;
  /** Ridge height. */
  depth: number;
  /** Length along the Z axis (centred on 0). */
  length: number;
  /** Number of ridges around the circumference. */
  count: number;
  profile: RidgeProfile;
  /** Inner radius of the end caps. */
  innerRadius?: number;
}

/**
 * A ring with real geometric ridges along Z — cine follow-focus gear teeth (`gear`, crisp, flat shaded)
 * or a rubber grip (`rib`, smooth). Includes annular end caps so the teeth read as solid.
 */
export function createRidgedRing({ radius, depth, length, count, profile, innerRadius = radius - 0.02 }: RidgedRingOptions): BufferGeometry {
  const fractions = profile === 'gear' ? [0, 0.16, 0.5, 0.66] : [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6];
  const heights = profile === 'gear' ? [0, 1, 1, 0] : fractions.map((f) => 0.5 - 0.5 * Math.cos(f * Math.PI * 2));
  const samples: { a: number; r: number }[] = [];
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < fractions.length; k++) {
      const a = ((i + (fractions[k] ?? 0)) / count) * Math.PI * 2;
      samples.push({ a, r: radius + depth * (heights[k] ?? 0) });
    }
  }
  const z0 = -length / 2;
  const z1 = length / 2;
  const pos: number[] = [];
  const push = (x: number, y: number, z: number) => pos.push(x, y, z);
  const n = samples.length;
  for (let i = 0; i < n; i++) {
    const s0 = samples[i] as { a: number; r: number };
    const s1 = samples[(i + 1) % n] as { a: number; r: number };
    const x0 = Math.cos(s0.a), y0 = Math.sin(s0.a);
    const x1 = Math.cos(s1.a), y1 = Math.sin(s1.a);
    // outer wall (two triangles, CCW seen from outside)
    push(x0 * s0.r, y0 * s0.r, z0);
    push(x1 * s1.r, y1 * s1.r, z0);
    push(x1 * s1.r, y1 * s1.r, z1);
    push(x0 * s0.r, y0 * s0.r, z0);
    push(x1 * s1.r, y1 * s1.r, z1);
    push(x0 * s0.r, y0 * s0.r, z1);
    // front cap (+z)
    push(x0 * innerRadius, y0 * innerRadius, z1);
    push(x0 * s0.r, y0 * s0.r, z1);
    push(x1 * s1.r, y1 * s1.r, z1);
    push(x0 * innerRadius, y0 * innerRadius, z1);
    push(x1 * s1.r, y1 * s1.r, z1);
    push(x1 * innerRadius, y1 * innerRadius, z1);
    // back cap (-z)
    push(x0 * innerRadius, y0 * innerRadius, z0);
    push(x1 * s1.r, y1 * s1.r, z0);
    push(x0 * s0.r, y0 * s0.r, z0);
    push(x0 * innerRadius, y0 * innerRadius, z0);
    push(x1 * innerRadius, y1 * innerRadius, z0);
    push(x1 * s1.r, y1 * s1.r, z0);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  if (profile === 'gear') {
    geo.computeVertexNormals(); // non-indexed → crisp facets
  } else {
    // smooth radial normals for the rubber ribs (caps keep axial normals)
    const normals: number[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i] ?? 0, y = pos[i + 1] ?? 0, z = pos[i + 2] ?? 0;
      const tri = Math.floor(i / 9) % 6;
      if (tri < 2) {
        const len = Math.hypot(x, y) || 1;
        normals.push(x / len, y / len, 0);
      } else {
        normals.push(0, 0, z > 0 ? 1 : -1);
      }
    }
    geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  }
  return geo;
}

/** Lathe profile revolved around Z (points are [radius, z]). */
export function createLatheZ(points: [number, number][], segments: number): LatheGeometry {
  const geo = new LatheGeometry(points.map(([r, z]) => new Vector2(r, z)), segments);
  geo.rotateX(Math.PI / 2);
  return geo;
}

export function roundedRectShape(w: number, h: number, r: number): Shape {
  const x = -w / 2;
  const y = -h / 2;
  const s = new Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** ShapeGeometry with UVs normalised to 0…1 over the shape's bounding box. */
export function normalizedShapeGeometry(shape: Shape, curveSegments = 12): ShapeGeometry {
  const geo = new ShapeGeometry(shape, curveSegments);
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  if (!box) return geo;
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const w = box.max.x - box.min.x;
  const h = box.max.y - box.min.y;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) - box.min.x) / w, (pos.getY(i) - box.min.y) / h);
  }
  uv.needsUpdate = true;
  return geo;
}

export interface PhoneDims {
  width: number;
  height: number;
  radius: number;
  depth: number;
  bezel: number;
}

export const PHONE: PhoneDims = { width: 1.22, height: 2.56, radius: 0.17, depth: 0.075, bezel: 0.045 };
export const PHONE_BEVEL = 0.014;
/** Z of the phone's front face (extrusion depth/2 + bevel). Screen layers sit just in front of it. */
export const PHONE_FRONT_Z = PHONE.depth / 2 + PHONE_BEVEL;

/** Bakes a transform into a non-indexed copy (mergeGeometries needs matching index layouts). */
function placed(geo: BufferGeometry, position: [number, number, number], rotationY = 0, scale: [number, number, number] = [1, 1, 1]): BufferGeometry {
  const m = new Matrix4().compose(new Vector3(...position), new Quaternion().setFromEuler(new Euler(0, rotationY, 0)), new Vector3(...scale));
  const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(m);
  return g;
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!merged) throw new Error('phone geometry merge failed');
  return merged;
}

/**
 * Phone parts grouped by material so a whole phone costs six draw calls:
 * titanium frame (+buttons, camera plate), black parts (front glass, island, lens barrels),
 * screen, specular front glass, frosted back glass and camera lens glass.
 */
export function createPhoneGeometries(d: PhoneDims = PHONE) {
  const bevel = PHONE_BEVEL;
  const z = d.depth / 2 + bevel;
  const body = new ExtrudeGeometry(roundedRectShape(d.width - bevel * 2, d.height - bevel * 2, d.radius - bevel), {
    depth: d.depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 14,
  });
  body.translate(0, 0, -d.depth / 2);
  const glassBase = normalizedShapeGeometry(roundedRectShape(d.width - 0.018, d.height - 0.018, d.radius - 0.01), 14);
  const screen = normalizedShapeGeometry(roundedRectShape(d.width - d.bezel * 2, d.height - d.bezel * 2, d.radius - d.bezel * 0.8), 14);
  screen.translate(0, 0, z + 0.003);
  const island = new ShapeGeometry(roundedRectShape(0.3, 0.085, 0.0425), 8);
  const button = new ExtrudeGeometry(roundedRectShape(0.03, 0.22, 0.012), { depth: 0.035, bevelEnabled: false, curveSegments: 4 });
  button.translate(0, 0, -0.0175);
  const plate = new ExtrudeGeometry(roundedRectShape(0.44, 0.44, 0.11), {
    depth: 0.012,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 2,
    curveSegments: 10,
  });
  const lensBarrel = new CylinderGeometry(0.075, 0.08, 0.03, 32);
  lensBarrel.rotateX(Math.PI / 2);
  const lensDisc = new CircleGeometry(0.058, 32);

  // camera module sits top-left when seen from the back (top-right in front-local X)
  const cx = d.width / 2 - 0.34;
  const cy = d.height / 2 - 0.34;
  const cz = -z - 0.002;
  const lensSpots: [number, number][] = [
    [-0.1, 0.1],
    [-0.1, -0.1],
    [0.1, 0],
  ];
  // rotated by π around Y: local x → -x, local z → -z
  const lensAt = (x: number, y: number, depth: number): [number, number, number] => [cx - x, cy + y, cz - depth];

  const frame = merge([
    placed(body, [0, 0, 0]),
    placed(button, [d.width / 2 + 0.004, 0.5, 0]),
    placed(button, [-d.width / 2 - 0.004, 0.62, 0], 0, [1, 0.6, 1]),
    placed(button, [-d.width / 2 - 0.004, 0.3, 0], 0, [1, 0.6, 1]),
    placed(plate, [cx, cy, cz], Math.PI),
  ]);
  const black = merge([
    placed(glassBase, [0, 0, z + 0.0015]),
    placed(island, [0, d.height / 2 - 0.13, z + 0.0042]),
    ...lensSpots.map(([x, y]) => placed(lensBarrel, lensAt(x, y, 0.03), Math.PI)),
  ]);
  const lensGlass = merge(lensSpots.map(([x, y]) => placed(lensDisc, lensAt(x, y, 0.0455), Math.PI)));
  const frontGlass = placed(glassBase, [0, 0, z + 0.0055]);
  const backGlass = placed(glassBase, [0, 0, -z - 0.0015], Math.PI);
  [body, glassBase, island, button, plate, lensBarrel, lensDisc].forEach((g) => g.dispose());

  return {
    frame,
    black,
    screen,
    frontGlass,
    backGlass,
    lensGlass,
    screenAspect: (d.width - d.bezel * 2) / (d.height - d.bezel * 2),
  };
}

/**
 * One iris blade in a local frame where its straight (aperture) edge lies on y = aperture.
 * Nine of these rotated around Z form a nonagon opening.
 */
export function createIrisBlade(aperture: number, outer: number): ShapeGeometry {
  const s = new Shape();
  const edgeEndX = Math.sqrt(Math.max(outer * outer - aperture * aperture, 0)) * 0.97;
  s.moveTo(-0.32, aperture);
  s.lineTo(edgeEndX, aperture);
  const a0 = Math.atan2(aperture, edgeEndX);
  const a1 = Math.PI * 0.62;
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    s.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
  }
  s.lineTo(-0.32, aperture);
  return new ShapeGeometry(s, 1);
}
