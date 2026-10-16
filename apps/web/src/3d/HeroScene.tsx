import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { Euler, Fog, Group, MeshBasicMaterial, PerspectiveCamera, Quaternion, Vector3, type Mesh } from 'three';
import type { PublicVideo } from '@s5y/shared';
import type { QualityTier } from '../lib/device';
import { boot } from '../app/loading';
import { Lens } from './Lens';
import { Phone, createPhoneKit } from './Phone';
import { SharedTextureRelease, StudioEffects, StudioEnvironment, StudioFloor, createStudioFx, ensureRectAreaLights, type StudioFx } from './Studio';
import { createSoftShadowTexture } from './textures';
import { clamp01, damp, easeOutExpo, heroState, smoothstep } from './heroState';
import { CAMERA_CHANNELS, HERO_FORMATION, cameraTrack } from './heroTimeline';
import { QA_STILL } from './qa';
import { sampleTrack, trackSample } from './track';
import { DebugHandle } from './DebugHandle';
import { lowerTier, qualityProfile, type QualityProfile } from './quality';

export interface HeroSceneProps {
  videos: PublicVideo[];
  accent: string;
  mark: string;
  tier: QualityTier;
  /** Keep the tier fixed (QA override) instead of adapting to the measured frame rate. */
  lockTier: boolean;
  /** Render + play only while the hero holds the render lease (on screen, tab visible, not covered). */
  active: boolean;
  /** Keep video decoders for the screens (phones release them while the hero is off screen). */
  decode: boolean;
  compact: boolean;
  reducedMotion: boolean;
  onReady: () => void;
  onFatal: () => void;
}

const LENS_FOCUS: [number, number, number] = [0, 1.3, 0];

function introProgress(): number {
  if (heroState.reducedMotion || QA_STILL) return 1;
  if (heroState.introAt === null) return 0;
  return clamp01((performance.now() - heroState.introAt) / 3600);
}

interface Slot {
  position: [number, number, number];
  rotation: [number, number, number];
  rank: number;
  delay: number;
  /** Brightness multiplier (deep, out-of-the-way screens glow less). */
  dim: number;
}

/** A screen placed by where it should land in the frame (fx: 0…1 across the viewport at rest) and its depth. */
interface SlotSpec {
  fx: number;
  z: number;
  dim?: number;
}

/**
 * Desktop: the copy owns the right ~40% of the frame (RTL), so every screen lives left of it — layered in
 * depth around the lens, ordered by importance (the first ones get the video decodes).
 */
const WIDE_SLOTS: SlotSpec[] = [
  { fx: 0.2, z: -3.8 },
  { fx: 0.356, z: -5.1 },
  { fx: 0.055, z: -3.3 },
  { fx: 0.505, z: -4.7, dim: 0.85 },
  { fx: 0.128, z: -8.4, dim: 0.55 },
  { fx: 0.278, z: -9.2, dim: 0.5 },
  { fx: 0.585, z: -8.8, dim: 0.42 },
];
/** Phones: the copy sits at the bottom; screens frame the lens above it, two rows deep. */
const COMPACT_SLOTS: SlotSpec[] = [
  { fx: 0.5, z: -4.4 },
  { fx: 0.08, z: -2.9 },
  { fx: 0.92, z: -2.9 },
  { fx: 0.27, z: -7.4, dim: 0.6 },
  { fx: 0.73, z: -7.4, dim: 0.6 },
];

const WIDE_BASE: [number, number, number] = [0.2, 1.6, 9.4];
const COMPACT_BASE: [number, number, number] = [0, 1.95, 12.6];
const WIDE_FOV = 30;
const COMPACT_FOV = 40;
/** Horizontal/vertical framing offsets (fractions of the viewport) that push the lens off-centre. */
const WIDE_SHIFT = 0.17;
const COMPACT_SHIFT = 0.13;

