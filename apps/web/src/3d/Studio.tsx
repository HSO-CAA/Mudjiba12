import { useEffect, useMemo } from 'react';
import { Environment, Lightformer, MeshReflectorMaterial } from '@react-three/drei';
import { Bloom, ChromaticAberration, DepthOfField, EffectComposer, FXAA, Noise, ToneMapping, Vignette } from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode } from 'postprocessing';
import { HalfFloatType, Vector2 } from 'three';
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
 * Photographic studio lighting baked into an environment cube from Lightformers (no HDRI downloads):
 * an overhead softbox, a front ring light (the circular highlight in the glass), cool + warm rim strips,
 * a back top strip and a low accent bounce.
 */
export function StudioEnvironment({ accent, resolution, focus = [0, 1.3, 0] }: { accent: string; resolution: number; focus?: [number, number, number] }) {
  return (
    <Environment resolution={resolution} frames={1} background={false}>
      <Lightformer form="rect" intensity={2.6} position={[0, 6.5, 1.5]} rotation={[Math.PI / 2, 0, 0]} scale={[9, 3.4, 1]} />
      <Lightformer form="ring" intensity={2.4} position={[0.6, 1.6, 9]} scale={2.4} target={focus} />
      <Lightformer form="rect" intensity={6} color="#dfe8ff" position={[-6.5, 2.6, 2.5]} scale={[0.6, 7.5, 1]} target={focus} />
      <Lightformer form="rect" intensity={3.2} color="#dfe8ff" position={[-7.5, 2.4, -3]} scale={[0.5, 7, 1]} target={focus} />
      <Lightformer form="rect" intensity={4} color="#ffd8a8" position={[6.5, 2.4, 2]} scale={[0.65, 7, 1]} target={focus} />
      <Lightformer form="rect" intensity={2.4} position={[0, 7, -1]} rotation={[Math.PI / 2, 0, 0]} scale={[6, 0.35, 1]} />
      <Lightformer form="rect" intensity={1.8} position={[0, 4.6, -8]} scale={[13, 0.4, 1]} target={focus} />
      <Lightformer form="circle" intensity={0.8} color={accent} position={[-3, 0.6, 6.5]} scale={1.8} target={focus} />
      <Lightformer form="circle" intensity={0.9} color="#a8b4ff" position={[4, 5, 6]} scale={1.4} target={focus} />
    </Environment>
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

/** Filmic post: bloom (screens + speculars), optional DOF, neutral tone mapping, vignette and grain. */
export function StudioEffects({ profile, focus = [0, 1.3, 0.6] }: { profile: QualityProfile; focus?: [number, number, number] }) {
  const effects = [
    profile.depthOfField ? <DepthOfField key="dof" target={focus} worldFocusRange={6} bokehScale={1.6} resolutionScale={0.5} /> : null,
    <Bloom key="bloom" mipmapBlur intensity={0.8} luminanceThreshold={0.58} luminanceSmoothing={0.24} radius={0.74} />,
    profile.tier !== 'low' ? (
      <ChromaticAberration key="ca" offset={CA_OFFSET} radialModulation modulationOffset={0.32} />
    ) : null,
    <ToneMapping key="tm" mode={ToneMappingMode.NEUTRAL} />,
    profile.msaa === 0 ? <FXAA key="fxaa" /> : null,
    <Vignette key="vig" offset={0.26} darkness={0.74} />,
    <Noise key="noise" premultiply blendFunction={BlendFunction.SCREEN} opacity={0.32} />,
  ].filter((e) => e !== null);
  return (
    <EffectComposer multisampling={profile.msaa} frameBufferType={HalfFloatType} enableNormalPass={false}>
      {effects}
    </EffectComposer>
  );
}
