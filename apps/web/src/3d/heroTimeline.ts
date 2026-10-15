import { createTrack, sampleTrack, trackSample } from './track';

/**
 * The hero's scroll choreography — one normalised timeline (0 → 1 across the pinned runway) shared by the
 * HTML overlays and the WebGL scene. No three.js imports: the HTML side lives in the main chunk.
 *
 *   rest      0.00 – 0.07  the studio at rest, copy on screen
 *   focus     0.07 – 0.30  camera arcs around the lens while the focus ring pulls focus
 *   formation 0.30 – 0.58  the phones break formation into a rising spiral, the camera pulls back to reveal it
 *   iris      0.58 – 0.86  the phones open into a halo, the iris stops down, the camera pushes through the lens
 *   cut       0.86 – 1.00  black + chapter card, the page scrolls on
 */
export interface HeroStage {
  code: string;
  from: number;
  to: number;
}

export const HERO_STAGES: HeroStage[] = [
  { code: 'FOCUS PULL', from: 0.07, to: 0.3 },
  { code: 'FORMATION', from: 0.3, to: 0.58 },
  { code: 'STOP DOWN', from: 0.58, to: 0.86 },
  { code: 'CUT TO', from: 0.86, to: 1 },
];

/** Index of the stage at `p` (-1 = the opening frame). */
export function heroStageAt(p: number): number {
  if (p < (HERO_STAGES[0]?.from ?? 0)) return -1;
  for (let i = HERO_STAGES.length - 1; i >= 0; i--) if (p >= (HERO_STAGES[i] as HeroStage).from) return i;
  return -1;
}

/** Frames of "footage" the runway represents (drives the HUD timecode / frame counter). */
export const HERO_FRAMES = 288;

/** Overlay cue points for the HTML layer (fractions of the runway). */
export const HERO_CUES = {
  cinematic: {
    copy: [0, 0.06] as const,
    copyMove: [0, 0.085] as const,
    cue: [0, 0.03] as const,
    captions: [
      [0.105, 0.135, 0.255, 0.285],
      [0.355, 0.385, 0.515, 0.545],
      [0.635, 0.66, 0.755, 0.785],
    ] as const,
    blackout: [0.8, 0.875] as const,
    covered: 0.9,
    chapter: [0.865, 0.935] as const,
    hud: [0, 0.86, 0.92] as const,
  },
  simple: {
    copy: [0, 0.22] as const,
    copyMove: [0, 0.3] as const,
    cue: [0, 0.08] as const,
    captions: [] as readonly (readonly [number, number, number, number])[],
    blackout: [0.7, 0.9] as const,
    covered: 0.93,
    chapter: [0.84, 0.95] as const,
    hud: [0, 0.9, 1] as const,
  },
};

/** Phone formations: rest arc → rising spiral → halo around the lens front (start/end of each flight). */
export const HERO_FORMATION = {
  spiral: [0.3, 0.44] as const,
  spiralStagger: 0.012,
  halo: [0.54, 0.625] as const,
  haloStagger: 0.006,
  /** The halo opens and rushes past the camera as it pushes into the lens. */
  rush: [0.7, 0.845] as const,
};

export const CAMERA_CHANNELS = ['az', 'el', 'd', 'fovK', 'roll', 'frame', 'lookX', 'lookY', 'lookZ'] as const;
export type CameraChannel = (typeof CAMERA_CHANNELS)[number];

/**
 * Camera keys in spherical coordinates around the lens (0, 1.3, 0): azimuth (rad, 0 = +Z), elevation,
 * distance; `fovK` scales the layout's base field of view (dolly zoom), `roll` twists around the view axis,
 * `frame` is how much of the layout's off-centre framing applies (the copy needs it, the stages don't).
 */
