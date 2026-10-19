import { BlobPreconditionFailedError } from '@vercel/blob';
import { describe, expect, it, vi } from 'vitest';
import { blobStorage, findBlobCredentials, type BlobClient } from '../src/blobStorage.js';
import { ConflictError, StorageError } from '../src/storage.js';

interface Stored {
  data: Buffer;
  etag: string;
  uploadedAt: Date;
  options: Record<string, unknown>;
}

/** A small stand-in for the Blob service: put, get, list and del with ETags. */
function fakeClient() {
  const blobs = new Map<string, Stored>();
  let version = 0;
  let clock = 0;
  const url = (pathname: string) => `https://store.public.blob.vercel-storage.com/${pathname}`;
  const client = {
    blobs,
    put: vi.fn(async (pathname: string, body: string | Buffer, options: Record<string, unknown>) => {
      const existing = blobs.get(pathname);
      if (existing && !options.allowOverwrite) throw new Error('Vercel Blob: This blob already exists');
      if (options.ifMatch && existing?.etag !== options.ifMatch) throw new BlobPreconditionFailedError();
      blobs.set(pathname, { data: Buffer.from(body), etag: `"${++version}"`, uploadedAt: new Date(++clock), options });
      return { url: url(pathname), pathname };
    }),
    get: vi.fn(async (pathname: string) => {
      const found = blobs.get(pathname);
      if (!found) return null;
      return {
        statusCode: 200,
        stream: new Response(new Uint8Array(found.data)).body,
        blob: { etag: found.etag },
      };
    }),
    list: vi.fn(async ({ prefix }: { prefix: string }) => ({
      blobs: [...blobs.entries()]
        .filter(([pathname]) => pathname.startsWith(prefix))
        .map(([pathname, blob]) => ({ pathname, url: url(pathname), uploadedAt: blob.uploadedAt })),
      hasMore: false,
    })),
    del: vi.fn(async (urls: string[]) => {
      for (const item of urls) blobs.delete(item.replace('https://store.public.blob.vercel-storage.com/', ''));
    }),
  };
  return client;
}

const asClient = (client: ReturnType<typeof fakeClient>) => client as unknown as BlobClient;

describe('findBlobCredentials', () => {
  it('finds a read-write token, also under a custom prefix', () => {
    expect(findBlobCredentials({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_abc' })).toEqual({ token: 'vercel_blob_rw_abc' });
    expect(findBlobCredentials({ WEDDING_READ_WRITE_TOKEN: 'vercel_blob_rw_xyz' })).toEqual({ token: 'vercel_blob_rw_xyz' });
  });

  it('falls back to a store id for OIDC connections', () => {
    expect(findBlobCredentials({ BLOB_STORE_ID: 'store_1' })).toEqual({ storeId: 'store_1' });
    expect(findBlobCredentials({ WEDDING_STORE_ID: 'store_2' })).toEqual({ storeId: 'store_2' });
    expect(findBlobCredentials({ OTHER: 'x' })).toBeNull();
  });
});

describe('blobStorage', () => {
  const credentials = { token: 'vercel_blob_rw_test' };

  it('keeps documents in one hidden folder, created on first use', async () => {
    const client = fakeClient();
    const storage = blobStorage(credentials, asClient(client));
    expect(await storage.readDoc('wishes')).toBeUndefined();
    await storage.writeDoc('wishes', '[]', null);
    const doc = (await storage.readDoc('wishes'))!;
    expect(doc.text).toBe('[]');
    const paths = [...client.blobs.keys()];
    expect(paths).toHaveLength(2);
    expect(paths.every((pathname) => /^site\/[\w-]{24}\//.test(pathname))).toBe(true);
    // A second instance finds the same folder.
    const again = blobStorage(credentials, asClient(client));
    expect((await again.readDoc('wishes'))?.text).toBe('[]');
    expect(client.put.mock.calls[0][2]).toMatchObject({ token: 'vercel_blob_rw_test', access: 'public' });
  });

  it('writes only over the version that was read', async () => {
    const client = fakeClient();
    const storage = blobStorage(credentials, asClient(client));
    await storage.writeDoc('invitation', '{"a":1}', null);
    const first = (await storage.readDoc('invitation'))!;
    await expect(storage.writeDoc('invitation', '{}', null)).rejects.toThrow(ConflictError);
    await storage.writeDoc('invitation', '{"a":2}', first.etag);
    await expect(storage.writeDoc('invitation', '{"a":3}', first.etag)).rejects.toThrow(ConflictError);
    const write = client.put.mock.calls.at(-2)![2];
    expect(write).toMatchObject({ allowOverwrite: true, ifMatch: first.etag, addRandomSuffix: false });
  });

  it('stores, reads and removes files', async () => {
    const client = fakeClient();
    const storage = blobStorage({ storeId: 'store_1' }, asClient(client));
    const url = await storage.putFile('uploads/a.jpg', Buffer.from('jpg'), 'image/jpeg');
    expect(storage.owns(url)).toBe(true);
    expect(storage.owns('/files/a.jpg')).toBe(false);
    expect(storage.owns('https://example.com/a.jpg')).toBe(false);
    expect((await storage.readFile('uploads/a.jpg'))?.toString()).toBe('jpg');
    expect(await storage.readFile('uploads/missing.jpg')).toBeUndefined();
    await storage.removeFiles([]);
    expect(client.del).not.toHaveBeenCalled();
    await storage.removeFiles([url]);
    expect(client.blobs.has('uploads/a.jpg')).toBe(false);
    expect(client.put.mock.calls[0][2]).toMatchObject({ storeId: 'store_1', multipart: false, contentType: 'image/jpeg' });
  });

  it('turns service errors into setup advice', async () => {
    const client = fakeClient();
    client.list.mockRejectedValue(new Error('Vercel Blob: Access denied'));
    const storage = blobStorage(credentials, asClient(client));
    await expect(storage.readDoc('wishes')).rejects.toThrow(StorageError);
    await expect(storage.readDoc('wishes')).rejects.toThrow('(Access denied). In Vercel, check that the Blob store has Public access');
    client.list.mockRestore?.();
    const writes = fakeClient();
    const second = blobStorage(credentials, asClient(writes));
    await second.writeDoc('doc', '1', null);
    writes.put.mockRejectedValueOnce(new Error('Vercel Blob: Store suspended'));
    await expect(second.writeDoc('doc', '2', 'any')).rejects.toThrow('Store suspended');
  });
});
