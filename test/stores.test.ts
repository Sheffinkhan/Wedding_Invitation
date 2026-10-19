import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normaliseInvitation } from '../src/config.js';
import { createInvitationStore, ReadOnlyError } from '../src/invitationStore.js';
import { createSite } from '../src/site.js';
import { ConflictError, diskStorage, StorageError, updateDoc } from '../src/storage.js';
import { createTemplateStore, TEMPLATE_LIMIT } from '../src/templates.js';
import { DEFAULTS } from './fixtures.js';
import { memoryStorage, type MemoryStorage } from './memoryStorage.js';

const URL_A = 'https://store.public.blob.vercel-storage.com/uploads/a.jpg';
const URL_B = 'https://store.public.blob.vercel-storage.com/uploads/b.jpg';
const withCover = (image: string) => normaliseInvitation({ ...DEFAULTS, cover: { ...DEFAULTS.cover, image } }, DEFAULTS);

describe('diskStorage', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'wedding-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('writes documents only over the version that was read', async () => {
    const storage = diskStorage(dir);
    expect(await storage.readDoc('wishes')).toBeUndefined();
    await storage.writeDoc('wishes', '[]', null);
    const first = (await storage.readDoc('wishes'))!;
    expect(first.text).toBe('[]');
    await expect(storage.writeDoc('wishes', '[1]', null)).rejects.toThrow(ConflictError);
    await storage.writeDoc('wishes', '[1]', first.etag);
    await expect(storage.writeDoc('wishes', '[2]', first.etag)).rejects.toThrow(ConflictError);
  });

  it('stores files under /files/ and refuses paths outside the folder', async () => {
    const storage = diskStorage(dir);
    const url = await storage.putFile('uploads/a.jpg', Buffer.from('jpg'), 'image/jpeg');
    expect(url).toBe('/files/uploads/a.jpg');
    expect(storage.owns(url)).toBe(true);
    expect(storage.owns('https://example.com/a.jpg')).toBe(false);
    expect((await storage.readFile('uploads/a.jpg'))?.toString()).toBe('jpg');
    await storage.removeFiles([url]);
    expect(await storage.readFile('uploads/a.jpg')).toBeUndefined();
    await expect(storage.putFile('../escape.txt', Buffer.from('x'), 'text/plain')).rejects.toThrow(StorageError);
  });
});

describe('updateDoc', () => {
  it('retries when someone else wrote in between', async () => {
    const storage = memoryStorage();
    let interruptions = 2;
    storage.beforeWrite = () => {
      if (interruptions-- > 0) storage.docs.set('count', { text: String(Number(storage.docs.get('count')?.text ?? 0) + 1), etag: `other${interruptions}` });
    };
    const result = await updateDoc(storage, 'count', (text) => ({ text: String(Number(text ?? 0) + 1), result: 'done' }));
    expect(result).toBe('done');
    // Both interrupting writes and ours are counted.
    expect(storage.docs.get('count')?.text).toBe('3');
  });

  it('gives up after repeated conflicts and passes other errors on', async () => {
    const storage = memoryStorage();
    storage.beforeWrite = () => storage.docs.set('busy', { text: 'x', etag: String(Math.random()) });
    await expect(updateDoc(storage, 'busy', () => ({ text: 'y', result: null }))).rejects.toThrow(ConflictError);
    const broken = memoryStorage();
    broken.beforeWrite = () => {
      throw new StorageError('down');
    };
    await expect(updateDoc(broken, 'doc', () => ({ text: 'y', result: null }))).rejects.toThrow('down');
  });
});

describe('invitation store', () => {
  it('shows the committed invitation without storage and refuses to save', async () => {
    const store = createInvitationStore(null, DEFAULTS);
    expect(await store.load()).toBe(DEFAULTS);
    await expect(store.save(DEFAULTS)).rejects.toThrow(ReadOnlyError);
    expect(store.check({ couple: { groom: 'Ali' } }).couple.groom).toBe('Ali');
  });

  it('saves, caches briefly and survives a damaged copy', async () => {
    const storage = memoryStorage();
    let now = 0;
    const store = createInvitationStore(storage, DEFAULTS, { now: () => now });
    expect((await store.load()).couple.groom).toBe('Sahal');
    await store.save({ ...DEFAULTS, couple: { ...DEFAULTS.couple, groom: 'Ali' } });
    storage.docs.set('invitation', { text: '{not json', etag: 'x' });
    expect((await store.load()).couple.groom).toBe('Ali');
    now += 6000;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await store.load()).couple.groom).toBe('Sahal');
  });

  it('removes replaced uploads unless a template still uses them', async () => {
    const storage = memoryStorage();
    const keep = [URL_B];
    const store = createInvitationStore(storage, DEFAULTS, { keepMedia: async () => keep });
    await store.save(withCover(URL_A));
    await store.save(withCover(URL_B));
    expect(storage.removed).toEqual([URL_A]);
    await store.save(withCover(''));
    expect(storage.removed).toEqual([URL_A]);
  });
});

