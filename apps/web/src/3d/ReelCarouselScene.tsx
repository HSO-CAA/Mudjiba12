import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { Group, Vector3 } from 'three';
import type { PublicVideo } from '@s5y/shared';
import type { QualityTier } from '../lib/device';
import type { CarouselController } from './carouselController';
import { PHONE } from './geometry';
import { Phone, createPhoneKit } from './Phone';
import { FloorShadow, SharedTextureRelease, StudioEffects, StudioEnvironment, StudioFloor, ensureRectAreaLights } from './Studio';
import { createSoftShadowTexture } from './textures';
import { damp } from './heroState';
import { DebugHandle } from './DebugHandle';
import { lowerTier, qualityProfile, type QualityProfile } from './quality';

export interface ReelCarouselSceneProps {
  videos: PublicVideo[];
  accent: string;
  tier: QualityTier;
  lockTier: boolean;
  active: boolean;
  reducedMotion: boolean;
  compact: boolean;
  controller: CarouselController;
  onFrontChange: (videoIndex: number) => void;
  onOpen: (videoIndex: number) => void;
  onReady: () => void;
}

export function slotCountFor(n: number): number {
  if (n <= 0) return 8;
  if (n >= 8) return n;
  return n * Math.ceil(8 / n);
}

const TAU = Math.PI * 2;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

