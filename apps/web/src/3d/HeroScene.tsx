import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { Group, PerspectiveCamera, Vector3 } from 'three';
import type { PublicVideo } from '@s5y/shared';
import type { QualityTier } from '../lib/device';
import { boot } from '../app/loading';
import { Lens } from './Lens';
import { Phone, createPhoneKit } from './Phone';
import { FloorShadow, SharedTextureRelease, StudioEffects, StudioEnvironment, StudioFloor, ensureRectAreaLights } from './Studio';
import { createSoftShadowTexture } from './textures';
import { clamp01, damp, easeInOutCubic, easeOutExpo, heroState, smoothstep } from './heroState';
import { DebugHandle } from './DebugHandle';
import { lowerTier, qualityProfile, type QualityProfile } from './quality';

export interface HeroSceneProps {
  videos: PublicVideo[];
  accent: string;
  mark: string;
  tier: QualityTier;
  /** Keep the tier fixed (QA override) instead of adapting to the measured frame rate. */
  lockTier: boolean;
  /** Render + decode only while the hero is on screen and the tab is visible. */
  active: boolean;
  compact: boolean;
  reducedMotion: boolean;
  onReady: () => void;
  onFatal: () => void;
}

const LENS_FOCUS: [number, number, number] = [0, 1.3, 0];

function introProgress(): number {
  if (heroState.reducedMotion) return 1;
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

function PhonesArc({ videos, accent, profile, play, compact }: { videos: PublicVideo[]; accent: string; profile: QualityProfile; play: boolean; compact: boolean }) {
  const kit = useMemo(() => createPhoneKit('titanium'), []);
  useEffect(() => () => kit.dispose(), [kit]);
  const shadowMap = useMemo(() => createSoftShadowTexture(), []);
  useEffect(() => () => shadowMap.dispose(), [shadowMap]);
  const size = useThree((s) => s.size);
  const aspect = Math.round((size.width / Math.max(1, size.height)) * 50) / 50;
  const count = compact ? COMPACT_SLOTS.length : Math.min(WIDE_SLOTS.length, Math.max(5, videos.length));
  const slots = useMemo(() => placeSlots(count, aspect, compact), [count, aspect, compact]);
  const powers = useMemo(() => slots.map(() => ({ current: 0 })), [slots]);
  const bobs = useRef<(Group | null)[]>([]);
  // phones: at most three decoders (the front row); the deep row shows posters
  const decodeBudget = Math.min(compact ? Math.min(3, profile.maxVideoTextures) : profile.maxVideoTextures, videos.length);

  useFrame((state) => {
    const intro = introProgress();
    const p = heroState.progress;
    const t = state.clock.elapsedTime;
    slots.forEach((slot, i) => {
      const pw = powers[i];
      if (pw) pw.current = slot.dim * smoothstep(slot.delay, slot.delay + 0.22, intro) * (1 - smoothstep(0.55, 0.95, p) * 0.85);
      const g = bobs.current[i];
      if (g && !heroState.reducedMotion) g.position.y = Math.sin(t * 0.55 + i * 1.7) * 0.035;
    });
  });

  return (
    <group>
      {slots.map((slot, i) => {
        const video = videos.length ? videos[slot.rank % videos.length] : undefined;
        const allowVideo = !!video && slot.rank < decodeBudget;
        return (
          <group key={i}>
            <group position={slot.position} rotation={slot.rotation}>
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
                />
              </group>
            </group>
            <FloorShadow map={shadowMap} position={[slot.position[0], slot.position[2]]} rotationY={slot.rotation[1]} size={[2.1, 0.75]} opacity={0.75} />
          </group>
        );
      })}
    </group>
  );
}

function CameraRig({ compact }: { compact: boolean }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const pos = useRef(new Vector3(0, 2.6, 22));
  const look = useRef(new Vector3(...LENS_FOCUS));
  const smoothP = useRef(0);
  const target = useMemo(() => new Vector3(), []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.25);
    const intro = easeOutExpo(introProgress());
    smoothP.current = damp(smoothP.current, heroState.progress, 5, dt);
    const p = smoothP.current;
    const push = easeInOutCubic(smoothstep(0.02, 0.92, p));

    const base = compact ? COMPACT_BASE : WIDE_BASE;
    const start = [base[0] ?? 0, (base[1] ?? 0) + 1.6, (base[2] ?? 0) + 11];
    const inside = [0, 1.31, 1.42];
    const reduced = heroState.reducedMotion;
    const px = reduced ? 0 : heroState.pointerX;
    const py = reduced ? 0 : heroState.pointerY;

    for (let k = 0; k < 3; k++) {
      const introVal = (start[k] ?? 0) + ((base[k] ?? 0) - (start[k] ?? 0)) * intro;
      target.setComponent(k, introVal + ((inside[k] ?? 0) - introVal) * push);
    }
    target.x += px * 0.45 * (1 - push);
    target.y += py * 0.22 * (1 - push);

    if (reduced) pos.current.copy(target);
    else {
      pos.current.x = damp(pos.current.x, target.x, 3.5, dt);
      pos.current.y = damp(pos.current.y, target.y, 3.5, dt);
      pos.current.z = damp(pos.current.z, target.z, 3.5, dt);
    }
    camera.position.copy(pos.current);
    look.current.set(LENS_FOCUS[0], LENS_FOCUS[1] - 0.05 * (1 - push), LENS_FOCUS[2]);
    camera.lookAt(look.current);

    // Layout framing: lens sits in the left third on desktop (copy is on the right in RTL), higher on phones.
    const w = size.width;
    const h = size.height;
    const ox = compact ? 0 : w * WIDE_SHIFT * (1 - push);
    const oy = compact ? h * COMPACT_SHIFT * (1 - push) : 0;
    if (camera instanceof PerspectiveCamera) {
      const fov = compact ? COMPACT_FOV : wideFov(w / Math.max(1, h));
      if (camera.fov !== fov) camera.fov = fov; // rotating a tablet can flip the layout after creation
      camera.setViewOffset(w, h, ox, oy, w, h);
    }
  });

  useEffect(
    () => () => {
      if ('clearViewOffset' in camera) camera.clearViewOffset();
    },
    [camera],
  );
  return null;
}

