import { randomBytes } from 'node:crypto';
import { updateDoc, type Storage } from './storage.js';

export type WishStatus = 'visible' | 'pending' | 'hidden';

export interface Wish {
  id: string;
  name: string;
  message: string;
  createdAt: string;
  likes: number;
  status: WishStatus;
}

/** A wish was refused; the message is shown to the guest. */
export class WishError extends Error {}
export class WishNotFound extends Error {}

export const NAME_MAX = 60;
export const MESSAGE_MAX = 500;
const STORE_LIMIT = 2000;
const DOC = 'wishes';

const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/g;
const LINK = /(https?:\/\/|www\.)/gi;

function clean(value: unknown, keepLines: boolean): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\r\n?/g, '\n').replace(CONTROL, '');
  return keepLines ? text.replace(/\n{3,}/g, '\n\n').trim() : text.replace(/\s+/g, ' ').trim();
}

/** Checks what a guest typed and returns the tidied name and message. */
export function checkWish(input: { name?: unknown; message?: unknown }): { name: string; message: string } {
  const name = clean(input.name, false);
  const message = clean(input.message, true);
  if ([...name].length < 2) throw new WishError('Please enter your name.');
  if ([...name].length > NAME_MAX) throw new WishError(`Please keep your name under ${NAME_MAX} characters.`);
  if ([...message].length < 2) throw new WishError('Please write a message.');
  if ([...message].length > MESSAGE_MAX) throw new WishError(`Please keep your message under ${MESSAGE_MAX} characters.`);
  if ((message.match(LINK)?.length ?? 0) + (name.match(LINK)?.length ?? 0) > 1) {
    throw new WishError('Please leave links out of your message.');
  }
  return { name, message };
}

const parse = (text: string | undefined): Wish[] => (text ? (JSON.parse(text) as Wish[]) : []);
const serialise = (wishes: Wish[]) => JSON.stringify(wishes);
const sameText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;

export interface WishStore {
  /** Every wish, newest first, for the editor. */
  all(): Promise<Wish[]>;
  /** What guests see, newest first. */
  visible(): Promise<Wish[]>;
  add(input: { name: string; message: string }, requireApproval: boolean): Promise<Wish>;
  like(id: string, liked: boolean): Promise<number>;
  setStatus(id: string, status: WishStatus): Promise<Wish>;
  remove(id: string): Promise<void>;
}

/** Guest wishes, kept in one document that is updated with conflict checks. */
export function createWishStore(storage: Storage, now: () => Date = () => new Date()): WishStore {
  const read = async () => parse((await storage.readDoc(DOC))?.text);

  const change = <T>(apply: (wishes: Wish[]) => T) =>
    updateDoc(storage, DOC, (text) => {
      const wishes = parse(text);
      const result = apply(wishes);
      return { text: serialise(wishes), result };
    });

  const find = (wishes: Wish[], id: string) => {
    const wish = wishes.find((item) => item.id === id);
    if (!wish) throw new WishNotFound('That wish no longer exists.');
    return wish;
  };

  return {
    async all() {
      return (await read()).reverse();
    },

    async visible() {
      return (await read()).filter((wish) => wish.status === 'visible').reverse();
    },

    add({ name, message }, requireApproval) {
      return change((wishes) => {
        if (wishes.some((wish) => sameText(wish.name, name) && sameText(wish.message, message))) {
          throw new WishError('This wish has already been sent. Thank you!');
        }
        if (wishes.length >= STORE_LIMIT) throw new WishError('The wishes book is full. Thank you for your kind words.');
        const wish: Wish = {
          id: randomBytes(9).toString('base64url'),
          name,
          message,
          createdAt: now().toISOString(),
          likes: 0,
          status: requireApproval ? 'pending' : 'visible',
        };
        wishes.push(wish);
        return wish;
      });
    },

    like(id, liked) {
      return change((wishes) => {
        const wish = find(wishes, id);
        if (wish.status !== 'visible') throw new WishNotFound('That wish no longer exists.');
        wish.likes = Math.max(0, wish.likes + (liked ? 1 : -1));
        return wish.likes;
      });
    },

    setStatus(id, status) {
      return change((wishes) => {
        const wish = find(wishes, id);
        wish.status = status;
        return { ...wish };
      });
    },

    remove(id) {
      return change((wishes) => {
        find(wishes, id);
        wishes.splice(
          wishes.findIndex((wish) => wish.id === id),
          1,
        );
      });
    },
  };
}

/** Counts recent actions per visitor. Each server instance keeps its own count, so this only slows bursts. */
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const seen = new Map<string, number[]>();
  return (key: string): boolean => {
    const cutoff = now() - windowMs;
    const recent = (seen.get(key) ?? []).filter((time) => time > cutoff);
    if (recent.length >= limit) {
      seen.set(key, recent);
      return false;
    }
    recent.push(now());
    seen.set(key, recent);
    if (seen.size > 5000) seen.delete(seen.keys().next().value!);
    return true;
  };
}