/**
 * Vertical FOV for the side-by-side layout: 30° from 16:10 up; narrower landscape screens (4:3 tablets, 5:4
 * monitors) widen it so the lens keeps the same share of the frame width instead of crowding the copy.
 */
function wideFov(aspect: number): number {
  if (aspect >= 1.6) return WIDE_FOV;
  const halfWidth = Math.tan((WIDE_FOV * Math.PI) / 360) * 1.6;
  return Math.min(44, (Math.atan(halfWidth / aspect) * 360) / Math.PI);
}

const restCam = new PerspectiveCamera();
const probe = new Vector3();

/** Resolves screen-space slot specs to world positions for the camera's rest pose at this aspect ratio. */
function placeSlots(count: number, aspect: number, compact: boolean): Slot[] {
  const specs = (compact ? COMPACT_SLOTS : WIDE_SLOTS).slice(0, count);
  const base = compact ? COMPACT_BASE : WIDE_BASE;
  const h = 1000;
  const w = h * aspect;
  restCam.fov = compact ? COMPACT_FOV : wideFov(aspect);
  restCam.aspect = aspect;
  restCam.near = 0.05;
  restCam.far = 70;
  restCam.position.set(...base);
  restCam.lookAt(LENS_FOCUS[0], LENS_FOCUS[1] - 0.05, LENS_FOCUS[2]);
  restCam.setViewOffset(w, h, compact ? 0 : w * WIDE_SHIFT, compact ? h * COMPACT_SHIFT : 0, w, h);
  restCam.updateMatrixWorld();
  restCam.updateProjectionMatrix();

  return specs.map((spec, rank) => {
    const lift = 1.42 + Math.min(0.12, Math.abs(spec.fx - 0.35) * 0.1);
    const target = spec.fx * 2 - 1;
    const ndc = (x: number) => probe.set(x, lift, spec.z).project(restCam).x - target;
    // secant solve for the world X that lands on `fx` at this depth
    let x0 = -1;
    let x1 = 1;
    let f0 = ndc(x0);
    let f1 = ndc(x1);
    for (let k = 0; k < 8 && Math.abs(f1) > 1e-5 && f1 !== f0; k++) {
      const x2 = x1 - (f1 * (x1 - x0)) / (f1 - f0);
      x0 = x1;
      f0 = f1;
      x1 = x2;
      f1 = ndc(x1);
    }
    const x = x1;
    // turn towards the camera (slightly less than fully → reads as a fanned arc)
    const yaw = Math.atan2(base[0] - x, base[2] - spec.z) * 0.85;
    const jitter = Math.sin(rank * 12.9898) * 0.025;
    return {
      position: [x, lift, spec.z],
      rotation: [0.02, yaw, jitter],
      rank,
      delay: 0.28 + rank * 0.07,
      dim: spec.dim ?? 1,
    };
  });
}

/**
 * Where the phones fly to: a tilted orbit around the lens (a crown — high in front, low behind, so no screen
 * ever passes over the lens), then a halo of screens around its front.
 */
interface FormationSpec {
  orbitRadius: number;
  /** Depth squash of the orbit (an ellipse: the front screens stay clear of the camera). */
  orbitDepth: number;
  orbitZ: number;
  /** Orbit centre height, how far the front rises / the back sinks, and a slight rise per screen (reads as a helix). */
  orbitY: number;
  orbitTilt: number;
  orbitRise: number;
  haloRadius: number;
  haloZ: number;
}
const WIDE_FORMATION: FormationSpec = { orbitRadius: 3.7, orbitDepth: 0.78, orbitZ: -0.6, orbitY: 2.75, orbitTilt: 1.2, orbitRise: 0.5, haloRadius: 2.55, haloZ: 2.2 };
const COMPACT_FORMATION: FormationSpec = { orbitRadius: 2.0, orbitDepth: 0.9, orbitZ: -0.5, orbitY: 3.35, orbitTilt: 1.25, orbitRise: 1.1, haloRadius: 2.45, haloZ: 2.2 };
const TAU = Math.PI * 2;
/** Orbit heading of the first (most important) phone, so it sits front-left when the camera arrives. */
const ORBIT_START = -1.05;
/** Halo angle of the first phone (12 o'clock). */
const HALO_START = Math.PI / 2;

