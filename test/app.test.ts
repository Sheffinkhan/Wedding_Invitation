import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type AppDeps } from '../src/app.js';
import { createLoginGate } from '../src/login.js';
import { createSite } from '../src/site.js';
import { diskStorage } from '../src/storage.js';
import { PART_BYTES } from '../src/uploads.js';
import { DEFAULTS } from './fixtures.js';
import { memoryStorage } from './memoryStorage.js';

const PASSWORD = 'a long editor password';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

let server: Server | undefined;
let base = '';

async function start(options: Partial<AppDeps> & { withStorage?: boolean } = {}) {
  const { withStorage = true, ...overrides } = options;
  const storage = withStorage ? memoryStorage() : null;
  const app = createApp({
    ...createSite(storage, DEFAULTS),
    storage,
    publicDir: path.join(process.cwd(), 'public'),
    online: false,
    version: 'test',
    minimumWishMs: 0,
    wrongPasswordDelayMs: 0,
    ...overrides,
  });
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return storage;
}

afterEach(async () => {
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
  server = undefined;
});

async function call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(base + url, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // Not JSON: keep the text.
  }
  return { status: response.status, data: data as any, headers: response.headers };
}

const wish = (name: string, message = 'Mabrook to you both') => ({ name, message, website: '', elapsedMs: 5000 });

describe('the invitation page', () => {
  it('renders the invitation with calendar files', async () => {
    await start();
    const page = await call('GET', '/');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/text\/html/);
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.data).toContain('Sahadiya');
    expect(page.data).toContain('<svg xmlns="http://www.w3.org/2000/svg"');

    const ics = await call('GET', '/calendar/0.ics');
    expect(ics.headers.get('content-type')).toMatch(/text\/calendar/);
    expect(ics.data).toContain('SUMMARY:Nikkah · Sahal & Sahadiya');
    expect((await call('GET', '/calendar/7.ics')).status).toBe(404);
    expect((await call('GET', '/calendar/x.ics')).status).toBe(404);
  });

  it('serves the static files and refuses unknown paths', async () => {
    await start();
    const styles = await call('GET', '/styles.css');
    expect(styles.status).toBe(200);
    expect(styles.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await call('GET', '/admin.html')).headers.get('cache-control')).toBe('no-store');
    expect((await call('GET', '/nothing-here')).status).toBe(404);
    expect((await call('GET', '/api/nothing')).status).toBe(404);
    const admin = await fetch(`${base}/admin`, { redirect: 'manual' });
    expect(admin.headers.get('location')).toBe('/admin.html');
  });

  it('refuses requests from other sites while running locally', async () => {
    await start();
    expect((await call('GET', '/', undefined, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('GET', '/', undefined, { Origin: 'http://localhost:3001' })).status).toBe(200);
  });
});

describe('guest wishes', () => {
  it('stores wishes, lists them and counts likes', async () => {
    await start();
    const sent = await call('POST', '/api/wishes', wish('Aisha'));
    expect(sent.status).toBe(201);
    expect(sent.data).toMatchObject({ pending: false, wish: { name: 'Aisha', likes: 0 } });
    const list = await call('GET', '/api/wishes');
    expect(list.data.wishes.map((item: { name: string }) => item.name)).toEqual(['Aisha']);
    expect(list.data.likes).toBe(true);
    const liked = await call('POST', `/api/wishes/${sent.data.wish.id}/like`, { liked: true });
    expect(liked.data).toEqual({ likes: 1 });
    expect((await call('POST', `/api/wishes/${sent.data.wish.id}/like`, { liked: 'yes' })).status).toBe(400);
    expect((await call('POST', '/api/wishes/missing/like', { liked: true })).status).toBe(404);
  });

  it('turns away bots, bad input and repeat senders', async () => {
    await start({ minimumWishMs: 2500 });
    expect((await call('POST', '/api/wishes', { ...wish('Bot'), website: 'spam.example' })).status).toBe(400);
    expect((await call('POST', '/api/wishes', { ...wish('Fast'), elapsedMs: 100 })).status).toBe(400);
    expect((await call('POST', '/api/wishes', wish('A'))).data.error).toBe('Please enter your name.');
    expect((await call('POST', '/api/wishes', 'not json', { 'Content-Type': 'application/json' })).status).toBe(400);
    for (let i = 0; i < 5; i++) expect((await call('POST', '/api/wishes', wish(`Guest ${i}`))).status).toBe(201);
    const limited = await call('POST', '/api/wishes', wish('Guest 6'));
    expect(limited.data.error).toMatch(/several wishes/);
  });

  it('holds wishes for approval and hides likes when the couple chooses', async () => {
    const storage = await start();
    const site = createSite(storage, DEFAULTS);
    await site.invitations.save({ ...DEFAULTS, wishes: { ...DEFAULTS.wishes, requireApproval: true, likes: false } });
    const sent = await call('POST', '/api/wishes', wish('Omar'));
    expect(sent.data.pending).toBe(true);
    expect((await call('GET', '/api/wishes')).data.wishes).toEqual([]);
    expect((await call('GET', '/api/admin/wishes')).data[0]).toMatchObject({ name: 'Omar', status: 'pending' });
  });

  it('says wishes are unavailable without storage instead of pretending', async () => {
    await start({ withStorage: false });
    expect((await call('GET', '/api/wishes')).status).toBe(503);
    expect((await call('POST', '/api/wishes', wish('Aisha'))).status).toBe(503);
    expect((await call('GET', '/')).data).toContain('Wishes will open here soon.');
  });
});

