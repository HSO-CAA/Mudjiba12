/** Content sniffing from magic bytes — never trust the client-provided MIME type. */

export type ImageType = 'jpeg' | 'png' | 'gif' | 'webp' | 'avif';

export const IMAGE_EXT: Record<ImageType, string> = { jpeg: 'jpg', png: 'png', gif: 'gif', webp: 'webp', avif: 'avif' };
export const IMAGE_MIME: Record<ImageType, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
};

const ascii = (buf: Buffer, start: number, end: number): string => buf.subarray(start, end).toString('latin1');

export function sniffImage(buf: Buffer): ImageType | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  const head6 = ascii(buf, 0, 6);
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'gif';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return 'webp';
  if (ascii(buf, 4, 8) === 'ftyp') {
    const boxSize = buf.readUInt32BE(0);
    const end = Math.min(buf.length, Math.max(16, boxSize));
    const brands: string[] = [ascii(buf, 8, 12)];
    for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(buf, i, i + 4));
    if (brands.some((b) => b === 'avif' || b === 'avis')) return 'avif';
  }
  return null;
}

export interface Size {
  width: number;
  height: number;
}

/** Reads pixel dimensions from the file header (no decoding). Returns null when unknown. */
export function imageSize(buf: Buffer, type: ImageType): Size | null {
  try {
    switch (type) {
      case 'png':
        return buf.length >= 24 ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : null;
      case 'gif':
        return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
      case 'webp':
        return webpSize(buf);
      case 'jpeg':
        return jpegSize(buf);
      case 'avif':
        return null;
    }
  } catch {
    return null;
  }
}

function webpSize(buf: Buffer): Size | null {
  const chunk = ascii(buf, 12, 16);
  if (chunk === 'VP8X' && buf.length >= 30) {
    return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  if (chunk === 'VP8 ' && buf.length >= 30) {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L' && buf.length >= 25) {
    const b = buf.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function jpegSize(buf: Buffer): Size | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1] as number;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = buf.readUInt16BE(i + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + length;
  }
  return null;
}

/** EXIF orientation (1–8) of a JPEG, or 1 when absent. */
export function jpegOrientation(buf: Buffer): number {
  try {
    let i = 2;
    while (i + 4 < buf.length && buf[i] === 0xff) {
      const marker = buf[i + 1] as number;
      const length = buf.readUInt16BE(i + 2);
      if (marker === 0xe1 && ascii(buf, i + 4, i + 10) === 'Exif\0\0') {
        const tiff = i + 10;
        const little = ascii(buf, tiff, tiff + 2) === 'II';
        const u16 = (o: number) => (little ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
        const u32 = (o: number) => (little ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
        const ifd = tiff + u32(tiff + 4);
        const count = u16(ifd);
        for (let e = 0; e < count; e++) {
          const entry = ifd + 2 + e * 12;
          if (u16(entry) === 0x0112) {
            const value = u16(entry + 8);
            return value >= 1 && value <= 8 ? value : 1;
          }
        }
        return 1;
      }
      if (marker === 0xda) break;
      i += 2 + length;
    }
  } catch {
    // Malformed EXIF → treat as upright.
  }
  return 1;
}

/** Whether the bytes look like a video container we accept (ISO-BMFF/QuickTime or Matroska/WebM). */
export function looksLikeVideo(head: Buffer): boolean {
  if (head.length < 12) return false;
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return true;
  const box = ascii(head, 4, 8);
  return ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(box);
}