const WIDE_CAMERA = createTrack(CAMERA_CHANNELS, [
  { t: 0, az: 0.0213, el: 0.0319, d: 9.41, fovK: 1, roll: 0, frame: 1, lookX: 0, lookY: 1.25, lookZ: 0 },
  { t: 0.07, az: 0, el: 0.06, d: 8.7, fovK: 1, roll: 0, frame: 0.5, lookX: 0, lookY: 1.28, lookZ: 0 },
  { t: 0.3, hold: true, az: -0.74, el: 0.17, d: 5.5, fovK: 1, roll: -0.05, frame: 0, lookX: 0, lookY: 1.3, lookZ: 0.05 },
  { t: 0.42, az: -0.42, el: 0.25, d: 9.2, fovK: 1.06, roll: 0.02, frame: 0, lookX: 0, lookY: 1.95, lookZ: 0 },
  { t: 0.555, hold: true, az: 0.16, el: 0.17, d: 13, fovK: 1.06, roll: 0, frame: 0, lookX: 0, lookY: 2.3, lookZ: 0 },
  { t: 0.665, hold: true, az: 0, el: 0.03, d: 9.6, fovK: 1, roll: 0, frame: 0, lookX: 0, lookY: 1.32, lookZ: 0 },
  { t: 0.81, az: 0, el: 0, d: 1.75, fovK: 1.6, roll: 0.3, frame: 0, lookX: 0, lookY: 1.3, lookZ: 0 },
  { t: 0.88, hold: true, az: 0, el: 0, d: 0.5, fovK: 2.15, roll: 0.55, frame: 0, lookX: 0, lookY: 1.3, lookZ: 0 },
  { t: 1, az: 0, el: 0, d: 0.5, fovK: 2.15, roll: 0.55, frame: 0, lookX: 0, lookY: 1.3, lookZ: 0 },
]);

const COMPACT_CAMERA = createTrack(CAMERA_CHANNELS, [
  { t: 0, az: 0, el: 0.0515, d: 12.62, fovK: 1, roll: 0, frame: 1, lookX: 0, lookY: 1.25, lookZ: 0 },
  { t: 0.07, az: 0, el: 0.07, d: 12, fovK: 1, roll: 0, frame: 0.4, lookX: 0, lookY: 1.3, lookZ: 0 },
  { t: 0.3, hold: true, az: -0.78, el: 0.19, d: 8.1, fovK: 1, roll: -0.05, frame: 0, lookX: 0, lookY: 1.3, lookZ: 0.05 },
  { t: 0.42, az: -0.45, el: 0.23, d: 11, fovK: 1.03, roll: 0.02, frame: 0, lookX: 0, lookY: 2.3, lookZ: 0 },
  { t: 0.555, hold: true, az: 0.14, el: 0.14, d: 15, fovK: 1.03, roll: 0, frame: 0, lookX: 0, lookY: 2.95, lookZ: 0 },
  { t: 0.665, hold: true, az: 0, el: 0.03, d: 11.8, fovK: 1, roll: 0, frame: 0, lookX: 0, lookY: 1.36, lookZ: 0 },
  { t: 0.81, az: 0, el: 0, d: 1.95, fovK: 1.42, roll: 0.3, frame: 0, lookX: 0, lookY: 1.3, lookZ: 0 },
  { t: 0.88, hold: true, az: 0, el: 0, d: 0.5, fovK: 1.78, roll: 0.55, frame: 0, lookX: 0, lookY: 1.3, lookZ: 0 },
  { t: 1, az: 0, el: 0, d: 0.5, fovK: 1.78, roll: 0.55, frame: 0, lookX: 0, lookY: 1.3, lookZ: 0 },
]);

export function cameraTrack(compact: boolean) {
  return compact ? COMPACT_CAMERA : WIDE_CAMERA;
}

export const LENS_CHANNELS = ['yaw', 'pitch', 'ring', 'aperture'] as const;
export type LensChannel = (typeof LENS_CHANNELS)[number];

/** Lens pose: heading/tilt, focus-ring angle (the focus pull) and the iris (fraction of fully open). */
export const LENS_TRACK = createTrack(LENS_CHANNELS, [
  { t: 0, yaw: 0.5, pitch: 0.05, ring: 0, aperture: 1 },
  { t: 0.07, yaw: 0.46, pitch: 0.03, ring: -0.25, aperture: 1 },
  { t: 0.3, hold: true, yaw: 0.24, pitch: 0, ring: -2.7, aperture: 1 },
  { t: 0.555, yaw: 0.1, pitch: 0, ring: -1.5, aperture: 1 },
  { t: 0.64, yaw: 0, pitch: 0, ring: -1.7, aperture: 1 },
  { t: 0.69, yaw: 0, pitch: 0, ring: -2.1, aperture: 0.94 },
  { t: 0.845, hold: true, yaw: 0, pitch: 0, ring: -4.9, aperture: 0 },
  { t: 1, yaw: 0, pitch: 0, ring: -4.9, aperture: 0 },
]);

const focusSample = trackSample(CAMERA_CHANNELS);

/** HUD focus distance (metres) — the camera's real distance to the lens, so the readout tracks the move. */
export function heroFocusMetres(p: number, compact: boolean): number {
  sampleTrack(cameraTrack(compact), p, focusSample);
  return focusSample.d * (compact ? 0.254 : 0.34);
}
