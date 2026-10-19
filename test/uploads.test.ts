import { describe, expect, it } from 'vitest';
import { createUploads, detectMedia, PART_BYTES } from '../src/uploads.js';
import { memoryStorage } from './memoryStorage.js';

const pad = (head: number[] | string) => Buffer.concat([Buffer.from(typeof head === 'string' ? Buffer.from(head, 'latin1') : head), Buffer.alloc(32)]);
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const MP3 = pad('ID3\x04');

describe('detectMedia', () => {
  it.each([
    [JPEG, 'image/jpeg'],
    [pad('\x89PNG\r\n\x1a\n'), 'image/png'],
    [pad('RIFF\0\0\0\0WEBPVP8 '), 'image/webp'],
    [pad('GIF89a'), 'image/gif'],
    [MP3, 'audio/mpeg'],
    [pad([0xff, 0xfb, 0x90, 0x00]), 'audio/mpeg'],
    [pad('\0\0\0\x20ftypM4A '), 'audio/mp4'],
    [pad('OggS'), 'audio/ogg'],
    [pad('RIFF\0\0\0\0WAVEfmt '), 'audio/wav'],
  ])('recognises %#', (data, type) => {
    expect(detectMedia(data)?.type).toBe(type);
  });

  it('refuses everything else, including iPhone photos and web pages', () => {
    expect(detectMedia(pad('\0\0\0\x18ftypheic'))).toBeNull();
    expect(detectMedia(pad('<html><script>'))).toBeNull();
    expect(detectMedia(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});

describe('uploads', () => {
  it('joins the parts, stores the file and clears the temporary parts', async () => {
    const storage = memoryStorage();
    const uploads = createUploads(storage);
    const id = uploads.start();
    const song = Buffer.concat([MP3, Buffer.alloc(PART_BYTES)]);
    await uploads.part(id, 0, song.subarray(0, PART_BYTES));
    await uploads.part(id, 1, song.subarray(PART_BYTES));
    const url = await uploads.finish(id, 2, 'audio');
    expect(url).toMatch(/^https:\/\/store\.public\.blob\.vercel-storage\.com\/uploads\/audio-[\w-]+\.mp3$/);
    expect(storage.files.get(url.split('.com/')[1])?.equals(song)).toBe(true);
    expect([...storage.files.keys()].some((file) => file.startsWith('tmp/'))).toBe(false);
  });

  it('refuses the wrong kind of file, missing parts and odd requests', async () => {
    const uploads = createUploads(memoryStorage());
    const id = uploads.start();
    await uploads.part(id, 0, JPEG);
    await expect(uploads.finish(id, 1, 'audio')).rejects.toThrow('MP3 or M4A');
    await expect(uploads.finish(id, 1, 'image')).rejects.toThrow('missing');
    const other = uploads.start();
    await uploads.part(other, 0, MP3);
    await expect(uploads.finish(other, 1, 'image')).rejects.toThrow('JPG, PNG or WebP');
    await expect(uploads.finish(other, 1, 'video')).rejects.toThrow('Unknown file kind');
    await expect(uploads.finish('../../x', 1, 'image')).rejects.toThrow('Unknown upload');
    await expect(uploads.finish(id, 0, 'image')).rejects.toThrow('Unknown upload');
    await expect(uploads.part(id, -1, JPEG)).rejects.toThrow('Unknown upload part');
    await expect(uploads.part(id, 0, Buffer.alloc(0))).rejects.toThrow('wrong size');
  });

  it('enforces the size limit for photos', async () => {
    const uploads = createUploads(memoryStorage());
    const id = uploads.start();
    for (let index = 0; index < 3; index++) await uploads.part(id, index, Buffer.concat([JPEG, Buffer.alloc(PART_BYTES - JPEG.length)]));
    await expect(uploads.finish(id, 3, 'image')).rejects.toThrow('limit is 10 MB');
  });
});
