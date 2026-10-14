import {
  CanvasTexture,
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';

const MONO = '"JetBrains Mono Variable", ui-monospace, monospace';
const DISPLAY = '"Alexandria Variable", "IBM Plex Sans Arabic", system-ui, sans-serif';

/** Redraws a canvas texture once the self-hosted fonts are available (first draw uses fallbacks). */
function whenFontsReady(redraw: () => void): void {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  Promise.all([
    document.fonts.load(`600 48px ${MONO}`),
    document.fonts.load(`800 48px ${DISPLAY}`),
  ])
    .then(redraw)
    .catch(() => undefined);
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [canvas, ctx];
}

function finish(canvas: HTMLCanvasElement, anisotropy = 8): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  return tex;
}

/** Subtle machined/brushed base for anodised metal. */
function brushedBase(ctx: CanvasRenderingContext2D, w: number, h: number, base = '#0c0c0e'): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  let seed = 1337;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < w / 3; i++) {
    const x = rand() * w;
    ctx.fillStyle = `rgba(255,255,255,${0.008 + rand() * 0.018})`;
    ctx.fillRect(x, 0, 1 + rand() * 2, h);
  }
}

export interface BandSpec {
  /** World circumference of the band (2πr) and its height along the lens axis. */
  circumference: number;
  height: number;
  width?: number;
}

function bandCanvas({ circumference, height, width = 4096 }: BandSpec): [HTMLCanvasElement, CanvasRenderingContext2D, number, number] {
  const h = Math.max(64, Math.round((width * height) / circumference));
  const [c, ctx] = makeCanvas(width, h);
  return [c, ctx, width, h];
}

/** Focus distance scale: white metres + accent feet, tick marks, repeated around the barrel. */
export function createDistanceScaleTexture(spec: BandSpec, accent: string, repeats = 3): CanvasTexture {
  const [canvas, ctx, w, h] = bandCanvas(spec);
  const metres = ['0.45', '0.5', '0.6', '0.7', '0.8', '1', '1.2', '1.5', '2', '3', '5', '∞'];
  const feet = ["1'6", '2', "2'6", '3', '4', '5', '7', '10', '15', '∞'];
  const draw = () => {
    brushedBase(ctx, w, h);
    const seg = w / repeats;
    for (let r = 0; r < repeats; r++) {
      const x0 = r * seg + seg * 0.08;
      const span = seg * 0.7;
      // ticks
      ctx.fillStyle = 'rgba(241,239,233,0.85)';
      for (let i = 0; i <= 44; i++) {
        const x = x0 + (span * i) / 44;
        const major = i % 4 === 0;
        ctx.fillRect(x, h * 0.06, 2, h * (major ? 0.2 : 0.11));
      }
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.font = `600 ${Math.round(h * 0.26)}px ${MONO}`;
      ctx.fillStyle = '#f1efe9';
      metres.forEach((m, i) => {
        const t = Math.pow(i / (metres.length - 1), 0.92);
        ctx.fillText(m, x0 + span * t, h * 0.47);
      });
      ctx.font = `500 ${Math.round(h * 0.2)}px ${MONO}`;
      ctx.fillStyle = accent;
      feet.forEach((f, i) => {
        const t = Math.pow(i / (feet.length - 1), 0.92);
        ctx.fillText(f, x0 + span * t, h * 0.8);
      });
      ctx.font = `600 ${Math.round(h * 0.17)}px ${MONO}`;
      ctx.fillStyle = 'rgba(241,239,233,0.6)';
      ctx.textAlign = 'left';
      ctx.fillText('m', x0 + span + seg * 0.04, h * 0.47);
      ctx.fillStyle = accent;
      ctx.fillText('ft', x0 + span + seg * 0.04, h * 0.8);
    }
  };
  draw();
  const tex = finish(canvas);
  whenFontsReady(() => {
    draw();
    tex.needsUpdate = true;
  });
  return tex;
}