function Carousel({
  videos,
  accent,
  profile,
  play,
  controller,
  onFrontChange,
  onOpen,
  reducedMotion,
}: {
  videos: PublicVideo[];
  accent: string;
  profile: QualityProfile;
  play: boolean;
  controller: CarouselController;
  onFrontChange: (i: number) => void;
  onOpen: (i: number) => void;
  reducedMotion: boolean;
}) {
  const kit = useMemo(() => createPhoneKit('titanium'), []);
  useEffect(() => () => kit.dispose(), [kit]);
  const shadowMap = useMemo(() => createSoftShadowTexture(), []);
  useEffect(() => () => shadowMap.dispose(), [shadowMap]);
  // leaving the page while hovering a screen must not leave a pointer cursor behind
  useEffect(
    () => () => {
      document.body.style.cursor = '';
    },
    [],
  );
  const ring = useRef<Group>(null);
  const slots = slotCountFor(videos.length);
  const step = TAU / slots;
  const radius = Math.max(2.1, (slots * (PHONE.width + 0.55)) / TAU);
  const front = useRef(-1);
  const [frontSlot, setFrontSlot] = useState(0);
  const powers = useMemo(() => Array.from({ length: slots }, () => ({ current: 1 })), [slots]);

  useEffect(() => {
    controller.slotCount = slots;
    controller.step = step;
  }, [controller, slots, step]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const c = controller;
    const idle = performance.now() - c.lastInteraction > 3500;
    if (c.target !== null) {
      // shortest path to the requested slot
      const desired = -c.target * step;
      let diff = desired - c.rotation;
      diff = ((diff + Math.PI) % TAU + TAU) % TAU - Math.PI;
      c.rotation = damp(c.rotation, c.rotation + diff, 6, dt);
      if (Math.abs(diff) < 0.0015) c.target = null;
      c.velocity = 0;
    } else if (!c.dragging) {
      if (Math.abs(c.velocity) > 0.0005) {
        c.rotation += c.velocity * dt;
        c.velocity *= Math.exp(-3.2 * dt);
      } else if (idle && !reducedMotion) {
        c.rotation -= 0.07 * dt;
      } else {
        // settle on the nearest slot
        const nearest = Math.round(-c.rotation / step);
        c.rotation = damp(c.rotation, -nearest * step, 4, dt);
      }
    }
    if (ring.current) ring.current.rotation.y = c.rotation;

    const slot = ((Math.round(-c.rotation / step) % slots) + slots) % slots;
    if (slot !== front.current) {
      front.current = slot;
      setFrontSlot(slot);
      if (videos.length) onFrontChange(slot % videos.length);
    }
    // dim screens turned away from camera
    for (let i = 0; i < slots; i++) {
      const a = wrap(i * step + c.rotation);
      const facing = Math.cos(a);
      const p = powers[i];
      if (p) p.current = 0.25 + 0.75 * Math.max(0, facing) ** 1.5;
    }
  });

  // decode budget: the videos nearest the front
  const budget = Math.min(profile.maxVideoTextures, videos.length);
  const allowed = new Set<number>();
  if (videos.length) {
    for (let k = 0; allowed.size < budget && k < slots; k++) {
      const forward = (frontSlot + Math.ceil(k / 2) * (k % 2 ? 1 : -1) + slots * 4) % slots;
      allowed.add(forward % videos.length);
    }
  }

  return (
    <group ref={ring}>
      {Array.from({ length: slots }, (_, i) => {
        const vIndex = videos.length ? i % videos.length : -1;
        const video = vIndex >= 0 ? videos[vIndex] : undefined;
        const theta = i * step;
        const near = Math.min(Math.abs(i - frontSlot), slots - Math.abs(i - frontSlot)) <= 1;
        return (
          <group key={i}>
          <FloorShadow map={shadowMap} position={[Math.sin(theta) * radius, Math.cos(theta) * radius]} rotationY={theta} size={[2.1, 0.75]} opacity={0.75} />
          <group position={[Math.sin(theta) * radius, 1.48, Math.cos(theta) * radius]} rotation={[0, theta, 0]}>
            <Phone
              kit={kit}
              videoUrl={video ? (video.previewUrl ?? video.url) : null}
              posterUrl={video?.posterUrl ?? null}
              accent={accent}
              seed={i * 0.41}
              allowVideo={!!video && allowed.has(vIndex) && !reducedMotion}
              play={play && near}
              powerRef={powers[i]}
              areaLight={profile.areaLights && near}
              lightIntensity={2.6}
              onClick={(e) => {
                e.stopPropagation();
                if (controller.dragMoved || vIndex < 0) return;
                if (i === frontSlot) onOpen(vIndex);
                else {
                  controller.target = Math.round(-controller.rotation / step) + (((i - frontSlot + slots + slots / 2) % slots) - slots / 2);
                  controller.lastInteraction = performance.now();
                }
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

function Rig({ radius, compact }: { radius: number; compact: boolean }) {
  const camera = useThree((s) => s.camera);
  const look = useMemo(() => new Vector3(0, 1.3, 0), []);
  const t = useRef(0);
  useFrame((state, delta) => {
    t.current += delta;
    const px = state.pointer.x;
    const py = state.pointer.y;
    const z = radius + (compact ? 9.2 : 7.4);
    camera.position.x = damp(camera.position.x, px * 0.35, 2.5, delta);
    camera.position.y = damp(camera.position.y, 2.05 + py * 0.18, 2.5, delta);
    camera.position.z = damp(camera.position.z, z, 2.5, delta);
    camera.lookAt(look);
  });
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

export default function ReelCarouselScene(props: ReelCarouselSceneProps) {
  const { videos, accent, tier, lockTier, active, reducedMotion, compact, controller, onFrontChange, onOpen, onReady } = props;
  const [currentTier, setCurrentTier] = useState<QualityTier>(tier);
  const [perf, setPerf] = useState(1);
  const profile = qualityProfile(currentTier);
  const slots = slotCountFor(videos.length);
  const radius = Math.max(2.1, (slots * (PHONE.width + 0.55)) / TAU);
  ensureRectAreaLights();

  return (
    <Canvas
      dpr={[profile.dpr[0], profile.dpr[0] + (profile.dpr[1] - profile.dpr[0]) * perf]}
      frameloop={active ? (reducedMotion ? 'demand' : 'always') : 'never'}
      gl={{ antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false }}
      camera={{ fov: compact ? 42 : 30, near: 0.1, far: 60, position: [0, 2.05, radius + 8.2] }}
      onCreated={({ gl }) => gl.setClearColor('#060607', 1)}
      onPointerMissed={() => {
        document.body.style.cursor = '';
      }}
    >
      <color attach="background" args={['#060607']} />
      <fog attach="fog" args={['#060607', radius + 7, radius + 20]} />
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
        <StudioEnvironment accent={accent} resolution={profile.envResolution} focus={[0, 1.4, radius]} />
        <spotLight position={[0, 8, radius + 2]} angle={0.5} penumbra={1} intensity={22} distance={22} decay={1.6} color="#ffe2bd" />
        <Carousel
          videos={videos}
          accent={accent}
          profile={profile}
          play={active && !reducedMotion}
          controller={controller}
          onFrontChange={onFrontChange}
          onOpen={onOpen}
          reducedMotion={reducedMotion}
        />
        <StudioFloor profile={profile} />
        <Rig radius={radius} compact={compact} />
        <StudioEffects profile={{ ...profile, depthOfField: false }} focus={[0, 1.4, radius]} />
        <Ready onReady={onReady} />
        <SharedTextureRelease />
      </Suspense>
      {import.meta.env.DEV && <DebugHandle name="reel" />}
    </Canvas>
  );
}