interface PhoneRig {
  restPos: Vector3;
  restQ: Quaternion;
  pos: Vector3;
  q: Quaternion;
  target: Vector3;
  targetQ: Quaternion;
  euler: Euler;
}

function PhonesFormation({
  videos,
  accent,
  profile,
  play,
  decode,
  compact,
}: {
  videos: PublicVideo[];
  accent: string;
  profile: QualityProfile;
  play: boolean;
  decode: boolean;
  compact: boolean;
}) {
  const kit = useMemo(() => createPhoneKit('titanium'), []);
  useEffect(() => () => kit.dispose(), [kit]);
  const shadowMap = useMemo(() => createSoftShadowTexture(), []);
  useEffect(() => () => shadowMap.dispose(), [shadowMap]);
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera);
  const aspect = Math.round((size.width / Math.max(1, size.height)) * 50) / 50;
  const count = compact ? COMPACT_SLOTS.length : Math.min(WIDE_SLOTS.length, Math.max(5, videos.length));
  const slots = useMemo(() => placeSlots(count, aspect, compact), [count, aspect, compact]);
  const powers = useMemo(() => slots.map(() => ({ current: 0 })), [slots]);
  /** The screens' area lights go out before the iris stops down: their colour would streak across the front glass. */
  const spill = useMemo(() => ({ current: 1 }), []);
  const rigs = useMemo<PhoneRig[]>(
    () =>
      slots.map((slot) => ({
        restPos: new Vector3(...slot.position),
        restQ: new Quaternion().setFromEuler(new Euler(...slot.rotation)),
        pos: new Vector3(...slot.position),
        q: new Quaternion().setFromEuler(new Euler(...slot.rotation)),
        target: new Vector3(),
        targetQ: new Quaternion(),
        euler: new Euler(0, 0, 0, 'YXZ'),
      })),
    [slots],
  );
  const shadowMats = useMemo(
    () => slots.map(() => new MeshBasicMaterial({ map: shadowMap, color: '#000000', transparent: true, opacity: 0.75, depthWrite: false })),
    [slots, shadowMap],
  );
  useEffect(() => () => shadowMats.forEach((m) => m.dispose()), [shadowMats]);
  const holders = useRef<(Group | null)[]>([]);
  const bobs = useRef<(Group | null)[]>([]);
  const shadows = useRef<(Mesh | null)[]>([]);
  const form = compact ? COMPACT_FORMATION : WIDE_FORMATION;
  // phones: at most three decoders (the front row); the deep row shows posters. Off screen: none at all on phones.
  const decodeBudget = decode ? Math.min(compact ? Math.min(3, profile.maxVideoTextures) : profile.maxVideoTextures, videos.length) : 0;

  useFrame((state) => {
    const intro = introProgress();
    const t = heroState.timeline;
    const time = state.clock.elapsedTime;
    const still = heroState.reducedMotion || QA_STILL;
    const n = slots.length;
    const s0 = HERO_FORMATION.orbit[0];
    const s1 = HERO_FORMATION.orbit[1];
    const h0 = HERO_FORMATION.halo[0];
    const h1 = HERO_FORMATION.halo[1];
    const spin = (t - s0) * 2.4;
    const vortex = (t - h0) * 2.8;
    // the halo opens and rushes past the camera as it pushes into the lens
    const rush = smoothstep(HERO_FORMATION.rush[0], HERO_FORMATION.rush[1], t);
    const fade = 1 - smoothstep(0.8, 0.885, t) * 0.92;
    spill.current = 1 - smoothstep(0.62, 0.7, t);
    const cam = camera.position;
    // Facing the camera, the screens' glass would mirror the front ring light right over the picture: in
    // formation the (additive) reflection layer keeps only a faint sheen so the reels stay readable.
    kit.glass.opacity = 1 - 0.78 * smoothstep(s0, s1, t);
    for (let i = 0; i < n; i++) {
      const slot = slots[i];
      const r = rigs[i];
      const g = holders.current[i];
      if (!slot || !r || !g) continue;
      const k1 = smoothstep(s0 + i * HERO_FORMATION.orbitStagger, s1 + i * HERO_FORMATION.orbitStagger, t);
      const k2 = smoothstep(h0 + i * HERO_FORMATION.haloStagger, h1 + i * HERO_FORMATION.haloStagger, t);
      r.pos.copy(r.restPos);
      r.q.copy(r.restQ);
      let yaw = slot.rotation[1];
      if (k1 > 0) {
        const f = n > 1 ? i / (n - 1) - 0.5 : 0;
        const a = ORBIT_START + i * (TAU / n) + spin;
        const ca = Math.cos(a);
        const x = Math.sin(a) * form.orbitRadius;
        const z = form.orbitZ + ca * form.orbitRadius * form.orbitDepth;
        const y = form.orbitY + form.orbitTilt * ca + form.orbitRise * f;
        r.target.set(x, y, z);
        // each screen turns to the camera (a touch of tilt so the orbit reads in depth, not as a wall)
        const dx = cam.x - x;
        const dz = cam.z - z;
        const facing = Math.atan2(dx, dz);
        r.euler.set(-Math.atan2(cam.y - y, Math.hypot(dx, dz)) * 0.55, facing, Math.sin(i * 2.1) * 0.07);
        r.targetQ.setFromEuler(r.euler);
        r.pos.lerp(r.target, k1);
        r.pos.y += Math.sin(Math.PI * k1) * 0.9; // flight arc
        r.q.slerp(r.targetQ, k1);
        yaw += (facing - yaw) * k1;
      }
      if (k2 > 0) {
        const b = HALO_START + i * (TAU / n) + vortex;
        const rad = form.haloRadius * (1 + 0.6 * rush);
        r.target.set(Math.cos(b) * rad, 1.3 + Math.sin(b) * rad, form.haloZ + 3.2 * rush);
        // face the lens axis, long side radial: the screens read as iris blades of light
        r.euler.set(0, 0, b - Math.PI / 2);
        r.targetQ.setFromEuler(r.euler);
        r.pos.lerp(r.target, k2);
        r.q.slerp(r.targetQ, k2);
      }
      g.position.copy(r.pos);
      g.quaternion.copy(r.q);

      const pw = powers[i];
      if (pw) pw.current = (slot.dim + (1 - slot.dim) * k1) * smoothstep(slot.delay, slot.delay + 0.22, intro) * fade;
      const bob = bobs.current[i];
      if (bob) bob.position.y = still ? 0 : Math.sin(time * 0.55 + i * 1.7) * 0.035 * (1 - k2);

      const sh = shadows.current[i];
      const mat = shadowMats[i];
      if (sh && mat) {
        const lift = Math.max(0, r.pos.y - r.restPos.y);
        sh.position.set(r.pos.x, 0.004, r.pos.z);
        sh.rotation.z = yaw;
        sh.scale.set(2.1 * (1 + lift * 0.35), 0.75 * (1 + lift * 0.35), 1);
        mat.opacity = 0.75 * (1 - smoothstep(0, 1.8, lift)) * (1 - k2);
        sh.visible = mat.opacity > 0.01;
      }
    }
  });

  return (
    <group>
      {slots.map((slot, i) => {
        const video = videos.length ? videos[slot.rank % videos.length] : undefined;
        const allowVideo = !!video && slot.rank < decodeBudget;
        return (
          <group key={i}>
            <group
              ref={(g) => {
                holders.current[i] = g;
              }}
              position={slot.position}
              rotation={slot.rotation}
            >
              <group
                ref={(g) => {
                  bobs.current[i] = g;
                }}
              >
                <Phone
                  kit={kit}
                  videoUrl={video ? (video.previewUrl ?? video.url) : null}
                  posterUrl={video?.posterUrl ?? null}
                  accent={accent}
                  seed={i * 0.37}
                  allowVideo={allowVideo && !heroState.reducedMotion}
                  play={play}
                  powerRef={powers[i]}
                  areaLight={profile.areaLights && slot.rank < 4}
                  lightIntensity={compact ? 2.4 : 3.4}
                  lightGain={spill}
                />
              </group>
            </group>
            <mesh
              ref={(m) => {
                shadows.current[i] = m;
              }}
              geometry={kit.shadowPlane}
              material={shadowMats[i]}
              position={[slot.position[0], 0.004, slot.position[2]]}
              rotation={[-Math.PI / 2, 0, slot.rotation[1]]}
              scale={[2.1, 0.75, 1]}
            />
          </group>
        );
      })}
    </group>
  );
}