/** Studio exposure: environment intensity ramps up with the intro ("lights on"). */
function Exposure() {
  const scene = useThree((s) => s.scene);
  useFrame(() => {
    const intro = introProgress();
    const p = heroState.progress;
    scene.environmentIntensity = (0.04 + 0.96 * smoothstep(0.05, 0.6, intro)) * (1 - smoothstep(0.6, 0.98, p) * 0.9);
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
      // Returning to the home page (loader long gone): play the dolly-in again once the scene is live.
      const now = performance.now();
      if (boot.isDismissed() && (heroState.introAt === null || now - heroState.introAt > 4000)) heroState.introAt = now;
      onReady();
    }
  });
  return null;
}

export default function HeroScene({ videos, accent, mark, tier, lockTier, active, compact, reducedMotion, onReady, onFatal }: HeroSceneProps) {
  const [currentTier, setCurrentTier] = useState<QualityTier>(tier);
  const [perf, setPerf] = useState(1);
  const profile = qualityProfile(currentTier);
  ensureRectAreaLights();

  useEffect(() => {
    heroState.reducedMotion = reducedMotion;
  }, [reducedMotion]);

  return (
    <Canvas
      dpr={[profile.dpr[0], profile.dpr[0] + (profile.dpr[1] - profile.dpr[0]) * perf]}
      frameloop={reducedMotion ? 'demand' : active ? 'always' : 'never'}
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
      <fog attach="fog" args={['#060607', 10, compact ? 30 : 26]} />
      {!lockTier && (
        <PerformanceMonitor
          factor={1}
          flipflops={3}
          onChange={({ factor }) => setPerf(Math.round(factor * 10) / 10)}
          onDecline={() => setCurrentTier((t) => lowerTier(t))}
          onFallback={() => setCurrentTier('low')}
        />
      )}
      <Suspense fallback={null}>
        <StudioEnvironment accent={accent} resolution={profile.envResolution} focus={LENS_FOCUS} />
        <Exposure />
        <spotLight position={[0.5, 7.5, 3.5]} angle={0.42} penumbra={1} intensity={26} distance={20} decay={1.6} color="#ffe2bd" />
        <Lens accent={accent} mark={mark} profile={profile} />
        <PhonesArc videos={videos} accent={accent} profile={profile} play={active && !reducedMotion} compact={compact} />
        <StudioFloor profile={profile} />
        <CameraRig compact={compact} />
        <StudioEffects profile={profile} focus={[0, 1.3, 0.8]} />
        <ReadySignal onReady={onReady} />
        <SharedTextureRelease />
      </Suspense>
      {import.meta.env.DEV && <DebugHandle name="hero" />}
    </Canvas>
  );
}
