import { describe, expect, it } from 'vitest';
import { checkWish, createRateLimiter, createWishStore, WishError, WishNotFound } from '../src/wishes.js';
import { memoryStorage } from './memoryStorage.js';

describe('checkWish', () => {
  it('tidies names and messages', () => {
    expect(checkWish({ name: '  Aisha \n K ', message: ' Mabrook!\r\n\n\n\nDuas \u0007' })).toEqual({
      name: 'Aisha K',
      message: 'Mabrook!\n\nDuas',
    });
  });

  it.each([
    [{ name: 'A', message: 'Hello' }, 'enter your name'],
    [{ name: 'x'.repeat(61), message: 'Hello' }, 'name under 60'],
    [{ name: 'Aisha', message: '' }, 'write a message'],
    [{ name: 'Aisha', message: 42 }, 'write a message'],
    [{ name: 'Aisha', message: 'x'.repeat(501) }, 'under 500'],
    [{ name: 'Aisha', message: 'see https://a.example and www.b.example' }, 'leave links out'],
  ])('refuses %o', (input, message) => {
    expect(() => checkWish(input)).toThrow(message);
  });
});

describe('wish store', () => {
  let clock = Date.UTC(2026, 9, 19);
  const store = () => createWishStore(memoryStorage(), () => new Date((clock += 1000)));

  it('shows new wishes newest first, or holds them for approval', async () => {
    const wishes = store();
    await wishes.add({ name: 'Aisha', message: 'Mabrook' }, false);
    const held = await wishes.add({ name: 'Omar', message: 'Barakallah' }, true);
    await wishes.add({ name: 'Zara', message: 'Congratulations' }, false);
    expect(held.status).toBe('pending');
    expect((await wishes.visible()).map((wish) => wish.name)).toEqual(['Zara', 'Aisha']);
    expect((await wishes.all()).map((wish) => wish.name)).toEqual(['Zara', 'Omar', 'Aisha']);
    await wishes.setStatus(held.id, 'visible');
    expect((await wishes.visible()).map((wish) => wish.name)).toEqual(['Zara', 'Omar', 'Aisha']);
  });

  it('refuses the same wish twice', async () => {
    const wishes = store();
    await wishes.add({ name: 'Aisha', message: 'Mabrook' }, false);
    await expect(wishes.add({ name: 'AISHA', message: 'mabrook' }, false)).rejects.toThrow(WishError);
  });

  it('counts likes without going below zero', async () => {
    const wishes = store();
    const wish = await wishes.add({ name: 'Aisha', message: 'Mabrook' }, false);
    expect(await wishes.like(wish.id, true)).toBe(1);
    expect(await wishes.like(wish.id, true)).toBe(2);
    expect(await wishes.like(wish.id, false)).toBe(1);
    expect(await wishes.like(wish.id, false)).toBe(0);
    expect(await wishes.like(wish.id, false)).toBe(0);
    await wishes.setStatus(wish.id, 'hidden');
    await expect(wishes.like(wish.id, true)).rejects.toThrow(WishNotFound);
  });

  it('removes wishes', async () => {
    const wishes = store();
    const wish = await wishes.add({ name: 'Aisha', message: 'Mabrook' }, false);
    await wishes.add({ name: 'Omar', message: 'Barakallah' }, false);
    await wishes.remove(wish.id);
    expect((await wishes.all()).map((item) => item.name)).toEqual(['Omar']);
    await expect(wishes.remove(wish.id)).rejects.toThrow(WishNotFound);
    await expect(wishes.setStatus('missing', 'visible')).rejects.toThrow(WishNotFound);
  });

  it('stops accepting wishes when the book is full', async () => {
    const storage = memoryStorage();
    const full = Array.from({ length: 2000 }, (_, i) => ({
      id: String(i),
      name: `Guest ${i}`,
      message: 'Mabrook',
      createdAt: '2026-10-19T00:00:00.000Z',
      likes: 0,
      status: 'visible',
    }));
    storage.docs.set('wishes', { text: JSON.stringify(full), etag: 'e' });
    await expect(createWishStore(storage).add({ name: 'Late', message: 'Sorry' }, false)).rejects.toThrow('full');
  });
});

describe('rate limiter', () => {
  it('allows a few actions per window for each visitor', () => {
    let now = 0;
    const allow = createRateLimiter(2, 1000, () => now);
    expect([allow('a'), allow('a'), allow('a'), allow('b')]).toEqual([true, true, false, true]);
    now = 1001;
    expect(allow('a')).toBe(true);
  });
});
