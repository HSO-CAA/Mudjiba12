import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, MeshReflectorMaterial } from '@react-three/drei';
import { Bloom, ChromaticAberration, DepthOfField, EffectComposer, FXAA, Noise, ToneMapping, Vignette } from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode, type ChromaticAberrationEffect, type VignetteEffect } from 'postprocessing';
import { HalfFloatType, UniformsLib, Vector2, type Material, type Mesh, type Texture } from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { createNoiseTexture } from './textures';
import type { QualityProfile } from './quality';

let rectLightsReady = false;
/** RectAreaLight needs its LTC lookup tables registered once per page. */
export function ensureRectAreaLights(): void {
  if (rectLightsReady) return;
  RectAreaLightUniformsLib.init();
  rectLightsReady = true;
}

/**
 * three.js keeps a few lookup textures as page-global singletons: the LTC tables used by RectAreaLights and
 * the DFG LUT used by every MeshStandard/PhysicalMaterial (r186). Every renderer that uploads them registers
 * a `dispose` listener on them that captures its GL context, and nothing ever removes it. Without this, each
 * unmounted scene's renderer and canvas would stay reachable forever, so memory would grow on every
 * home ↔ place navigation. Mount this inside every Canvas: on unmount it disposes the shared textures, which
 * drops those listeners (the next scene simply re-uploads them; they are tiny).
 */
export function SharedTextureRelease() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const dfg = useRef<Texture | null>(null);
  const tries = useRef(0);
  useFrame(() => {
    if (dfg.current || tries.current > 240) return;
    tries.current++;
    scene.traverse((o) => {
      if (dfg.current) return;
      const mat = (o as Mesh).material as Material | Material[] | undefined;
      for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        const uniforms = (gl.properties.get(m) as { uniforms?: Record<string, { value: unknown } | undefined> }).uniforms;
        const lut = uniforms?.dfgLUT?.value as Texture | null | undefined;
        if (lut?.isTexture) {
          dfg.current = lut;
          break;
        }
      }
    });
  });
  useEffect(
    () => () => {
      dfg.current?.dispose();
      const lib = UniformsLib as unknown as Record<string, Texture | undefined>;
      for (const key of ['LTC_FLOAT_1', 'LTC_FLOAT_2', 'LTC_HALF_1', 'LTC_HALF_2']) lib[key]?.dispose();
    },
    [],
  );
  return null;
}

/**
 * Photographic studio lighting baked into an environment cube from Lightformers (no HDRI downloads):
 * an overhead softbox, a camera-left key, a front ring light (the circular highlight in the glass),
 * long rim strips behind/above the subject (they draw the edge highlights along black anodised metal),
 * cool + warm side strips and a low accent bounce.
 */
export function StudioEnvironment({ accent, resolution, focus = [0, 1.3, 0] }: { accent: string; resolution: number; focus?: [number, number, number] }) {
  const [fx, fy, fz] = focus;
  return (
    <Environment resolution={resolution} frames={1} background={false}>
      {/* overhead softbox */}
      <Lightformer form="rect" intensity={2.4} position={[fx, 6.5, fz + 1.5]} rotation={[Math.PI / 2, 0, 0]} scale={[9, 3.4, 1]} />
      {/* key: large warm-white softbox, camera-left and a little high */}
      <Lightformer form="rect" intensity={1.35} color="#fff3e4" position={[fx - 6, fy + 2.6, fz + 6.5]} scale={[3.2, 4.2, 1]} target={focus} />
      {/* front ring light → the round catchlight in the glass */}
      <Lightformer form="ring" intensity={2.4} position={[fx + 0.6, 1.6, fz + 9]} scale={2.4} target={focus} />
      {/* rim strips: long and thin, behind and above → crisp edge lines on the barrel, gear teeth and phone frames */}
      <Lightformer form="rect" intensity={6} color="#fff6ea" position={[fx, fy + 4.6, fz - 4.2]} scale={[14, 0.5, 1]} target={focus} />
      <Lightformer form="rect" intensity={4.2} color="#ffe6c4" position={[fx - 5.2, fy + 1.6, fz - 5]} scale={[0.36, 9, 1]} target={focus} />
      <Lightformer form="rect" intensity={3.4} color="#e2eaff" position={[fx + 5.6, fy + 1.4, fz - 4.6]} scale={[0.32, 9, 1]} target={focus} />
      {/* side strips */}
      <Lightformer form="rect" intensity={4.5} color="#dfe8ff" position={[fx - 6.5, 2.6, fz + 2.5]} scale={[0.6, 7.5, 1]} target={focus} />
      <Lightformer form="rect" intensity={3.6} color="#ffd8a8" position={[fx + 6.5, 2.4, fz + 2]} scale={[0.65, 7, 1]} target={focus} />
      <Lightformer form="rect" intensity={2.2} position={[fx, 7, fz - 1]} rotation={[Math.PI / 2, 0, 0]} scale={[6, 0.35, 1]} />
      <Lightformer form="rect" intensity={1.6} position={[fx, 4.6, fz - 8]} scale={[13, 0.4, 1]} target={focus} />
      {/* bounces */}
      <Lightformer form="circle" intensity={0.8} color={accent} position={[fx - 3, 0.6, fz + 6.5]} scale={1.8} target={focus} />
      <Lightformer form="circle" intensity={0.7} color="#a8b4ff" position={[fx + 4, 5, fz + 6]} scale={1.4} target={focus} />
    </Environment>
  );
}