describe('the editor, locally', () => {
  it('opens without a password and saves the invitation', async () => {
    await start();
    expect((await call('GET', '/api/admin/session')).data).toMatchObject({ loginRequired: false, signedIn: true, storage: 'blob' });
    expect((await call('POST', '/api/admin/login', {})).data).toEqual({ ok: true });
    const schema = (await call('GET', '/api/admin/schema')).data;
    expect(schema.designs).toHaveLength(5);
    expect(schema.templateLimit).toBe(5);
    expect(Object.keys(schema.frames)).toEqual(['arch', 'mihrab', 'oval', 'deco', 'pill']);
    const invitation = (await call('GET', '/api/admin/invitation')).data;
    const saved = await call('PUT', '/api/admin/invitation', { ...invitation, couple: { ...invitation.couple, joiner: '&' } });
    expect(saved.data.couple.joiner).toBe('&');
    const refused = await call('PUT', '/api/admin/invitation', { ...invitation, theme: { ...invitation.theme, gold: 'gold' } });
    expect(refused).toMatchObject({ status: 400, data: { error: 'Design and colours: Accent colour must be a colour such as #0e1b3d' } });
  });

  it('previews unsaved changes with the same rendering as the page', async () => {
    await start();
    const preview = await call('POST', '/api/admin/preview', { ...DEFAULTS, theme: { ...DEFAULTS.theme, design: 'midnight' } });
    expect(preview.status).toBe(200);
    expect(preview.data).toContain('data-design="midnight"');
    expect((await call('GET', '/')).data).toContain('data-design="royal"');
    expect((await call('POST', '/api/admin/preview', { ...DEFAULTS, events: [] })).status).toBe(400);
  });

  it('saves, lists, loads and deletes templates', async () => {
    await start();
    const saved = await call('POST', '/api/admin/templates', { name: 'Rose version', invitation: { ...DEFAULTS, theme: { ...DEFAULTS.theme, design: 'rose' } } });
    expect(saved.status).toBe(201);
    const list = (await call('GET', '/api/admin/templates')).data;
    expect(list).toEqual([expect.objectContaining({ name: 'Rose version', design: 'rose' })]);
    expect((await call('GET', `/api/admin/templates/${saved.data.id}`)).data.theme.design).toBe('rose');
    expect((await call('POST', '/api/admin/templates', { name: '', invitation: DEFAULTS })).status).toBe(400);
    expect((await call('DELETE', `/api/admin/templates/${saved.data.id}`)).data).toEqual({ ok: true });
    expect((await call('GET', `/api/admin/templates/${saved.data.id}`)).status).toBe(404);
  });

  it('moderates wishes', async () => {
    await start();
    const sent = (await call('POST', '/api/wishes', wish('Zara'))).data.wish;
    expect((await call('PATCH', `/api/admin/wishes/${sent.id}`, { status: 'hidden' })).data.status).toBe('hidden');
    expect((await call('PATCH', `/api/admin/wishes/${sent.id}`, { status: 'gone' })).status).toBe(400);
    expect((await call('GET', '/api/wishes')).data.wishes).toEqual([]);
    expect((await call('DELETE', `/api/admin/wishes/${sent.id}`)).data).toEqual({ ok: true });
    expect((await call('GET', '/api/admin/wishes')).data).toEqual([]);
  });

  it('uploads files in parts', async () => {
    await start();
    const { id, partBytes } = (await call('POST', '/api/admin/uploads')).data;
    expect(partBytes).toBe(PART_BYTES);
    const put = await fetch(`${base}/api/admin/uploads/${id}/0`, { method: 'PUT', body: JPEG });
    expect(put.status).toBe(204);
    const done = await call('POST', `/api/admin/uploads/${id}/finish`, { parts: 1, kind: 'image' });
    expect(done.status).toBe(201);
    expect(done.data.url).toMatch(/\/uploads\/image-[\w-]+\.jpg$/);
    const tooBig = await fetch(`${base}/api/admin/uploads/${id}/0`, { method: 'PUT', body: Buffer.alloc(PART_BYTES + 1) });
    expect(tooBig.status).toBe(413);
  });

  it('serves local uploads but never temporary parts', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'wedding-app-'));
    try {
      const storage = diskStorage(dir);
      await start({ ...createSite(storage, DEFAULTS), storage, localFilesDir: path.join(dir, 'files') });
      await storage.putFile('uploads/a.jpg', JPEG, 'image/jpeg');
      await storage.putFile('tmp/x/000', JPEG, 'application/octet-stream');
      const served = await fetch(`${base}/files/uploads/a.jpg`);
      expect(served.headers.get('content-type')).toBe('image/jpeg');
      expect((await fetch(`${base}/files/tmp/x/000`)).status).toBe(404);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('explains that saving needs storage', async () => {
    await start({ withStorage: false });
    expect((await call('PUT', '/api/admin/invitation', DEFAULTS)).status).toBe(503);
    expect((await call('GET', '/api/admin/templates')).status).toBe(503);
    expect((await call('POST', '/api/admin/uploads')).status).toBe(503);
    expect((await call('GET', '/api/admin/wishes')).status).toBe(503);
  });
});

