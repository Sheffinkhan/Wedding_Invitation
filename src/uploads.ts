import { randomBytes } from 'node:crypto';
import type { Storage } from './storage.js';

export type MediaKind = 'image' | 'audio';

export class UploadError extends Error {}

interface Detected {
  kind: MediaKind;
  type: string;
  extension: string;
}

/** Each request body stays under Vercel's 4.5 MB limit, so larger files arrive in parts. */
export const PART_BYTES = 3_500_000;
export const LIMITS: Record<MediaKind, number> = { image: 10_000_000, audio: 20_000_000 };
const MAX_PARTS = Math.ceil(LIMITS.audio / PART_BYTES);
const ID = /^[A-Za-z0-9_-]{16,32}$/;

const ascii = (data: Buffer, start: number, end: number) => data.subarray(start, end).toString('latin1');

/**
 * Works out what a file really is from its first bytes, ignoring the name
 * and the type the browser claimed, so only photos and audio are stored.
 */
export function detectMedia(data: Buffer): Detected | null {
  if (data.length < 12) return null;
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { kind: 'image', type: 'image/jpeg', extension: 'jpg' };
  if (ascii(data, 0, 8) === '\x89PNG\r\n\x1a\n') return { kind: 'image', type: 'image/png', extension: 'png' };
  if (ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 12) === 'WEBP') return { kind: 'image', type: 'image/webp', extension: 'webp' };
  if (ascii(data, 0, 6) === 'GIF87a' || ascii(data, 0, 6) === 'GIF89a') return { kind: 'image', type: 'image/gif', extension: 'gif' };
  if (ascii(data, 0, 3) === 'ID3' || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0 && (data[1] & 0x06) !== 0)) {
    return { kind: 'audio', type: 'audio/mpeg', extension: 'mp3' };
  }
  // The same container holds iPhone photos, which browsers cannot show, so those brands are refused.
  if (ascii(data, 4, 8) === 'ftyp' && !/^(hei[cmsx]|hev[cmsx]|mif1|msf1|avi[fs])$/.test(ascii(data, 8, 12))) {
    return { kind: 'audio', type: 'audio/mp4', extension: 'm4a' };
  }
  if (ascii(data, 0, 4) === 'OggS') return { kind: 'audio', type: 'audio/ogg', extension: 'ogg' };
  if (ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 12) === 'WAVE') return { kind: 'audio', type: 'audio/wav', extension: 'wav' };
  return null;
}

/**
 * Uploads in three steps: start, send each part, finish. Parts are kept as
 * temporary files and joined on finish, which works the same for local
 * storage and for every kind of Blob connection.
 */
export function createUploads(storage: Storage) {
  const partPath = (id: string, index: number) => `tmp/${id}/${String(index).padStart(3, '0')}`;

  function checkId(id: string) {
    if (!ID.test(id)) throw new UploadError('Unknown upload');
  }

  function checkCount(parts: unknown): number {
    if (!Number.isInteger(parts) || (parts as number) < 1 || (parts as number) > MAX_PARTS) {
      throw new UploadError('Unknown upload');
    }
    return parts as number;
  }

  return {
    start(): string {
      return randomBytes(16).toString('base64url');
    },

    async part(id: string, index: number, data: Buffer): Promise<void> {
      checkId(id);
      if (!Number.isInteger(index) || index < 0 || index >= MAX_PARTS) throw new UploadError('Unknown upload part');
      if (!data.length || data.length > PART_BYTES) throw new UploadError('Upload part has the wrong size');
      await storage.putFile(partPath(id, index), data, 'application/octet-stream');
    },

    async finish(id: string, parts: unknown, kind: unknown): Promise<string> {
      checkId(id);
      const count = checkCount(parts);
      if (kind !== 'image' && kind !== 'audio') throw new UploadError('Unknown file kind');
      const paths = Array.from({ length: count }, (_, index) => partPath(id, index));
      try {
        const pieces: Buffer[] = [];
        for (const path of paths) {
          const piece = await storage.readFile(path);
          if (!piece) throw new UploadError('Part of the file is missing. Please upload it again.');
          pieces.push(piece);
        }
        const data = Buffer.concat(pieces);
        if (data.length > LIMITS[kind]) {
          throw new UploadError(`That file is too large. The limit is ${LIMITS[kind] / 1_000_000} MB.`);
        }
        const found = detectMedia(data);
        if (!found || found.kind !== kind) {
          throw new UploadError(kind === 'image' ? 'Please choose a JPG, PNG or WebP photo.' : 'Please choose an MP3 or M4A file.');
        }
        return await storage.putFile(`uploads/${kind}-${randomBytes(12).toString('base64url')}.${found.extension}`, data, found.type);
      } finally {
        await storage.removeFiles(paths).catch(() => {});
      }
    },
  };
}

export type Uploads = ReturnType<typeof createUploads>;
