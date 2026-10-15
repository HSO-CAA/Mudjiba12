/**
 * Keyframe tracks for scroll choreography (no three.js imports — safe for the main chunk).
 *
 * Each channel is a monotone cubic Hermite spline (Fritsch–Carlson): smooth through the keys, never
 * overshooting them (a distance can't dip below its smallest key). A key marked `hold` gets zero
 * tangents — a cinematic beat where the move settles before the next one starts.
 * Sampling writes into a caller-owned object: no allocations per frame.
 */
export type TrackKey<C extends string> = { t: number; hold?: boolean } & Record<C, number>;

interface Channel {
  y: Float64Array;
  m: Float64Array;
}

export interface Track<C extends string> {
  t: Float64Array;
  channels: Record<C, Channel>;
  names: C[];
}

export function createTrack<C extends string>(names: readonly C[], keys: TrackKey<C>[]): Track<C> {
  const n = keys.length;
  const t = Float64Array.from(keys, (k) => k.t);
  const channels = {} as Record<C, Channel>;
  for (const name of names) {
    const y = Float64Array.from(keys, (k) => k[name]);
    const m = new Float64Array(n);
    const d = new Float64Array(Math.max(1, n - 1));
    for (let i = 0; i < n - 1; i++) d[i] = ((y[i + 1] as number) - (y[i] as number)) / Math.max(1e-6, (t[i + 1] as number) - (t[i] as number));
    for (let i = 0; i < n; i++) {
      if (keys[i]?.hold) continue;
      const a = i > 0 ? (d[i - 1] as number) : (d[0] as number);
      const b = i < n - 1 ? (d[i] as number) : (d[n - 2] as number);
      m[i] = i === 0 ? b : i === n - 1 ? a : a * b <= 0 ? 0 : (a + b) / 2;
    }
    // Fritsch–Carlson limiter → monotone between keys
    for (let i = 0; i < n - 1; i++) {
      const di = d[i] as number;
      if (Math.abs(di) < 1e-9) {
        m[i] = 0;
        m[i + 1] = 0;
        continue;
      }
      const al = (m[i] as number) / di;
      const be = (m[i + 1] as number) / di;
      const s = al * al + be * be;
      if (s > 9) {
        const tau = 3 / Math.sqrt(s);
        m[i] = tau * al * di;
        m[i + 1] = tau * be * di;
      }
    }
    channels[name] = { y, m };
  }
  return { t, channels, names: [...names] };
}

/** Samples every channel at `time` (clamped to the first/last key) into `out`. */
export function sampleTrack<C extends string>(track: Track<C>, time: number, out: Record<C, number>): Record<C, number> {
  const { t } = track;
  const n = t.length;
  let k = 0;
  if (time <= (t[0] as number)) k = -1;
  else if (time >= (t[n - 1] as number)) k = -2;
  else while (k < n - 2 && time >= (t[k + 1] as number)) k++;
  const names = track.names;
  for (let i = 0; i < names.length; i++) {
    const name = names[i] as C;
    const c = track.channels[name];
    if (k === -1) {
      out[name] = c.y[0] as number;
      continue;
    }
    if (k === -2) {
      out[name] = c.y[n - 1] as number;
      continue;
    }
    const t0 = t[k] as number;
    const h = (t[k + 1] as number) - t0;
    const u = (time - t0) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    out[name] =
      (2 * u3 - 3 * u2 + 1) * (c.y[k] as number) +
      (u3 - 2 * u2 + u) * h * (c.m[k] as number) +
      (-2 * u3 + 3 * u2) * (c.y[k + 1] as number) +
      (u3 - u2) * h * (c.m[k + 1] as number);
  }
  return out;
}

/** A zeroed sample object for a track (allocate once, reuse every frame). */
export function trackSample<C extends string>(names: readonly C[]): Record<C, number> {
  const out = {} as Record<C, number>;
  for (const n of names) out[n] = 0;
  return out;
}
