import { useEffect, useState } from 'react';
import { Color, SRGBColorSpace, Texture, TextureLoader, VideoTexture } from 'three';

/**
 * Shared, ref-counted video + poster textures for the 3D screens.
 * The same clip on several screens decodes once; posters are cached; everything is disposed when unused.
 */

interface VideoEntry {
  video: HTMLVideoElement;
  texture: VideoTexture;
  refs: number;
  wantPlay: number;
  ready: boolean;
  listeners: Set<() => void>;
}

interface PosterEntry {
  texture: Texture;
  refs: number;
  ready: boolean;
  listeners: Set<() => void>;
}

const videos = new Map<string, VideoEntry>();
const posters = new Map<string, PosterEntry>();
const loader = new TextureLoader();

/** Crops a texture like CSS `object-fit: cover` for a target aspect (width / height). */
export function coverTexture(texture: Texture, mediaAspect: number, targetAspect: number): void {
  if (!Number.isFinite(mediaAspect) || mediaAspect <= 0) return;
  if (mediaAspect > targetAspect) {
    const r = targetAspect / mediaAspect;
    texture.repeat.set(r, 1);
    texture.offset.set((1 - r) / 2, 0);
  } else {
    const r = mediaAspect / targetAspect;
    texture.repeat.set(1, r);
    texture.offset.set(0, (1 - r) / 2);
  }
  texture.needsUpdate = true;
}

function syncPlayback(entry: VideoEntry): void {
  if (entry.wantPlay > 0) {
    if (entry.video.paused) entry.video.play().catch(() => undefined);
  } else if (!entry.video.paused) {
    entry.video.pause();
  }
}

function acquireVideo(src: string, aspect: number): VideoEntry {
  const key = `${src}|${aspect.toFixed(3)}`;
  let entry = videos.get(key);
  if (!entry) {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.src = src;
    const texture = new VideoTexture(video);
    texture.colorSpace = SRGBColorSpace;
    const created: VideoEntry = { video, texture, refs: 0, wantPlay: 0, ready: false, listeners: new Set() };
    const markReady = () => {
      if (!created.ready && video.readyState >= 2) {
        coverTexture(texture, video.videoWidth / video.videoHeight, aspect);
        created.ready = true;
        created.listeners.forEach((l) => l());
      }
    };
    video.addEventListener('loadeddata', markReady);
    video.addEventListener('playing', markReady);
    videos.set(key, created);
    entry = created;
  }
  entry.refs++;
  return entry;
}

function releaseVideo(src: string, aspect: number): void {
  const key = `${src}|${aspect.toFixed(3)}`;
  const entry = videos.get(key);
  if (!entry) return;
  entry.refs--;
  if (entry.refs <= 0) {
    entry.video.pause();
    entry.video.removeAttribute('src');
    entry.video.load();
    entry.texture.dispose();
    videos.delete(key);
  }
}

function acquirePoster(src: string, aspect: number): PosterEntry {
  const key = `${src}|${aspect.toFixed(3)}`;
  let entry = posters.get(key);
  if (!entry) {
    const listeners = new Set<() => void>();
    const state = { ready: false };
    const texture = loader.load(
      src,
      (tex) => {
        const img = tex.image as HTMLImageElement;
        coverTexture(tex, img.width / img.height, aspect);
        state.ready = true;
        created.ready = true;
        listeners.forEach((l) => l());
      },
      undefined,
      () => undefined,
    );
    texture.colorSpace = SRGBColorSpace;
    const created: PosterEntry = { texture, refs: 0, ready: state.ready, listeners };
    posters.set(key, created);
    entry = created;
  }
  entry.refs++;
  return entry;
}

function releasePoster(src: string, aspect: number): void {
  const key = `${src}|${aspect.toFixed(3)}`;
  const entry = posters.get(key);
  if (!entry) return;
  entry.refs--;
  if (entry.refs <= 0) {
    entry.texture.dispose();
    posters.delete(key);
  }
}

export interface ScreenMedia {
  /** Best texture available right now (video when decoding, else poster), or null. */
  texture: Texture | null;
  /** The element to sample colours from. */
  source: HTMLVideoElement | HTMLImageElement | null;
  isVideo: boolean;
}

/**
 * Poster first, then the (muted, looping) video once it has decoded a frame.
 * `play` toggles decoding; `allowVideo=false` keeps the poster only (quality budget / reduced motion).
 */
export function useScreenMedia(
  videoSrc: string | null | undefined,
  posterSrc: string | null | undefined,
  aspect: number,
  { play, allowVideo }: { play: boolean; allowVideo: boolean },
): ScreenMedia {
  const [, force] = useState(0);
  const [videoEntry, setVideoEntry] = useState<VideoEntry | null>(null);
  const [posterEntry, setPosterEntry] = useState<PosterEntry | null>(null);

  useEffect(() => {
    if (!posterSrc) return;
    const entry = acquirePoster(posterSrc, aspect);
    const onReady = () => force((n) => n + 1);
    entry.listeners.add(onReady);
    setPosterEntry(entry);
    return () => {
      entry.listeners.delete(onReady);
      setPosterEntry(null);
      releasePoster(posterSrc, aspect);
    };
  }, [posterSrc, aspect]);

  useEffect(() => {
    if (!videoSrc || !allowVideo) return;
    const entry = acquireVideo(videoSrc, aspect);
    const onReady = () => force((n) => n + 1);
    entry.listeners.add(onReady);
    setVideoEntry(entry);
    return () => {
      entry.listeners.delete(onReady);
      setVideoEntry(null);
      releaseVideo(videoSrc, aspect);
    };
  }, [videoSrc, allowVideo, aspect]);

  useEffect(() => {
    if (!videoEntry || !play) return;
    videoEntry.wantPlay++;
    syncPlayback(videoEntry);
    return () => {
      videoEntry.wantPlay--;
      syncPlayback(videoEntry);
    };
  }, [videoEntry, play]);

  if (videoEntry?.ready) return { texture: videoEntry.texture, source: videoEntry.video, isVideo: true };
  if (posterEntry?.ready) return { texture: posterEntry.texture, source: posterEntry.texture.image as HTMLImageElement, isVideo: false };
  return { texture: null, source: null, isVideo: false };
}

let sampleCtx: CanvasRenderingContext2D | null = null;

/** Average colour of the current frame (8×8 downsample) — drives the screens' light spill. */
export function sampleAverageColor(source: HTMLVideoElement | HTMLImageElement, out: Color): boolean {
  try {
    if (source instanceof HTMLVideoElement && source.readyState < 2) return false;
    if (!sampleCtx) {
      const c = document.createElement('canvas');
      c.width = 8;
      c.height = 8;
      sampleCtx = c.getContext('2d', { willReadFrequently: true });
    }
    if (!sampleCtx) return false;
    sampleCtx.drawImage(source, 0, 0, 8, 8);
    const { data } = sampleCtx.getImageData(0, 0, 8, 8);
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i] ?? 0;
      g += data[i + 1] ?? 0;
      b += data[i + 2] ?? 0;
    }
    const n = data.length / 4;
    out.setRGB(r / n / 255, g / n / 255, b / n / 255, SRGBColorSpace);
    return true;
  } catch {
    return false;
  }
}
