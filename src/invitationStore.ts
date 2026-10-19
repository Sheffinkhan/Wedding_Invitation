import { mediaUrls, normaliseInvitation, type Invitation } from './config.js';
import { updateDoc, type Storage } from './storage.js';

const DOC = 'invitation';
const CACHE_MS = 5_000;

/** Saving needs storage; without it the site shows the committed invitation. */
export class ReadOnlyError extends Error {}

export interface InvitationStore {
  load(): Promise<Invitation>;
  save(input: unknown): Promise<Invitation>;
  /** Checks an invitation from the editor without saving it, for the preview. */
  check(input: unknown): Invitation;
}

/**
 * The invitation as last saved in the editor, or the committed
 * `content/invitation.json` until the first save. Loads are cached briefly
 * because every page view needs one.
 */
export function createInvitationStore(
  storage: Storage | null,
  defaults: Invitation,
  options: { now?: () => number; keepMedia?: () => Promise<string[]> } = {},
): InvitationStore {
  const now = options.now ?? Date.now;
  let cached: { value: Invitation; at: number } | undefined;

  const parse = (text: string | undefined): Invitation => {
    if (text === undefined) return defaults;
    try {
      return normaliseInvitation(JSON.parse(text), defaults);
    } catch (error) {
      // A damaged copy must not take the invitation down; the editor can save over it.
      console.error('Stored invitation could not be read, showing the defaults instead:', error);
      return defaults;
    }
  };

  return {
    async load() {
      if (!storage) return defaults;
      if (cached && now() - cached.at < CACHE_MS) return cached.value;
      const value = parse((await storage.readDoc(DOC))?.text);
      cached = { value, at: now() };
      return value;
    },

    check(input) {
      return normaliseInvitation(input, defaults);
    },

    async save(input) {
      if (!storage) {
        throw new ReadOnlyError(
          'Saving online needs a Vercel Blob store connected to this project. Until then the site shows content/invitation.json.',
        );
      }
      const next = normaliseInvitation(input, defaults);
      const previous = await updateDoc(storage, DOC, (text) => ({
        text: JSON.stringify(next, null, 2),
        result: parse(text),
      }));
      cached = { value: next, at: now() };
      // Uploads nothing uses any more are removed, so replaced photos do not pile up.
      const kept = new Set([...mediaUrls(next), ...((await options.keepMedia?.()) ?? [])]);
      const unused = mediaUrls(previous).filter((url) => !kept.has(url) && storage.owns(url));
      if (unused.length) {
        await storage.removeFiles(unused).catch((error) => console.error('Could not remove old uploads:', error));
      }
      return next;
    },
  };
}