describe('template store', () => {
  let storage: MemoryStorage;
  let live: string[];
  let templates: ReturnType<typeof createTemplateStore>;
  let clock: number;

  beforeEach(() => {
    storage = memoryStorage();
    live = [];
    clock = Date.UTC(2026, 9, 19);
    templates = createTemplateStore(storage, DEFAULTS, { liveMedia: async () => live, now: () => new Date((clock += 1000)) });
  });

  it('saves whole invitations and lists the newest first', async () => {
    const first = await templates.save('  Nikkah   card ', DEFAULTS);
    await templates.save('Reception', { ...DEFAULTS, theme: { ...DEFAULTS.theme, design: 'rose' } });
    const list = await templates.list();
    expect(list.map((item) => item.name)).toEqual(['Reception', 'Nikkah card']);
    expect(list[0]).toMatchObject({ design: 'rose', couple: 'Sahal & Sahadiya' });
    expect(list[1].colours).toEqual(['#0e1b3d', '#fbf7ef', '#d6e2ee', '#c6a46a']);
    expect((await templates.get(first.id)).couple.groom).toBe('Sahal');
  });

  it('saves over a template with the same name and keeps at most five', async () => {
    const first = await templates.save('Main', DEFAULTS);
    const again = await templates.save('MAIN', { ...DEFAULTS, couple: { ...DEFAULTS.couple, joiner: '&' } });
    expect(again.id).toBe(first.id);
    expect((await templates.get(first.id)).couple.joiner).toBe('&');
    for (let i = 1; i < TEMPLATE_LIMIT; i++) await templates.save(`Version ${i}`, DEFAULTS);
    await expect(templates.save('One too many', DEFAULTS)).rejects.toThrow('up to 5 templates');
    await templates.save('Version 1', DEFAULTS);
    expect(await templates.list()).toHaveLength(TEMPLATE_LIMIT);
  });

  it('checks names and invitations', async () => {
    await expect(templates.save('', DEFAULTS)).rejects.toThrow('Give the template a name.');
    await expect(templates.save('x'.repeat(41), DEFAULTS)).rejects.toThrow('40 characters or fewer');
    await expect(templates.save('Bad', { ...DEFAULTS, theme: { ...DEFAULTS.theme, gold: 'shiny' } })).rejects.toThrow('must be a colour');
    await expect(templates.get('missing')).rejects.toThrow('no longer exists');
    await expect(templates.remove('missing')).rejects.toThrow('no longer exists');
  });

  it('removes a deleted template’s uploads only when nothing else uses them', async () => {
    const a = await templates.save('A', withCover(URL_A));
    const b = await templates.save('B', withCover(URL_B));
    await templates.save('C', withCover(URL_B));
    live = [URL_A];
    expect(await templates.mediaUrls()).toEqual([URL_A, URL_B, URL_B]);
    await templates.remove(a.id);
    await templates.remove(b.id);
    expect(storage.removed).toEqual([]);
    await templates.save('C', withCover(''));
    expect(storage.removed).toEqual([URL_B]);
  });
});

describe('createSite', () => {
  it('switches off templates and wishes without storage', () => {
    const site = createSite(null, DEFAULTS);
    expect(site.templates).toBeNull();
    expect(site.wishes).toBeNull();
  });

  it('keeps uploads a template uses when the invitation changes', async () => {
    const storage = memoryStorage();
    const site = createSite(storage, DEFAULTS);
    await site.invitations.save(withCover(URL_A));
    await site.templates!.save('Keep', withCover(URL_A));
    await site.invitations.save(withCover(URL_B));
    expect(storage.removed).toEqual([]);
    await site.templates!.remove((await site.templates!.list())[0].id);
    expect(storage.removed).toEqual([URL_A]);
  });
});
