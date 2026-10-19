import { randomBytes } from 'node:crypto';
import { BlobPreconditionFailedError, del, get, list, put } from '@vercel/blob';
import { ConflictError, StorageError, type Storage } from './storage.js';

/** The part of the Vercel Blob SDK this module uses, so tests can supply a fake. */
export interface BlobClient {
  put: typeof put;
  get: typeof get;
  list: typeof list;
  del: typeof del;
}

/**
 * How to reach the Blob store. Older connections give a read-write token;
 * newer ones give only a store id and rely on Vercel's built-in OIDC sign-in,
 * which the Blob SDK picks up by itself.
 */
export type BlobCredentials = { token: string } | { storeId: string };

const realClient: BlobClient = { put, get, list, del };
const SITE = 'site/';

/** Finds the store connection in the environment, also under a custom variable prefix. */
export function findBlobCredentials(env: Record<string, string | undefined>): BlobCredentials | null {
  const entries = Object.entries(env);
  const token =
    env.BLOB_READ_WRITE_TOKEN || entries.find(([, value]) => value?.startsWith('vercel_blob_rw_'))?.[1];
  if (token) return { token };
  const storeId =
    env.BLOB_STORE_ID || entries.find(([name, value]) => name.endsWith('STORE_ID') && value?.startsWith('store_'))?.[1];
  return storeId ? { storeId } : null;
}

/** Blob failures are almost always setup problems, so say where to look. */
function setupError(error: unknown): StorageError {
  const detail = error instanceof Error ? error.message.replace(/^Vercel Blob:\s*/, '') : String(error);
  return new StorageError(
    `Online storage refused the request (${detail}). In Vercel, check that the Blob store has Public access and is connected to this project, then redeploy.`,
  );
}

async function guarded<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    throw setupError(error);
  }
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

/**
 * Vercel Blob storage. The store must be public, because photos and music
 * are loaded straight from it by guests' phones. Documents (the edited
 * invitation and the wishes) live in a folder with a random name, created on
 * first use, so their addresses cannot be guessed.
 */
export function blobStorage(credentials: BlobCredentials, client: BlobClient = realClient): Storage {
  let folder: Promise<string> | undefined;

  async function oldestFolder(): Promise<string | undefined> {
    const page = await guarded(client.list({ prefix: SITE, limit: 1000, ...credentials }));
    const oldest = [...page.blobs].sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime())[0];
    return oldest?.pathname.split('/')[1];
  }

  async function findFolder(): Promise<string> {
    const existing = await oldestFolder();
    if (existing) return existing;
    const created = randomBytes(18).toString('base64url');
    await guarded(
      client.put(`${SITE}${created}/.folder`, created, {
        access: 'public',
        addRandomSuffix: false,
        contentType: 'text/plain',
        ...credentials,
      }),
    );
    // If two requests created a folder at the same moment, both settle on the older one.
    return (await oldestFolder()) ?? created;
  }

  const docPath = async (name: string) => {
    folder ??= findFolder().catch((error) => {
      folder = undefined;
      throw error;
    });
    return `${SITE}${await folder}/${name}.json`;
  };

  return {
    kind: 'blob',

    async readDoc(name) {
      const found = await guarded(
        client.get(await docPath(name), { access: 'public', useCache: false, ...credentials }),
      );
      if (!found || found.statusCode !== 200) return undefined;
      return { text: (await readAll(found.stream)).toString('utf8'), etag: found.blob.etag };
    },

    async writeDoc(name, text, etag) {
      try {
        await client.put(await docPath(name), text, {
          access: 'public',
          addRandomSuffix: false,
          contentType: 'application/json',
          cacheControlMaxAge: 60,
          ...(etag === null ? { allowOverwrite: false } : { allowOverwrite: true, ifMatch: etag }),
          ...credentials,
        });
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError || (etag === null && /exist/i.test(String(error)))) {
          throw new ConflictError(`${name} changed`);
        }
        throw setupError(error);
      }
    },

    async putFile(file, data, contentType) {
      const { url } = await guarded(
        client.put(file, data, {
          access: 'public',
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType,
          multipart: data.length > 8_000_000,
          ...credentials,
        }),
      );
      return url;
    },

    async readFile(file) {
      const found = await guarded(client.get(file, { access: 'public', useCache: false, ...credentials }));
      return found?.statusCode === 200 ? readAll(found.stream) : undefined;
    },

    async removeFiles(files) {
      if (files.length) await guarded(client.del(files, { ...credentials }));
    },

    owns(url) {
      try {
        return new URL(url).hostname.endsWith('.blob.vercel-storage.com');
      } catch {
        return false;
      }
    },
  };
}
