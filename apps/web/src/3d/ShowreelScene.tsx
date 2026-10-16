import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { AdditiveBlending, CanvasTexture, Color, Group, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, SRGBColorSpace, Vector3 } from 'three';
import type { PublicVideo } from '@s5y/shared';
import type { QualityTier } from '../lib/device';
import { DebugHandle } from './DebugHandle';
import { damp, smoothstep } from './heroState';
import { Phone, createPhoneKit } from './Phone';
import { QA_STILL } from './qa';
import { lowerTier, qualityProfile, type QualityProfile } from './quality';
import { showreelState } from './showreelState';
import { SharedTextureRelease, StudioEffects, StudioEnvironment, ensureRectAreaLights } from './Studio';

export interface ShowreelSceneProps {
  videos: PublicVideo[];
  accent: string;
  tier: QualityTier;
  lockTier: boolean;
  /** Holds the render lease (pinned stage on screen, tab visible). */
  active: boolean;
  compact: boolean;
  /** Front reel clicked → open the player. */
  onOpen: (index: number) => void;
  /** Another reel clicked → bring it to the front (the stage scrolls there). */
  onSelect: (index: number) => void;
  onReady: () => void;
}

const TAU = Math.PI * 2;
/** Angle between consecutive reels on the helix (8 per turn: the neighbours still face the camera). */
const STEP = TAU / 8;

interface HelixLayout {
  radius: number;
  /** Vertical drop between consecutive reels. */
  pitch: number;
  /** How far the front reel slides out of the helix towards the camera. */
  pull: number;
  /** Camera distance from the helix axis, height and its offset around the axis (reads the curvature). */
  distance: number;
  lift: number;
  orbit: number;
  fov: number;
}

const WIDE: HelixLayout = { radius: 3.05, pitch: 1.3, pull: 1.45, distance: 12.6, lift: 1.05, orbit: 0.12, fov: 30 };
const COMPACT: HelixLayout = { radius: 2.2, pitch: 1.35, pull: 1.25, distance: 11.8, lift: 0.85, orbit: 0.08, fov: 40 };
/** Reels further than this (in reel steps) from the parked one are not drawn; the back of the helix shows phone backs. */
const VISIBLE = 3.4;
/** Heading of the parked (front) reel around the helix axis. */
const FRONT_AZ = 0.2;
/** Desktop: the title panel owns the right side (RTL start), so the helix is framed left of centre. */
const WIDE_SHIFT = 0.16;
const COMPACT_SHIFT = 0.12;