describe('the editor, online', () => {
  const online = () => start({ online: true, login: createLoginGate(PASSWORD) });

  it('keeps the invitation public and caches it briefly at the edge', async () => {
    await online();
    const page = await call('GET', '/');
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=10, stale-while-revalidate=60');
    expect((await call('GET', '/api/wishes')).status).toBe(200);
    expect((await call('GET', '/styles.css')).headers.get('cache-control')).toBe('public, max-age=3600, s-maxage=86400');
  });

  it('needs the password for everything in the editor', async () => {
    await online();
    expect((await call('GET', '/api/admin/session')).data).toMatchObject({ loginRequired: true, signedIn: false });
    for (const [method, url] of [
      ['GET', '/api/admin/invitation'],
      ['PUT', '/api/admin/invitation'],
      ['POST', '/api/admin/preview'],
      ['GET', '/api/admin/templates'],
      ['GET', '/api/admin/wishes'],
      ['POST', '/api/admin/uploads'],
    ]) {
      expect((await call(method, url, method === 'GET' ? undefined : {})).status, `${method} ${url}`).toBe(401);
    }
    expect((await call('POST', '/api/admin/login', { password: 'wrong' })).status).toBe(401);
    const login = await call('POST', '/api/admin/login', { password: PASSWORD });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    expect((await call('GET', '/api/admin/invitation', undefined, { Cookie: cookie })).status).toBe(200);
    expect((await call('GET', '/api/admin/session', undefined, { Cookie: cookie })).data.signedIn).toBe(true);
    const logout = await call('POST', '/api/admin/logout', {});
    expect(logout.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  it('refuses requests sent from other websites', async () => {
    await online();
    expect((await call('POST', '/api/wishes', wish('Aisha'), { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('POST', '/api/wishes', wish('Aisha'), { Origin: 'not a url' })).status).toBe(403);
    expect((await call('POST', '/api/wishes', wish('Aisha'), { Origin: base })).status).toBe(201);
  });

  it('stays closed with a setup message when no password is set', async () => {
    await start({ online: true, editorSetupMessage: 'Add ADMIN_PASSWORD' });
    expect((await call('GET', '/api/admin/session')).data).toMatchObject({ setupMessage: 'Add ADMIN_PASSWORD', signedIn: false });
    expect((await call('GET', '/api/admin/invitation')).data).toEqual({ error: 'Add ADMIN_PASSWORD' });
    expect((await call('POST', '/api/admin/login', { password: 'x' })).status).toBe(503);
    expect((await call('GET', '/')).status).toBe(200);
  });
});
