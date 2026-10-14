import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RingGeometry,
  SphereGeometry,
  type Material,
  type BufferGeometry,
} from 'three';
import { createIrisBlade, createLatheZ, createRidgedRing } from './geometry';
import {
  createBarrelTexture,
  createDistanceScaleTexture,
  createFrontRingTexture,
  createSoftShadowTexture,
  createStopScaleTexture,
  createTurnedRoughnessTexture,
} from './textures';
import { clamp01, damp, easeOutExpo, heroState, smoothstep } from './heroState';
import type { QualityProfile } from './quality';

const BLADES = 9;
const APERTURE_OPEN = 0.34;

/** Cylinder along Z with UVs wrapping around the barrel (for engraved bands). */
function bandGeometry(radius: number, length: number, segments: number): CylinderGeometry {
  const g = new CylinderGeometry(radius, radius, length, segments, 1, true);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Spherical cap whose base circle (radius `r`) sits at z=0 and bulges towards +Z by the sphere radius `R`. */
function capGeometry(R: number, r: number, segments: number, concave = false): SphereGeometry {
  const theta = Math.asin(Math.min(r / R, 0.999));
  const g = new SphereGeometry(R, segments, Math.max(12, segments / 4), 0, Math.PI * 2, 0, theta);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, -R * Math.cos(theta));
  if (concave) g.scale(1, 1, -1);
  return g;
}

interface LensProps {
  accent: string;
  mark: string;
  profile: QualityProfile;
  /** Hero mode reads scroll/pointer from heroState; otherwise the lens idles. */
  interactive?: boolean;
}

/**
 * A procedurally modelled cine prime: chrome mount, anodised barrel with engraved scales, follow-focus gear
 * teeth, an accent ring, a recessed multi-coated front element and a nine-blade iris inside.
 */