/** T-stop scale for the iris ring. */
export function createStopScaleTexture(spec: BandSpec, repeats = 3): CanvasTexture {
  const [canvas, ctx, w, h] = bandCanvas(spec);
  const stops = ['1.4', '2', '2.8', '4', '5.6', '8', '11', '16', 'C'];
  const draw = () => {
    brushedBase(ctx, w, h, '#0b0b0d');
    const seg = w / repeats;
    for (let r = 0; r < repeats; r++) {
      const x0 = r * seg + seg * 0.12;
      const span = seg * 0.62;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.round(h * 0.42)}px ${MONO}`;
      stops.forEach((s, i) => {
        const x = x0 + (span * i) / (stops.length - 1);
        ctx.fillStyle = s === 'C' ? 'rgba(241,239,233,0.55)' : '#f1efe9';
        ctx.fillText(s, x, h * 0.55);
        ctx.fillRect(x - 1, h * 0.08, 2, h * 0.16);
      });
    }
  };
  draw();
  const tex = finish(canvas);
  whenFontsReady(() => {
    draw();
    tex.needsUpdate = true;
  });
  return tex;
}

/** Barrel branding: hero mark + focal length, repeated so it is visible from any pointer angle. */
export function createBarrelTexture(spec: BandSpec, mark: string, accent: string, repeats = 2): CanvasTexture {
  const [canvas, ctx, w, h] = bandCanvas(spec);
  const draw = () => {
    brushedBase(ctx, w, h, '#0d0d0f');
    const seg = w / repeats;
    for (let r = 0; r < repeats; r++) {
      const x0 = r * seg + seg * 0.1;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#f3f0ea';
      ctx.font = `800 ${Math.round(h * 0.34)}px ${DISPLAY}`;
      ctx.fillText(mark.toUpperCase(), x0, h * 0.42);
      const markW = ctx.measureText(mark.toUpperCase()).width;
      ctx.font = `600 ${Math.round(h * 0.17)}px ${MONO}`;
      ctx.fillStyle = 'rgba(243,240,234,0.82)';
      ctx.fillText('CINE PRIME', x0 + markW + h * 0.25, h * 0.33);
      ctx.fillStyle = accent;
      ctx.fillText('35mm  T1.4', x0 + markW + h * 0.25, h * 0.56);
      ctx.font = `500 ${Math.round(h * 0.11)}px ${MONO}`;
      ctx.fillStyle = 'rgba(243,240,234,0.45)';
      ctx.fillText('MADE FOR STORIES · No. 0519', x0, h * 0.8);
      // index line
      ctx.fillStyle = accent;
      ctx.fillRect(r * seg + seg * 0.82, 0, 3, h * 0.3);
    }
  };
  draw();
  const tex = finish(canvas);
  whenFontsReady(() => {
    draw();
    tex.needsUpdate = true;
  });
  return tex;
}

/** Engraved text running around the front ring (planar ring UVs). */
export function createFrontRingTexture(text: string, accent: string, innerRatio: number, size = 1024): CanvasTexture {
  const [canvas, ctx] = makeCanvas(size, size);
  const draw = () => {
    const c = size / 2;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#0b0b0d';
    ctx.fillRect(0, 0, size, size);
    // fine machined concentric grooves
    for (let r = c * innerRatio; r < c; r += 3) {
      ctx.strokeStyle = `rgba(255,255,255,${0.012 + ((r * 7) % 5) * 0.004})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    const radius = c * (innerRatio + (1 - innerRatio) * 0.46);
    ctx.font = `600 ${Math.round(c * (1 - innerRatio) * 0.3)}px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const chars = [...text];
    const spacing = (Math.PI * 1.72) / chars.length;
    let angle = -Math.PI * 0.86;
    for (const ch of chars) {
      ctx.save();
      ctx.translate(c + Math.sin(angle) * radius, c - Math.cos(angle) * radius);
      ctx.rotate(angle);
      ctx.fillStyle = ch === '●' ? accent : 'rgba(243,240,234,0.88)';
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      angle += spacing;
    }
  };
  draw();
  const tex = finish(canvas, 4);
  tex.wrapS = ClampToEdgeWrapping;
  whenFontsReady(() => {
    draw();
    tex.needsUpdate = true;
  });
  return tex;
}

/** Tileable value-noise (fbm) as a linear data texture — floor roughness / reflection distortion. */
export function createNoiseTexture(size = 256, cells = 8, octaves = 4): DataTexture {
  let seed = 9001;
  const rand = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
  const grids: Float32Array[] = [];
  for (let o = 0; o < octaves; o++) {
    const n = cells << o;
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rand();
    grids.push(g);
  }
  const data = new Uint8Array(size * size * 4);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let amp = 0.5;
      let norm = 0;
      for (let o = 0; o < octaves; o++) {
        const n = cells << o;
        const grid = grids[o] as Float32Array;
        const fx = (x / size) * n;
        const fy = (y / size) * n;
        const x0 = Math.floor(fx) % n;
        const y0 = Math.floor(fy) % n;
        const x1 = (x0 + 1) % n;
        const y1 = (y0 + 1) % n;
        const tx = smooth(fx - Math.floor(fx));
        const ty = smooth(fy - Math.floor(fy));
        const a = (grid[y0 * n + x0] ?? 0) * (1 - tx) + (grid[y0 * n + x1] ?? 0) * tx;
        const b = (grid[y1 * n + x0] ?? 0) * (1 - tx) + (grid[y1 * n + x1] ?? 0) * tx;
        v += (a * (1 - ty) + b * ty) * amp;
        norm += amp;
        amp *= 0.5;
      }
      const byte = Math.round((v / norm) * 255);
      const i = (y * size + x) * 4;
      data[i] = byte;
      data[i + 1] = byte;
      data[i + 2] = byte;
      data[i + 3] = 255;
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
