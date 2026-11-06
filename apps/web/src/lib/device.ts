export type QualityTier = 'low' | 'medium' | 'high';

let webglSupport: boolean | null = null;
let rendererName: string | null = null;

function probeWebGL(): void {
  if (webglSupport !== null) return;
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | WebGL2RenderingContext | null;
    webglSupport = !!gl;
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      rendererName = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    webglSupport = false;
  }
}

export function hasWebGL(): boolean {
  if (typeof window === 'undefined') return false;
  const forced = new URLSearchParams(window.location.search).get('webgl');
  if (forced === '0') return false;
  probeWebGL();
  return !!webglSupport;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}

const QUALITY_KEY = 's5y:quality';

/** `?quality=low|medium|high` QA override — remembered for the tab so it survives client-side navigation. */
function forcedQuality(): QualityTier | null {
  if (typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search).get('quality');
  try {
    if (q === 'low' || q === 'medium' || q === 'high') {
      sessionStorage.setItem(QUALITY_KEY, q);
      return q;
    }
    if (q === 'auto') sessionStorage.removeItem(QUALITY_KEY);
    const saved = sessionStorage.getItem(QUALITY_KEY);
    return saved === 'low' || saved === 'medium' || saved === 'high' ? saved : null;
  } catch {
    return q === 'low' || q === 'medium' || q === 'high' ? q : null;
  }
}

/** True when the tier comes from the `?quality=` QA override. */
export function isQualityForced(): boolean {
  return forcedQuality() !== null;
}

const SOFTWARE_RENDERERS = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;
const WEAK_GPUS = /mali-(4|t6|t7|g31|g51|g52)|adreno \(tm\) (3|4|50)|powervr|intel\(r\) (hd|uhd) graphics (4|5|6)\d{2}\b|apple a(9|10|11)\b/i;

/**
 * Initial quality tier from cheap device signals. `PerformanceMonitor` refines it at runtime.
 * `?quality=low|medium|high` overrides (useful for QA on a given device; `?quality=auto` clears it).
 */
export function detectQualityTier(): QualityTier {
  if (typeof window === 'undefined') return 'low';
  const forced = forcedQuality();
  if (forced) return forced;
  probeWebGL();
  const name = rendererName ?? '';
  if (SOFTWARE_RENDERERS.test(name) || WEAK_GPUS.test(name)) return 'low';
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return 'low';
  const memory = nav.deviceMemory ?? 8;
  const cores = nav.hardwareConcurrency ?? 4;
  const touch = isTouchDevice();
  const small = Math.min(window.screen.width, window.screen.height) < 500;
  if (memory <= 2 || cores <= 2) return 'low';
  if (touch || small || memory <= 4 || cores <= 4) return 'medium';
  return 'high';
}
