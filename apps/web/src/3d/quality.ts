import type { QualityTier } from '../lib/device';

export interface QualityProfile {
  tier: QualityTier;
  /** Device-pixel-ratio range handed to the Canvas (AdaptiveDpr moves inside it). */
  dpr: [number, number];
  /** MSAA samples on the post-processing buffers. */
  msaa: number;
  reflectorResolution: number;
  reflectorBlur: [number, number];
  reflectorStrength: number;
  /** Physical transmission on the front glass (an extra render pass). */
  transmission: boolean;
  /** Max simultaneously decoding video textures; the rest show posters. */
  maxVideoTextures: number;
  depthOfField: boolean;
  /** Coloured area lights that let the screens light the floor and lens. */
  areaLights: boolean;
  envResolution: number;
  radialSegments: number;
}

const PROFILES: Record<QualityTier, QualityProfile> = {
  low: {
    tier: 'low',
    dpr: [1, 1.25],
    msaa: 2,
    reflectorResolution: 256,
    reflectorBlur: [220, 80],
    reflectorStrength: 48,
    transmission: false,
    maxVideoTextures: 3,
    depthOfField: false,
    areaLights: false,
    envResolution: 128,
    radialSegments: 96,
  },
  medium: {
    tier: 'medium',
    dpr: [1, 1.5],
    msaa: 4,
    reflectorResolution: 512,
    reflectorBlur: [300, 100],
    reflectorStrength: 64,
    transmission: true,
    maxVideoTextures: 5,
    depthOfField: false,
    areaLights: true,
    envResolution: 256,
    radialSegments: 128,
  },
  high: {
    tier: 'high',
    dpr: [1, 1.75],
    msaa: 4,
    reflectorResolution: 1024,
    reflectorBlur: [400, 120],
    reflectorStrength: 80,
    transmission: true,
    maxVideoTextures: 7,
    depthOfField: true,
    areaLights: true,
    envResolution: 256,
    radialSegments: 160,
  },
};

export function qualityProfile(tier: QualityTier): QualityProfile {
  return PROFILES[tier];
}

export function lowerTier(tier: QualityTier): QualityTier {
  return tier === 'high' ? 'medium' : 'low';
}
