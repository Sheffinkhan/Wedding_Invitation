import { ConflictError, type Storage } from '../src/storage.js';

/** Storage kept in memory, with hooks to simulate a write landing in between. */
export function memoryStorage() {
  const docs = new Map<string, { text: string; etag: string }>();
  const files = new Map<string, Buffer>();
  let version = 0;
  const storage: Storage & {
    docs: typeof docs;
    files: typeof files;
    beforeWrite?: (name: string) => void;
    removed: string[];
  } = {
    kind: 'blob',
    docs,
    files,
    removed: [],
    async readDoc(name) {
      const doc = docs.get(name);
      return doc && { ...doc };
    },
    async writeDoc(name, text, etag) {
      storage.beforeWrite?.(name);
      if ((docs.get(name)?.etag ?? null) !== etag) throw new ConflictError(`${name} changed`);
      docs.set(name, { text, etag: `v${++version}` });
    },
    async putFile(file, data) {
      files.set(file, data);
      return `https://store.public.blob.vercel-storage.com/${file}`;
    },
    async readFile(file) {
      return files.get(file);
    },
    async removeFiles(list) {
      for (const file of list) {
        storage.removed.push(file);
        files.delete(file.replace('https://store.public.blob.vercel-storage.com/', ''));
      }
    },
    owns(url) {
      return url.startsWith('https://store.public.blob.vercel-storage.com/');
    },
  };
  return storage;
}

export type MemoryStorage = ReturnType<typeof memoryStorage>;