export function Lens({ accent, mark, profile, interactive = true }: LensProps) {
  const group = useRef<Group>(null);
  const focusRing = useRef<Group>(null);
  const blades = useRef<(Mesh | null)[]>([]);
  const shadow = useRef<Group>(null);
  const smooth = useRef({ p: 0, yaw: 1.1, pitch: 0, aperture: 0.06 });
  const seg = profile.radialSegments;

  const textures = useMemo(
    () => ({
      barrel: createBarrelTexture({ circumference: Math.PI * 2 * 0.86, height: 0.46 }, mark || 'S5Y', accent, 3),
      stops: createStopScaleTexture({ circumference: Math.PI * 2 * 0.87, height: 0.12 }, 3),
      distance: createDistanceScaleTexture({ circumference: Math.PI * 2 * 0.905, height: 0.28 }, accent, 3),
      front: createFrontRingTexture(`${(mark || 'S5Y').toUpperCase()} CINE PRIME ● 35mm 1:1.4 ● Ø95 ● LENS MADE FOR STORIES ●`, accent, 0.8 / 1.02),
    }),
    [accent, mark],
  );
  const turned = useMemo(() => {
    const t = createTurnedRoughnessTexture();
    t.repeat.set(1, 3);
    return t;
  }, []);
  const shadowMap = useMemo(() => createSoftShadowTexture(), []);
  useEffect(
    () => () => {
      turned.dispose();
      shadowMap.dispose();
    },
    [turned, shadowMap],
  );

  useEffect(() => {
    // Rotate the engraving so one copy faces the viewer at rest.
    textures.barrel.offset.x = 0.18;
    textures.distance.offset.x = 0.22;
    textures.stops.offset.x = 0.2;
    return () => Object.values(textures).forEach((t) => t.dispose());
  }, [textures]);

  const geos = useMemo(() => {
    const g: Record<string, BufferGeometry> = {
      mount: createLatheZ(
        [
          [0.5, -1.4],
          [0.69, -1.4],
          [0.712, -1.385],
          [0.712, -1.26],
          [0.83, -1.255],
          [0.848, -1.238],
          [0.848, -1.17],
          [0.862, -1.162],
        ],
        seg,
      ),
      barrel: bandGeometry(0.862, 0.46, seg),
      irisGear: createRidgedRing({ radius: 0.872, depth: 0.03, length: 0.2, count: 96, profile: 'gear' }),
      stopBand: bandGeometry(0.872, 0.12, seg),
      spacer: createLatheZ(
        [
          [0.872, -0.36],
          [0.892, -0.345],
          [0.892, -0.215],
          [0.905, -0.2],
        ],
        seg,
      ),
      distance: bandGeometry(0.905, 0.28, seg),
      focusGear: createRidgedRing({ radius: 0.93, depth: 0.042, length: 0.38, count: 120, profile: 'gear' }),
      accentRing: createLatheZ(
        [
          [0.93, 0.51],
          [0.952, 0.52],
          [0.958, 0.555],
          [0.952, 0.59],
          [0.93, 0.6],
        ],
        seg,
      ),
      housing: createLatheZ(
        [
          [0.93, 0.6],
          [0.97, 0.635],
          [1.035, 0.69],
          [1.05, 0.715],
          [1.05, 1.075],
          [1.042, 1.098],
          [1.02, 1.11],
        ],
        seg,
      ),
      grip: createRidgedRing({ radius: 1.05, depth: 0.009, length: 0.22, count: 180, profile: 'rib', innerRadius: 1.04 }),
      face: new RingGeometry(0.8, 1.02, seg, 1),
      lip: createLatheZ(
        [
          [0.8, 1.11],
          [0.785, 1.095],
          [0.785, 0.78],
        ],
        seg,
      ),
      frontGlass: capGeometry(1.35, 0.79, seg),
      // inner element surfaces (only their coating reflections are drawn — the "depth" of a real lens)
      coatRear: capGeometry(1.9, 0.76, seg, true),
      coatMid: capGeometry(1.2, 0.58, Math.round(seg * 0.75)),
      coatDeep: capGeometry(0.9, 0.46, Math.round(seg / 2), true),
      shadow: new RingGeometry(0, 0.5, 48, 1),
      baffle1: new RingGeometry(0.6, 0.79, seg, 1),
      baffle2: new RingGeometry(0.52, 0.79, seg, 1),
      baffle3: new RingGeometry(0.45, 0.79, seg, 1),
      irisBack: new RingGeometry(0.0, 0.8, seg, 1),
      rearGlass: capGeometry(0.5, 0.3, 48),
      blade: createIrisBlade(APERTURE_OPEN, 0.86),
    };
    return g;
  }, [seg]);

  useEffect(() => () => Object.values(geos).forEach((g) => g.dispose()), [geos]);

  const mats = useMemo(() => {
    // Black anodising is a dyed, transparent oxide: it reflects like a dielectric (white, Fresnel-driven
    // highlights) rather than like a near-black metal, which is what keeps the barrel from reading as a blob.
    const anodised = new MeshPhysicalMaterial({
      color: '#151518',
      metalness: 0.12,
      roughness: 0.46,
      roughnessMap: turned,
      clearcoat: 0.7,
      clearcoatRoughness: 0.2,
      specularIntensity: 0.9,
    });
    const engraved = (map: typeof textures.barrel) =>
      new MeshPhysicalMaterial({
        map,
        color: '#ffffff',
        metalness: 0.1,
        roughness: 0.48,
        roughnessMap: turned,
        clearcoat: 0.55,
        clearcoatRoughness: 0.24,
      });
    const glass = profile.transmission
      ? new MeshPhysicalMaterial({
          color: '#ffffff',
          metalness: 0,
          roughness: 0.02,
          transmission: 1,
          thickness: 0.55,
          ior: 1.62,
          attenuationColor: new Color('#7b84ff'),
          attenuationDistance: 2.4,
          iridescence: 1,
          iridescenceIOR: 1.45,
          iridescenceThicknessRange: [280, 720],
          clearcoat: 1,
          clearcoatRoughness: 0.012,
          specularIntensity: 1,
          envMapIntensity: 1.5,
          // let the inner coating reflections (transparent, drawn later) show through
          depthWrite: false,
        })
      : new MeshPhysicalMaterial({
          color: '#04050a',
          metalness: 0,
          roughness: 0.025,
          clearcoat: 1,
          clearcoatRoughness: 0.015,
          iridescence: 1,
          iridescenceIOR: 1.45,
          iridescenceThicknessRange: [280, 720],
          transparent: true,
          opacity: 0.62,
          depthWrite: false,
          envMapIntensity: 1.3,
        });
    /** Specular-only coating layer: black diffuse + additive blend = just the tinted reflections of the studio. */
    const coating = (ior: number, range: [number, number], intensity: number) =>
      new MeshPhysicalMaterial({
        color: '#000000',
        metalness: 0,
        roughness: 0.035,
        iridescence: 1,
        iridescenceIOR: ior,
        iridescenceThicknessRange: range,
        specularIntensity: 1,
        envMapIntensity: intensity,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      });
    return {
      anodised,
      barrel: engraved(textures.barrel),
      stops: engraved(textures.stops),
      distance: engraved(textures.distance),
      face: engraved(textures.front),
      // flat-shaded gear teeth: each facet catches the rim strips differently → readable knurling
      gear: new MeshPhysicalMaterial({ color: '#17171a', metalness: 0.18, roughness: 0.34, clearcoat: 0.45, clearcoatRoughness: 0.28 }),
      grip: new MeshPhysicalMaterial({ color: '#1a1a1d', metalness: 0.3, roughness: 0.38, clearcoat: 0.3, clearcoatRoughness: 0.35 }),
      chrome: new MeshStandardMaterial({ color: '#e4e4e8', metalness: 1, roughness: 0.12 }),
      accent: new MeshPhysicalMaterial({
        color: new Color(accent),
        metalness: 0.4,
        roughness: 0.28,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
      }),
      interior: new MeshStandardMaterial({ color: '#050506', metalness: 0.1, roughness: 0.86, side: DoubleSide }),
      lip: new MeshStandardMaterial({ color: '#08080a', metalness: 0.3, roughness: 0.6, side: BackSide }),
      blade: new MeshStandardMaterial({ color: '#3a3a41', metalness: 0.85, roughness: 0.26, side: DoubleSide }),
      glass,
      coatRear: coating(1.3, [380, 620], 0.95),
      coatMid: coating(1.8, [250, 520], 0.85),
      coatDeep: coating(2.1, [420, 800], 1.15),
      rearGlass: new MeshPhysicalMaterial({
        color: '#120a2a',
        metalness: 0.3,
        roughness: 0.06,
        iridescence: 1,
        iridescenceIOR: 2,
        iridescenceThicknessRange: [300, 700],
        clearcoat: 1,
      }),
      shadow: new MeshBasicMaterial({ map: shadowMap, color: '#000000', transparent: true, opacity: 0.8, depthWrite: false }),
    } satisfies Record<string, Material>;
  }, [accent, profile.transmission, textures, turned, shadowMap]);

  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(delta, 0.25);
    const s = smooth.current;
    const time = state.clock.elapsedTime;
    let intro = 1;
    let p = 0;
    let px = 0;
    let py = 0;
    if (interactive) {
      const now = performance.now();
      intro = heroState.reducedMotion ? 1 : heroState.introAt === null ? 0 : clamp01((now - heroState.introAt) / 3600);
      p = heroState.progress;
      px = heroState.reducedMotion ? 0 : heroState.pointerX;
      py = heroState.reducedMotion ? 0 : heroState.pointerY;
    }
    s.p = damp(s.p, p, 6, dt);
    const push = smoothstep(0.0, 0.62, s.p);
    const e = easeOutExpo(intro);

    const yawRest = 0.5;
    const introYaw = 1.25 + (yawRest - 1.25) * e;
    const yawTarget = (introYaw + px * 0.24) * (1 - push);
    const pitchTarget = (-py * 0.12 + 0.05) * (1 - push);
    if (heroState.reducedMotion) {
      s.yaw = yawTarget;
      s.pitch = pitchTarget;
    } else {
      s.yaw = damp(s.yaw, yawTarget, 3.2, dt);
      s.pitch = damp(s.pitch, pitchTarget, 3.2, dt);
    }
    const idle = heroState.reducedMotion ? 0 : 1;
    g.rotation.set(s.pitch + Math.sin(time * 0.37) * 0.012 * idle, s.yaw + Math.sin(time * 0.23) * 0.02 * idle, 0);
    g.position.y = 1.3 + Math.sin(time * 0.62) * 0.028 * idle * (1 - push);

    // aperture opens with the intro, closes as the camera pushes through the lens
    const apertureTarget = 0.05 + (APERTURE_OPEN - 0.05) * smoothstep(0.15, 0.85, intro) - (APERTURE_OPEN - 0.02) * smoothstep(0.5, 0.95, s.p);
    s.aperture = heroState.reducedMotion ? Math.max(0, apertureTarget) : damp(s.aperture, Math.max(0.0, apertureTarget), 5, dt);
    const offset = s.aperture - APERTURE_OPEN;
    for (const b of blades.current) if (b) b.position.y = offset;

    if (focusRing.current) focusRing.current.rotation.z = -s.p * 1.4 + (1 - e) * 0.8;
    // the soft floor shadow follows the lens heading (yaw only) and tightens a touch as it bobs down
    if (shadow.current) {
      shadow.current.rotation.y = g.rotation.y;
      const h = g.position.y - 1.3;
      shadow.current.scale.setScalar(1 + h * 1.5);
    }
  });

  return (
    <>
    <group ref={group} position={[0, 1.3, 0]} rotation={[0, 1.1, 0]}>
      <group position={[0, 0, 0.12]}>
        <mesh geometry={geos.mount} material={mats.chrome} />
        <mesh geometry={geos.barrel} material={mats.barrel} position={[0, 0, -0.93]} />
        <mesh geometry={geos.irisGear} material={mats.gear} position={[0, 0, -0.58]} />
        <mesh geometry={geos.stopBand} material={mats.stops} position={[0, 0, -0.42]} />
        <mesh geometry={geos.spacer} material={mats.anodised} />
        <group ref={focusRing}>
          <mesh geometry={geos.distance} material={mats.distance} position={[0, 0, -0.06]} />
          <mesh geometry={geos.focusGear} material={mats.gear} position={[0, 0, 0.3]} />
        </group>
        <mesh geometry={geos.accentRing} material={mats.accent} />
        <mesh geometry={geos.housing} material={mats.anodised} />
        <mesh geometry={geos.grip} material={mats.grip} position={[0, 0, 0.86]} />
        <mesh geometry={geos.face} material={mats.face} position={[0, 0, 1.11]} />
        <mesh geometry={geos.lip} material={mats.lip} />

        {/* a little light spilling into the barrel so the iris blades and inner elements read */}
        <pointLight position={[0.25, 0.35, 1.9]} intensity={2.4} distance={3.2} decay={2} color="#fff1dc" />

        {/* optical stack (inside → out) */}
        <mesh geometry={geos.irisBack} material={mats.interior} position={[0, 0, 0.12]} />
        <mesh geometry={geos.rearGlass} material={mats.rearGlass} position={[0, 0, 0.13]} />
        <group position={[0, 0, 0.24]}>
          {Array.from({ length: BLADES }, (_, i) => (
            <group key={i} rotation={[0, 0, (i / BLADES) * Math.PI * 2]} position={[0, 0, i * 0.0035]}>
              <mesh
                ref={(m) => {
                  blades.current[i] = m;
                }}
                geometry={geos.blade}
                material={mats.blade}
                rotation={[0.03, 0, 0]}
              />
            </group>
          ))}
        </group>
        <mesh geometry={geos.baffle3} material={mats.interior} position={[0, 0, 0.38]} />
        <mesh geometry={geos.baffle2} material={mats.interior} position={[0, 0, 0.56]} />
        <mesh geometry={geos.baffle1} material={mats.interior} position={[0, 0, 0.7]} />
        <mesh geometry={geos.frontGlass} material={mats.glass} position={[0, 0, 0.84]} renderOrder={1} />
        {/* nested element reflections, drawn after the front glass: inverted (concave) and upright (convex) images */}
        <mesh geometry={geos.coatDeep} material={mats.coatDeep} position={[0, 0, 0.44]} renderOrder={2} />
        <mesh geometry={geos.coatMid} material={mats.coatMid} position={[0, 0, 0.52]} renderOrder={2} />
        <mesh geometry={geos.coatRear} material={mats.coatRear} position={[0, 0, 0.8]} renderOrder={2} />
      </group>
    </group>
    <group ref={shadow} position={[0, 0.004, 0]} rotation={[0, 1.1, 0]}>
      {/* broad penumbra + tighter core, elongated along the barrel */}
      <mesh geometry={geos.shadow} material={mats.shadow} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -0.05]} scale={[4.2, 6.4, 1]} />
      <mesh geometry={geos.shadow} material={mats.shadow} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, -0.05]} scale={[2.4, 4.6, 1]} />
    </group>
    </>
  );
}