/** Soft accent glow on a far backdrop: depth behind the helix without a floor. */
function createGlowTexture(accent: string): CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const col = new Color(accent);
    const rgb = `${Math.round(col.r * 255)}, ${Math.round(col.g * 255)}, ${Math.round(col.b * 255)}`;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // near-gaussian falloff: a pool of light with no visible edge
    g.addColorStop(0, `rgba(${rgb}, 0.09)`);
    g.addColorStop(0.25, `rgba(${rgb}, 0.058)`);
    g.addColorStop(0.5, `rgba(${rgb}, 0.024)`);
    g.addColorStop(0.75, `rgba(${rgb}, 0.006)`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function Helix({
  videos,
  accent,
  profile,
  play,
  compact,
  onOpen,
  onSelect,
}: {
  videos: PublicVideo[];
  accent: string;
  profile: QualityProfile;
  play: boolean;
  compact: boolean;
  onOpen: (i: number) => void;
  onSelect: (i: number) => void;
}) {
  const L = compact ? COMPACT : WIDE;
  const n = videos.length;
  const kit = useMemo(() => {
    const k = createPhoneKit('titanium');
    // the screens face the camera head-on: keep only a faint sheen of the studio lights over the picture
    k.glass.opacity = 0.28;
    return k;
  }, []);
  useEffect(
    () => () => {
      kit.dispose();
      document.body.style.cursor = '';
    },
    [kit],
  );

  const group = useRef<Group>(null);
  const holders = useRef<(Group | null)[]>([]);
  const powers = useMemo(() => videos.map(() => ({ current: 0.3 })), [videos]);
  const s = useRef(showreelState.target);
  const [front, setFront] = useState(() => Math.min(n - 1, Math.max(0, Math.round(showreelState.target))));
  const frontRef = useRef(front);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const target = showreelState.target;
    s.current = QA_STILL ? target : damp(s.current, target, 5.5, Math.min(delta, 0.1));
    const pos = s.current;
    // the helix turns and rises so reel `pos` is parked in front of the camera; the next reels wait
    // below-left (RTL: "next" is to the left), the ones already seen rise away to the right
    g.rotation.y = FRONT_AZ + pos * STEP;
    g.position.y = pos * L.pitch;
    for (let i = 0; i < n; i++) {
      const h = holders.current[i];
      if (!h) continue;
      const d = Math.abs(i - pos);
      const visible = d < VISIBLE;
      h.visible = visible;
      if (!visible) continue;
      // the parked reel slides out of the helix towards the camera and squares up to it
      const f = 1 - smoothstep(0, 1, Math.min(1, d));
      const theta = -i * STEP;
      const r = L.radius + L.pull * f;
      const y = -i * L.pitch;
      h.position.set(Math.sin(theta) * r, y, Math.cos(theta) * r);
      h.rotation.set(0, theta, 0);
      h.scale.setScalar(1 + 0.1 * f);
      const p = powers[i];
      if (p) p.current = 0.32 + 0.68 * (1 - smoothstep(0, 2.2, d));
    }
    const idx = Math.min(n - 1, Math.max(0, Math.round(pos)));
    if (idx !== frontRef.current) {
      frontRef.current = idx;
      setFront(idx);
    }
  });

  // ≤ 3 decoders: the parked reel and its neighbours (posters elsewhere); only the front one plays on phones
  const budget = Math.min(3, profile.maxVideoTextures);

  return (
    <group ref={group}>
      {videos.map((video, i) => {
        const dist = Math.abs(i - front);
        const decode = dist <= (budget >= 3 ? 1 : 0);
        return (
          <group key={video.id}>
            <group
              ref={(g) => {
                holders.current[i] = g;
              }}
            >
              <Phone
                kit={kit}
                videoUrl={video.previewUrl ?? video.url}
                posterUrl={video.posterUrl}
                accent={accent}
                seed={i * 0.53}
                allowVideo={decode}
                play={play && (dist === 0 || (!compact && dist === 1))}
                powerRef={powers[i]}
                areaLight={profile.areaLights && dist === 0}
                lightIntensity={2.6}
                onClick={(e) => {
                  e.stopPropagation();
                  if (i === frontRef.current) onOpen(i);
                  else onSelect(i);
                }}
                onPointerOver={(e) => {
                  e.stopPropagation();
                  document.body.style.cursor = 'pointer';
                }}
                onPointerOut={() => {
                  document.body.style.cursor = '';
                }}
              />
            </group>
          </group>
        );
      })}
    </group>
  );
}

function Backdrop({ accent, compact }: { accent: string; compact: boolean }) {
  const L = compact ? COMPACT : WIDE;
  const res = useMemo(() => {
    const map = createGlowTexture(accent);
    return {
      map,
      geo: new PlaneGeometry(1, 1),
      mat: new MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false, toneMapped: false }),
    };
  }, [accent]);
  useEffect(
    () => () => {
      res.map.dispose();
      res.geo.dispose();
      res.mat.dispose();
    },
    [res],
  );
  // a warm pool of light behind the parked reel (beyond the helix axis), fading out well inside the frame
  const back = L.radius + 3.5;
  return (
    <mesh
      geometry={res.geo}
      material={res.mat}
      position={[-Math.sin(FRONT_AZ) * back, 0.3, -Math.cos(FRONT_AZ) * back]}
      rotation={[0, FRONT_AZ, 0]}
      scale={compact ? 10 : 13}
    />
  );
}