/** Damps the raw scroll progress into the choreography clock — once per frame, before anything reads it. */
function TimelineDriver({ reducedMotion }: { reducedMotion: boolean }) {
  useFrame((_, delta) => {
    const target = reducedMotion ? 0 : heroState.progress;
    heroState.timeline = QA_STILL ? target : damp(heroState.timeline, target, 4.2, Math.min(delta, 0.1));
  }, -2);
  return null;
}

function CameraRig({ compact }: { compact: boolean }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const pose = useMemo(() => trackSample(CAMERA_CHANNELS), []);
  const pointer = useRef({ x: 0, y: 0 });
  const look = useMemo(() => new Vector3(), []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.25);
    const t = heroState.timeline;
    sampleTrack(cameraTrack(compact), t, pose);
    const intro = easeOutExpo(introProgress());
    const rest = 1 - smoothstep(0, 0.08, t);
    const reduced = heroState.reducedMotion || QA_STILL;
    const p = pointer.current;
    p.x = reduced ? 0 : damp(p.x, heroState.pointerX, 3.5, dt);
    p.y = reduced ? 0 : damp(p.y, heroState.pointerY, 3.5, dt);

    // the timeline is already damped, so the camera sits exactly on the track (no chord-cutting through arcs)
    const ce = Math.cos(pose.el);
    camera.position.set(
      LENS_FOCUS[0] + pose.d * ce * Math.sin(pose.az) + p.x * 0.45 * rest,
      LENS_FOCUS[1] + pose.d * Math.sin(pose.el) + (1.6 * (1 - intro) + p.y * 0.22) * rest,
      LENS_FOCUS[2] + pose.d * ce * Math.cos(pose.az) + 11 * (1 - intro) * rest,
    );
    look.set(pose.lookX, pose.lookY, pose.lookZ);
    camera.lookAt(look);
    if (pose.roll !== 0) camera.rotateZ(pose.roll);

    // Layout framing: lens sits in the left third on desktop (copy is on the right in RTL), higher on phones.
    const w = size.width;
    const h = size.height;
    if (camera instanceof PerspectiveCamera) {
      const fov = (compact ? COMPACT_FOV : wideFov(w / Math.max(1, h))) * pose.fovK;
      if (camera.fov !== fov) camera.fov = fov;
      camera.setViewOffset(w, h, compact ? 0 : w * WIDE_SHIFT * pose.frame, compact ? h * COMPACT_SHIFT * pose.frame : 0, w, h);
    }
  }, -1);

  useEffect(
    () => () => {
      if ('clearViewOffset' in camera) camera.clearViewOffset();
    },
    [camera],
  );
  return null;
}