/** Feathered contact shadow on the floor under a floating object (cheap: one textured quad, no extra pass). */
export function FloorShadow({
  map,
  position,
  rotationY = 0,
  size,
  opacity = 0.7,
}: {
  map: Texture;
  position: [number, number];
  rotationY?: number;
  size: [number, number];
  opacity?: number;
}) {
  return (
    <mesh position={[position[0], 0.004, position[1]]} rotation={[-Math.PI / 2, 0, rotationY]} scale={[size[0], size[1], 1]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={map} color="#000000" transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

/** Polished dark studio floor: blurred, depth-faded reflections with subtle roughness variation. */
export function StudioFloor({ profile, size = 60 }: { profile: QualityProfile; size?: number }) {
  const noise = useMemo(() => {
    const t = createNoiseTexture(256, 6, 5);
    t.repeat.set(14, 14);
    return t;
  }, []);
  useEffect(() => () => noise.dispose(), [noise]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <planeGeometry args={[size, size]} />
      <MeshReflectorMaterial
        key={`${profile.reflectorResolution}-${profile.reflectorBlur.join('x')}`}
        resolution={profile.reflectorResolution}
        blur={profile.reflectorBlur}
        mixBlur={1}
        mixStrength={profile.reflectorStrength}
        mixContrast={1.05}
        mirror={0.55}
        depthScale={1.2}
        minDepthThreshold={0.3}
        maxDepthThreshold={1.45}
        depthToBlurRatioBias={0.22}
        distortion={0.12}
        distortionMap={noise}
        roughnessMap={noise}
        roughness={0.72}
        metalness={0.6}
        color="#17171b"
        envMapIntensity={0.25}
      />
    </mesh>
  );
}

const CA_OFFSET = new Vector2(0.00055, 0.00035);
const VIGNETTE_DARKNESS = 0.74;

/**
 * Live post-effect levels a scene can animate (mutated in place, read every frame — no React renders):
 * `aberration` multiplies the chromatic fringe, `vignette` is the vignette darkness.
 */
export interface StudioFx {
  aberration: number;
  vignette: number;
}

export function createStudioFx(): StudioFx {
  return { aberration: 1, vignette: VIGNETTE_DARKNESS };
}

/** Filmic post: bloom (screens + speculars), optional DOF, neutral tone mapping, vignette and grain. */
export function StudioEffects({ profile, focus = [0, 1.3, 0.6], fx }: { profile: QualityProfile; focus?: [number, number, number]; fx?: StudioFx }) {
  const ca = useRef<ChromaticAberrationEffect>(null);
  const vignette = useRef<VignetteEffect>(null);
  useFrame(() => {
    if (!fx) return;
    if (ca.current) ca.current.offset.set(CA_OFFSET.x * fx.aberration, CA_OFFSET.y * fx.aberration);
    if (vignette.current) vignette.current.darkness = fx.vignette;
  });
  const effects = [
    profile.depthOfField ? <DepthOfField key="dof" target={focus} worldFocusRange={6} bokehScale={1.6} resolutionScale={0.5} /> : null,
    <Bloom key="bloom" mipmapBlur intensity={0.8} luminanceThreshold={0.58} luminanceSmoothing={0.24} radius={0.74} />,
    profile.tier !== 'low' ? (
      <ChromaticAberration key="ca" ref={ca} offset={CA_OFFSET} radialModulation modulationOffset={0.32} />
    ) : null,
    <ToneMapping key="tm" mode={ToneMappingMode.NEUTRAL} />,
    profile.msaa === 0 ? <FXAA key="fxaa" /> : null,
    <Vignette key="vig" ref={vignette} offset={0.26} darkness={VIGNETTE_DARKNESS} />,
    <Noise key="noise" premultiply blendFunction={BlendFunction.SCREEN} opacity={0.2} />,
  ].filter((e) => e !== null);
  return (
    <EffectComposer multisampling={profile.msaa} frameBufferType={HalfFloatType} enableNormalPass={false}>
      {effects}
    </EffectComposer>
  );
}
