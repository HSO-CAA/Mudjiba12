import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  Group,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RectAreaLight,
  Vector3,
  type ShaderMaterial,
} from 'three';
import { createPhoneGeometries, PHONE, PHONE_FRONT_Z } from './geometry';
import { createPlaceholderMaterial } from './materials';
import { sampleAverageColor, useScreenMedia } from './videoTextures';

export type PhoneKit = ReturnType<typeof createPhoneKit>;

/** Geometries + shared materials for every phone in a scene (created once). */
export function createPhoneKit(finish: 'titanium' | 'graphite' = 'titanium') {
  const geos = createPhoneGeometries(PHONE);
  const frame = new MeshPhysicalMaterial({
    color: finish === 'titanium' ? '#8e8b86' : '#2e2e33',
    metalness: 1,
    roughness: 0.26,
    clearcoat: 0.2,
    clearcoatRoughness: 0.3,
  });
  const black = new MeshStandardMaterial({ color: '#020203', metalness: 0.2, roughness: 0.35 });
  const back = new MeshPhysicalMaterial({ color: finish === 'titanium' ? '#6f6c68' : '#1d1d21', metalness: 0.35, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.25 });
  const lensGlass = new MeshPhysicalMaterial({ color: '#05060c', metalness: 0.2, roughness: 0.05, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.5, iridescenceThicknessRange: [300, 700] });
  // Specular-only glass layer: black diffuse + additive blending = pure reflections of the studio lights.
  const glass = new MeshPhysicalMaterial({
    color: '#000000',
    metalness: 0,
    roughness: 0.06,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    envMapIntensity: 0.9,
  });
  return {
    geos,
    frame,
    black,
    glass,
    back,
    lensGlass,
    dispose() {
      Object.values(geos).forEach((g) => typeof g === 'object' && g.dispose());
      frame.dispose();
      black.dispose();
      glass.dispose();
      back.dispose();
      lensGlass.dispose();
    },
  };
}

export interface PhoneProps {
  kit: PhoneKit;
  videoUrl: string | null;
  posterUrl: string | null;
  accent: string;
  seed: number;
  /** Decode the video (else poster only). */
  allowVideo: boolean;
  play: boolean;
  /** Screen brightness multiplier (0 = off). Animated by the parent through `powerRef`. */
  powerRef?: { current: number };
  areaLight?: boolean;
  lightIntensity?: number;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  onPointerOver?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut?: (e: ThreeEvent<PointerEvent>) => void;
  children?: ReactNode;
}

const tmp = new Vector3();

/** A modern phone (titanium frame, bezel, island, glass) whose screen plays a clip as a texture and lights the set. */
export function Phone({
  kit,
  videoUrl,
  posterUrl,
  accent,
  seed,
  allowVideo,
  play,
  powerRef,
  areaLight = false,
  lightIntensity = 3.2,
  onClick,
  onPointerOver,
  onPointerOut,
  children,
}: PhoneProps) {
  const { geos } = kit;
  const media = useScreenMedia(videoUrl, posterUrl, geos.screenAspect, { play, allowVideo });
  const lightRef = useRef<RectAreaLight>(null);
  const holder = useRef<Group>(null);
  const spill = useRef({ color: new Color(accent), target: new Color(accent), accent: new Color(accent), last: 0 });

  const screenMat = useMemo(() => new MeshBasicMaterial({ color: '#000000', toneMapped: true }), []);
  const placeholder = useMemo<ShaderMaterial>(() => createPlaceholderMaterial(accent, seed), [accent, seed]);
  useEffect(() => () => screenMat.dispose(), [screenMat]);
  useEffect(() => () => placeholder.dispose(), [placeholder]);

  const invalidate = useThree((st) => st.invalidate);
  useLayoutEffect(() => {
    screenMat.map = media.texture;
    screenMat.needsUpdate = true;
    invalidate(); // on-demand frameloop (reduced motion) must redraw with the new texture
  }, [media.texture, screenMat, invalidate]);

  useLayoutEffect(() => {
    const light = lightRef.current;
    const parent = holder.current;
    if (!light || !parent) return;
    parent.updateWorldMatrix(true, false);
    light.lookAt(parent.localToWorld(tmp.set(0, -0.6, 4)));
  });

  useFrame((state) => {
    const power = powerRef ? powerRef.current : 1;
    const hasMedia = !!media.texture;
    if (hasMedia) {
      screenMat.color.setScalar(power * 1.08);
    } else {
      (placeholder.uniforms.uPower as { value: number }).value = power * 0.7;
      (placeholder.uniforms.uTime as { value: number }).value = state.clock.elapsedTime;
    }
    const s = spill.current;
    const now = state.clock.elapsedTime;
    if (media.source && now - s.last > 0.25) {
      s.last = now;
      if (sampleAverageColor(media.source, s.target)) {
        // keep the spill saturated but never muddy
        s.target.lerp(s.accent, 0.25);
      }
    }
    s.color.lerp(s.target, 0.08);
    if (lightRef.current) {
      lightRef.current.color.copy(s.color);
      lightRef.current.intensity = lightIntensity * power;
    }
  });

  const z = PHONE_FRONT_Z;
  return (
    <group ref={holder}>
      <mesh geometry={geos.frame} material={kit.frame} />
      <mesh geometry={geos.black} material={kit.black} />
      <mesh
        geometry={geos.screen}
        material={media.texture ? screenMat : placeholder}
        onClick={onClick}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
      />
      <mesh geometry={geos.frontGlass} material={kit.glass} />
      <mesh geometry={geos.backGlass} material={kit.back} />
      <mesh geometry={geos.lensGlass} material={kit.lensGlass} />
      {areaLight && (
        <rectAreaLight
          ref={lightRef}
          width={PHONE.width * 0.92}
          height={PHONE.height * 0.92}
          intensity={0}
          position={[0, 0, z + 0.04]}
        />
      )}
      {children}
    </group>
  );
}