/** Studio exposure + post levels: lights on with the intro, the set goes dark and the image streaks as the iris closes. */
function Exposure({ fx, fogFar }: { fx: StudioFx; fogFar: number }) {
  const scene = useThree((s) => s.scene);
  useFrame(() => {
    const intro = introProgress();
    const t = heroState.timeline;
    scene.environmentIntensity = (0.04 + 0.96 * smoothstep(0.05, 0.6, intro)) * (1 - smoothstep(0.74, 0.88, t) * 0.92);
    const push = smoothstep(0.64, 0.84, t);
    fx.aberration = 1 + 7 * push;
    fx.vignette = 0.74 + 0.2 * push;
    // the wide reveal of the orbit pulls the haze back so the far screens stay readable
    const fog = scene.fog;
    if (fog instanceof Fog) {
      const open = smoothstep(0.32, 0.5, t) * (1 - smoothstep(0.58, 0.66, t));
      fog.near = 10 + 5 * open;
      fog.far = fogFar + 8 * open;
    }
  });
  return null;
}

function ReadySignal({ onReady }: { onReady: () => void }) {
  const frames = useRef(0);
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    frames.current++;
    if (frames.current >= 3) {
      done.current = true;
      // Returning to the home page (loader long gone): play the dolly-in again once the scene is live —
      // but only on the opening frame, never when the scene remounts mid-choreography.
      const now = performance.now();
      if (boot.isDismissed() && heroState.progress < 0.04 && (heroState.introAt === null || now - heroState.introAt > 4000)) heroState.introAt = now;
      onReady();
    }
  });
  return null;
}

