import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createHostedApp } from '../src/hosted.js';

let server: Server | undefined;

async function session(env: Record<string, string>) {
  const app = createHostedApp(env, process.cwd());
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const page = await fetch(`${base}/`);
  return { page: page.status, session: await (await fetch(`${base}/api/admin/session`)).json() };
}

afterEach(async () => {
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
  server = undefined;
});

describe('createHostedApp', () => {
  it('serves the invitation but keeps the editor closed without a password', async () => {
    const result = await session({});
    expect(result.page).toBe(200);
    expect(result.session.setupMessage).toMatch(/add ADMIN_PASSWORD/);
    expect(result.session.storage).toBeNull();
  });

  it('refuses a short password', async () => {
    expect((await session({ ADMIN_PASSWORD: 'short' })).session.setupMessage).toMatch(/at least 12 characters/);
  });

  it('asks for the password once one is set, and uses a connected Blob store', async () => {
    const result = await session({ ADMIN_PASSWORD: 'a long editor password', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_x' });
    expect(result.session).toMatchObject({ loginRequired: true, signedIn: false, storage: 'blob', wishesAvailable: true });
    expect(result.session.setupMessage).toBeUndefined();
  });
});
