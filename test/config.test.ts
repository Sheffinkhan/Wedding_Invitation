import { describe, expect, it } from 'vitest';
import { ConfigError, mediaUrls, normaliseInvitation, SCHEMA } from '../src/config.js';
import { DESIGNS, designById, fontsUrl, frameMask } from '../src/designs.js';
import { DEFAULTS } from './fixtures.js';


const withChange = (group: string, change: Record<string, unknown>) => ({
  ...DEFAULTS,
  [group]: { ...(DEFAULTS as unknown as Record<string, object>)[group], ...change },
});

describe('the committed invitation', () => {
  it('loads and matches the printed card', () => {
    expect(DEFAULTS.couple).toEqual({ groom: 'Sahal', bride: 'Sahadiya', joiner: 'with' });
    expect(DEFAULTS.events.map((event) => [event.title, event.date, event.start, event.end])).toEqual([
      ['Nikkah', '2027-01-03', '11:30', ''],
      ['Reception', '2027-01-03', '18:00', '21:00'],
    ]);
    expect(DEFAULTS.venue.name).toBe('Padamugal Madrassa Hall');
    expect(DEFAULTS.theme.design).toBe('royal');
  });

  it('has a value for every field in the schema', () => {
    for (const group of SCHEMA) {
      const value = DEFAULTS[group.key];
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        for (const field of group.fields) expect(item, `${group.key}.${field.key}`).toHaveProperty(field.key);
      }
    }
  });
});

describe('normaliseInvitation', () => {
  it('fills missing groups and fields from the base and drops unknown keys', () => {
    const result = normaliseInvitation({ couple: { groom: '  Sahal  ', extra: 'x' }, unknown: 1 }, DEFAULTS);
    expect(result.couple).toEqual({ groom: 'Sahal', bride: 'Sahadiya', joiner: 'with' });
    expect(result.venue).toEqual(DEFAULTS.venue);
    expect(result).not.toHaveProperty('unknown');
  });

  it('keeps line breaks in long text but not in short text', () => {
    const result = normaliseInvitation(
      withChange('invitation', { hostsAddress: 'Line one\r\nLine two\u0007', hosts: 'Mr A\nMrs B' }),
      DEFAULTS,
    );
    expect(result.invitation.hostsAddress).toBe('Line one\nLine two');
    expect(result.invitation.hosts).toBe('Mr A Mrs B');
  });

  it.each([
    ['theme', { gold: 'gold' }, 'must be a colour'],
    ['theme', { design: 'neon' }, 'must be one of the designs'],
    ['site', { utcOffset: '5:30' }, 'must look like +05:30'],
    ['site', { title: '' }, 'is required'],
    ['couple', { groom: 'x'.repeat(41) }, '40 characters or fewer'],
    ['couple', { groom: 42 }, 'must be text'],
    ['venue', { showQr: 'yes' }, 'must be on or off'],
    ['venue', { mapsUrl: 'javascript:alert(1)' }, 'must be a web address'],
    ['venue', { mapsUrl: '/files/x.jpg' }, 'must be a web address'],
    ['cover', { image: '//evil.example/x.jpg' }, 'must be a web address'],
  ])('rejects %s %o', (group, change, message) => {
    expect(() => normaliseInvitation(withChange(group, change), DEFAULTS)).toThrow(message);
  });

  it('accepts uploaded files and web addresses for photos', () => {
    const local = normaliseInvitation(withChange('cover', { image: '/files/uploads/image-a.jpg' }), DEFAULTS);
    const online = normaliseInvitation(withChange('cover', { image: 'https://x.public.blob.vercel-storage.com/a.jpg' }), DEFAULTS);
    expect(local.cover.image).toBe('/files/uploads/image-a.jpg');
    expect(online.cover.image).toMatch(/^https:/);
    expect(normaliseInvitation(withChange('theme', { navy: '#ABCDEF' }), DEFAULTS).theme.navy).toBe('#abcdef');
  });

  it('checks every event', () => {
    const event = DEFAULTS.events[0];
    expect(() => normaliseInvitation({ ...DEFAULTS, events: [] }, DEFAULTS)).toThrow('between 1 and 4');
    expect(() => normaliseInvitation({ ...DEFAULTS, events: Array(5).fill(event) }, DEFAULTS)).toThrow('between 1 and 4');
    expect(() => normaliseInvitation({ ...DEFAULTS, events: 'Nikkah' }, DEFAULTS)).toThrow('must be a list');
    expect(() => normaliseInvitation({ ...DEFAULTS, events: [{ ...event, date: '2027-02-30' }] }, DEFAULTS)).toThrow(
      'Event 1: Date must be a date',
    );
    expect(() => normaliseInvitation({ ...DEFAULTS, events: [event, { ...event, start: '25:00' }] }, DEFAULTS)).toThrow(
      'Event 2: Starts must be a time',
    );
    const filled = normaliseInvitation({ ...DEFAULTS, events: [{ title: 'Walima', date: '2027-01-05', start: '19:00' }] }, DEFAULTS);
    expect(filled.events).toEqual([{ title: 'Walima', date: '2027-01-05', start: '19:00', end: '', note: '', venue: '', mapsUrl: '' }]);
  });

  it('rejects input that is not an invitation', () => {
    expect(() => normaliseInvitation(null, DEFAULTS)).toThrow(ConfigError);
    expect(() => normaliseInvitation([], DEFAULTS)).toThrow(ConfigError);
  });

  it('lists the uploaded files an invitation uses', () => {
    const inv = normaliseInvitation(
      { ...DEFAULTS, cover: { ...DEFAULTS.cover, image: '/files/a.jpg' }, music: { url: '/files/b.mp3', title: '' } },
      DEFAULTS,
    );
    expect(mediaUrls(inv)).toEqual(['/files/a.jpg', '/files/b.mp3']);
  });
});

describe('designs', () => {
  it('offers five distinct designs with valid colours', () => {
    expect(DESIGNS).toHaveLength(5);
    expect(new Set(DESIGNS.map((design) => design.id)).size).toBe(5);
    for (const design of DESIGNS) {
      for (const colour of Object.values(design.colours)) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
      const theme = normaliseInvitation(withChange('theme', { design: design.id, ...design.colours }), DEFAULTS).theme;
      expect(theme.design).toBe(design.id);
    }
  });

  it('falls back to the first design and builds font and frame addresses', () => {
    expect(designById('missing').id).toBe('royal');
    expect(fontsUrl(designById('emerald'))).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?family=Amiri.*family=Cinzel.*&display=swap$/);
    expect(frameMask(designById('rose'))).toMatch(/^url\("data:image\/svg\+xml,%3Csvg/);
  });
});