export default function HeroScene({ videos, accent, mark, tier, lockTier, active, decode, compact, reducedMotion, onReady, onFatal }: HeroSceneProps) {
  const [currentTier, setCurrentTier] = useState<QualityTier>(tier);
  const [perf, setPerf] = useState(1);
  const profile = qualityProfile(currentTier);
  const fx = useMemo(() => createStudioFx(), []);
  const fogFar = compact ? 30 : 26;
  ensureRectAreaLights();

  useEffect(() => {
    heroState.reducedMotion = reducedMotion;
  }, [reducedMotion]);

  return (
    <Canvas
      dpr={[profile.dpr[0], profile.dpr[0] + (profile.dpr[1] - profile.dpr[0]) * perf]}
      frameloop={QA_STILL ? (active ? 'demand' : 'never') : reducedMotion ? 'demand' : active ? 'always' : 'never'}
      gl={{ antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false }}
      camera={{ fov: compact ? COMPACT_FOV : WIDE_FOV, near: 0.05, far: 70, position: [0, 3.2, 22] }}
      onCreated={({ gl }) => {
        gl.setClearColor('#060607', 1);
        gl.domElement.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          onFatal();
        });
      }}
      aria-hidden="true"
      tabIndex={-1}
    >
      <color attach="background" args={['#060607']} />
      <fog attach="fog" args={['#060607', 10, fogFar]} />
      {!lockTier && (
        <PerformanceMonitor
          factor={1}
          flipflops={3}
          onChange={({ factor }) => setPerf(Math.round(factor * 10) / 10)}
          onDecline={() => setCurrentTier((t) => lowerTier(t))}
          onFallback={() => setCurrentTier('low')}
        />
      )}
      <TimelineDriver reducedMotion={reducedMotion} />
      <Suspense fallback={null}>
        <StudioEnvironment accent={accent} resolution={profile.envResolution} focus={LENS_FOCUS} />
        <Exposure fx={fx} fogFar={fogFar} />
        <spotLight position={[0.5, 7.5, 3.5]} angle={0.42} penumbra={1} intensity={26} distance={20} decay={1.6} color="#ffe2bd" />
        <CameraRig compact={compact} />
        <Lens accent={accent} mark={mark} profile={profile} />
        <PhonesFormation videos={videos} accent={accent} profile={profile} play={active && !reducedMotion} decode={decode} compact={compact} />
        <StudioFloor profile={profile} />
        <StudioEffects profile={profile} focus={[0, 1.3, 0.8]} fx={fx} />
        <ReadySignal onReady={onReady} />
        <SharedTextureRelease />
      </Suspense>
      {import.meta.env.DEV && <DebugHandle name="hero" />}
    </Canvas>
  );
}