function Rig({ compact }: { compact: boolean }) {
  const camera = useThree((st) => st.camera);
  const size = useThree((st) => st.size);
  const L = compact ? COMPACT : WIDE;
  const look = useMemo(() => new Vector3(), []);
  const pointer = useRef({ x: 0, y: 0 });
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const p = pointer.current;
    p.x = QA_STILL ? 0 : damp(p.x, state.pointer.x, 2.5, dt);
    p.y = QA_STILL ? 0 : damp(p.y, state.pointer.y, 2.5, dt);
    const az = FRONT_AZ + L.orbit + p.x * 0.05;
    camera.position.set(Math.sin(az) * L.distance, L.lift + p.y * 0.3, Math.cos(az) * L.distance);
    const r = (L.radius + L.pull) * 0.85;
    look.set(Math.sin(FRONT_AZ) * r, -0.05, Math.cos(FRONT_AZ) * r);
    camera.lookAt(look);
    if (camera instanceof PerspectiveCamera) {
      const w = size.width;
      const h = size.height;
      let fov = L.fov;
      if (!compact) {
        // narrower landscape screens widen the view so the helix keeps its share of the frame width
        const aspect = w / Math.max(1, h);
        if (aspect < 1.6) fov = Math.min(44, (Math.atan((Math.tan((L.fov * Math.PI) / 360) * 1.6) / aspect) * 360) / Math.PI);
      }
      if (camera.fov !== fov) camera.fov = fov;
      camera.setViewOffset(w, h, compact ? 0 : w * WIDE_SHIFT, compact ? h * COMPACT_SHIFT : 0, w, h);
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

function Ready({ onReady }: { onReady: () => void }) {
  const n = useRef(0);
  useFrame(() => {
    n.current++;
    if (n.current === 3) onReady();
  });
  return null;
}

/** The featured reels as phones on a rig-mounted helix that turns and rises with the scroll. */
export default function ShowreelScene({ videos, accent, tier, lockTier, active, compact, onOpen, onSelect, onReady }: ShowreelSceneProps) {
  const [currentTier, setCurrentTier] = useState<QualityTier>(tier);
  const [perf, setPerf] = useState(1);
  const profile = qualityProfile(currentTier);
  const L = compact ? COMPACT : WIDE;
  const frontPoint: [number, number, number] = [Math.sin(FRONT_AZ) * (L.radius + L.pull), 0, Math.cos(FRONT_AZ) * (L.radius + L.pull)];
  ensureRectAreaLights();

  return (
    <Canvas
      dpr={[profile.dpr[0], profile.dpr[0] + (profile.dpr[1] - profile.dpr[0]) * perf]}
      frameloop={QA_STILL ? (active ? 'demand' : 'never') : active ? 'always' : 'never'}
      gl={{ antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false }}
      camera={{ fov: L.fov, near: 0.1, far: 60, position: [0, L.lift, L.distance] }}
      onCreated={({ gl }) => gl.setClearColor('#060607', 1)}
      onPointerMissed={() => {
        document.body.style.cursor = '';
      }}
      aria-hidden="true"
      tabIndex={-1}
    >
      <color attach="background" args={['#060607']} />
      <fog attach="fog" args={['#060607', L.distance - 2, L.distance + 13]} />
      {!lockTier && (
        <PerformanceMonitor
          factor={1}
          flipflops={3}
          onChange={({ factor }) => setPerf(Math.round(factor * 10) / 10)}
          onDecline={() => setCurrentTier((t) => lowerTier(t))}
          onFallback={() => setCurrentTier('low')}
        />
      )}
      <Rig compact={compact} />
      <Suspense fallback={null}>
        <StudioEnvironment accent={accent} resolution={profile.envResolution} focus={frontPoint} />
        <spotLight position={[frontPoint[0] * 1.6, 6.5, frontPoint[2] * 1.6]} angle={0.5} penumbra={1} intensity={20} distance={22} decay={1.6} color="#ffe2bd" />
        <Backdrop accent={accent} compact={compact} />
        <Helix videos={videos} accent={accent} profile={profile} play={active} compact={compact} onOpen={onOpen} onSelect={onSelect} />
        <StudioEffects profile={profile} focus={frontPoint} />
        <Ready onReady={onReady} />
        <SharedTextureRelease />
      </Suspense>
      {import.meta.env.DEV && <DebugHandle name="showreel" />}
    </Canvas>
  );
}
