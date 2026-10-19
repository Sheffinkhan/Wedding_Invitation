import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Online storage refused or failed a request. */
export class StorageError extends Error {}

/** Someone else changed a document between our read and our write. */
export class ConflictError extends Error {}

export interface StoredDoc {
  text: string;
  etag: string;
}

/**
 * Where the site keeps the edited invitation, the guest wishes and uploaded
 * files. Documents are written only if they have not changed since they were
 * read, so two guests sending wishes at once cannot overwrite each other.
 */
export interface Storage {
  kind: 'disk' | 'blob';
  readDoc(name: string): Promise<StoredDoc | undefined>;
  /** `etag` null means the document must not exist yet. Throws ConflictError otherwise. */
  writeDoc(name: string, text: string, etag: string | null): Promise<void>;
  /** Stores a file and returns the address pages load it from. */
  putFile(file: string, data: Buffer, contentType: string): Promise<string>;
  readFile(file: string): Promise<Buffer | undefined>;
  /** Removes files by the path given to putFile or by the address it returned. */
  removeFiles(files: string[]): Promise<void>;
  /** Whether an address points at a file this storage holds. */
  owns(url: string): boolean;
}

const ATTEMPTS = 6;

/**
 * Reads a document, applies `change`, and writes it back, retrying when
 * someone else wrote in between. `change` may run more than once.
 */
export async function updateDoc<T>(
  storage: Storage,
  name: string,
  change: (text: string | undefined) => { text: string; result: T },
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const current = await storage.readDoc(name);
    const { text, result } = change(current?.text);
    try {
      await storage.writeDoc(name, text, current?.etag ?? null);
      return result;
    } catch (error) {
      if (!(error instanceof ConflictError) || attempt >= ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 40 * attempt));
    }
  }
}

const etagOf = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);
export const FILES_ROUTE = '/files/';

/**
 * Local storage under one folder. Documents are `<name>.json`, files sit
 * under `files/` and are served at /files/. The checks and writes are
 * synchronous, so a single local server cannot interleave two updates.
 */
export function diskStorage(root: string): Storage {
  const docPath = (name: string) => path.join(root, `${name}.json`);
  const filePath = (file: string) => {
    const relative = file.startsWith(FILES_ROUTE) ? file.slice(FILES_ROUTE.length) : file;
    const resolved = path.resolve(root, 'files', relative);
    if (!resolved.startsWith(path.resolve(root, 'files') + path.sep)) throw new StorageError('Invalid file path');
    return resolved;
  };
  const read = (file: string): Buffer | undefined => {
    try {
      return readFileSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  };

  return {
    kind: 'disk',

    async readDoc(name) {
      const text = read(docPath(name))?.toString('utf8');
      return text === undefined ? undefined : { text, etag: etagOf(text) };
    },

    async writeDoc(name, text, etag) {
      const current = read(docPath(name))?.toString('utf8');
      if ((current === undefined ? null : etagOf(current)) !== etag) throw new ConflictError(`${name} changed`);
      mkdirSync(root, { recursive: true });
      writeFileSync(docPath(name), text);
    },

    async putFile(file, data) {
      const target = filePath(file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, data);
      return FILES_ROUTE + file;
    },

    async readFile(file) {
      return read(filePath(file));
    },

    async removeFiles(files) {
      for (const file of files) rmSync(filePath(file), { force: true });
    },

    owns(url) {
      return url.startsWith(FILES_ROUTE);
    },
  };
}
