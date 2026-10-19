import { readFileSync } from 'node:fs';
import { DESIGNS } from './designs.js';
import { isYouTubeLink, parseYouTube } from './youtube.js';

/**
 * Everything on the invitation that the couple can change. The editor is
 * built from SCHEMA, and every save is checked against it, so a field added
 * here appears in the editor and is validated without further wiring.
 */
export interface EventItem {
  title: string;
  date: string;
  start: string;
  end: string;
  note: string;
  venue: string;
  mapsUrl: string;
}

export interface Invitation {
  site: { title: string; description: string; shareImage: string; utcOffset: string };
  cover: { bismillah: string; label: string; dateText: string; button: string; image: string };
  couple: { groom: string; bride: string; joiner: string };
  intro: {
    heading: string;
    message: string;
    verseArabic: string;
    verseTranslation: string;
    verseReference: string;
    image: string;
  };
  countdown: { heading: string; startedMessage: string; endedMessage: string };
  invitation: {
    heading: string;
    hosts: string;
    hostsAddress: string;
    message: string;
    groomDetails: string;
    brideDetails: string;
  };
  events: EventItem[];
  venue: {
    heading: string;
    name: string;
    address: string;
    directions: string;
    mapsUrl: string;
    image: string;
    showQr: boolean;
    qrLabel: string;
  };
  blessing: { heading: string; arabic: string; translation: string; reference: string };
  wishes: { heading: string; intro: string; likes: boolean; requireApproval: boolean };
  closing: { message: string; signoff: string; image: string; footer: string };
  music: { url: string; title: string };
  labels: {
    songHeading: string;
    eventsHeading: string;
    viewLocation: string;
    addToCalendar: string;
    directions: string;
    sendWishes: string;
    share: string;
    days: string;
    hours: string;
    minutes: string;
    seconds: string;
  };
  theme: { design: string; navy: string; ivory: string; mist: string; gold: string };
  sections: {
    intro: boolean;
    countdown: boolean;
    invitation: boolean;
    events: boolean;
    venue: boolean;
    blessing: boolean;
    wishes: boolean;
    closing: boolean;
  };
}

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'date'
  | 'time'
  | 'color'
  | 'toggle'
  | 'image'
  | 'audio'
  | 'url'
  | 'offset'
  | 'design';

export interface Field {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  max?: number;
  help?: string;
  rtl?: boolean;
}

export interface Group {
  key: keyof Invitation;
  title: string;
  help?: string;
  fields: Field[];
  /** Present when the group is a list of items, such as the events. */
  list?: { min: number; max: number; item: string };
}

export const MAX_EVENTS = 4;

export const SCHEMA: Group[] = [
  {
    key: 'couple',
    title: 'Couple',
    fields: [
      { key: 'groom', label: 'Groom’s name', kind: 'text', required: true, max: 40 },
      { key: 'bride', label: 'Bride’s name', kind: 'text', required: true, max: 40 },
      { key: 'joiner', label: 'Word between the names', kind: 'text', max: 20, help: 'For example “with” or “&”.' },
    ],
  },
  {
    key: 'theme',
    title: 'Design and colours',
    help: 'Picking a design also loads its colours. You can change them afterwards.',
    fields: [
      { key: 'design', label: 'Design', kind: 'design', required: true },
      { key: 'navy', label: 'Deep colour', kind: 'color', required: true, help: 'Text, buttons and dark sections.' },
      { key: 'ivory', label: 'Light colour', kind: 'color', required: true, help: 'Page background.' },
      { key: 'mist', label: 'Soft colour', kind: 'color', required: true, help: 'Soft section backgrounds and petals.' },
      { key: 'gold', label: 'Accent colour', kind: 'color', required: true, help: 'Lines, ornaments and highlights.' },
    ],
  },
  {
    key: 'cover',
    title: 'Opening screen',
    fields: [
      { key: 'bismillah', label: 'Calligraphy line', kind: 'text', max: 120, rtl: true },
      { key: 'label', label: 'Small heading', kind: 'text', max: 60 },
      { key: 'dateText', label: 'Date line', kind: 'text', max: 80, help: 'Leave empty to use the first event’s date.' },
      { key: 'button', label: 'Button text', kind: 'text', required: true, max: 40 },
      { key: 'image', label: 'Couple photo', kind: 'image', help: 'Shown in the arch. Leave empty for the floral illustration.' },
    ],
  },
  {
    key: 'events',
    title: 'Events',
    help: 'The countdown runs to the first event. Times are local to the venue.',
    list: { min: 1, max: MAX_EVENTS, item: 'Event' },
    fields: [
      { key: 'title', label: 'Name', kind: 'text', required: true, max: 40 },
      { key: 'date', label: 'Date', kind: 'date', required: true },
      { key: 'start', label: 'Starts', kind: 'time', required: true },
      { key: 'end', label: 'Ends', kind: 'time', help: 'Optional.' },
      { key: 'note', label: 'Note', kind: 'text', max: 80, help: 'For example the Hijri date.' },
      { key: 'venue', label: 'Venue name', kind: 'text', max: 80, help: 'Leave empty to use the main venue.' },
      { key: 'mapsUrl', label: 'Google Maps link', kind: 'url', help: 'Leave empty to use the main venue’s link.' },
    ],
  },
  {
    key: 'intro',
    title: 'Welcome section',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 60 },
      { key: 'message', label: 'Message', kind: 'textarea', max: 400 },
      { key: 'verseArabic', label: 'Verse in Arabic', kind: 'textarea', max: 400, rtl: true },
      { key: 'verseTranslation', label: 'Verse translation', kind: 'textarea', max: 400 },
      { key: 'verseReference', label: 'Verse reference', kind: 'text', max: 60 },
      { key: 'image', label: 'Background photo', kind: 'image', help: 'Leave empty to reuse the couple photo.' },
    ],
  },
  {
    key: 'countdown',
    title: 'Countdown',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 60 },
      { key: 'startedMessage', label: 'Message while the events are on', kind: 'text', max: 120 },
      { key: 'endedMessage', label: 'Message after the last event', kind: 'text', max: 120 },
    ],
  },
  {
    key: 'invitation',
    title: 'Invitation wording',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 60 },
      { key: 'hosts', label: 'Hosts', kind: 'text', max: 120, help: 'Usually the parents who invite.' },
      { key: 'hostsAddress', label: 'Hosts’ address', kind: 'textarea', max: 300 },
      { key: 'message', label: 'Invitation message', kind: 'textarea', max: 600 },
      { key: 'groomDetails', label: 'Under the groom’s name', kind: 'textarea', max: 300 },
      { key: 'brideDetails', label: 'Under the bride’s name', kind: 'textarea', max: 300 },
    ],
  },
  {
    key: 'venue',
    title: 'Venue',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 60 },
      { key: 'name', label: 'Venue name', kind: 'text', required: true, max: 80 },
      { key: 'address', label: 'Address', kind: 'textarea', max: 300 },
      { key: 'directions', label: 'Directions', kind: 'textarea', max: 400, help: 'Optional, for example a landmark.' },
      {
        key: 'mapsUrl',
        label: 'Google Maps link',
        kind: 'url',
        help: 'Paste the share link from Google Maps. Leave empty to search by name and address.',
      },
      { key: 'image', label: 'Venue photo', kind: 'image', help: 'Leave empty for the illustration.' },
      { key: 'showQr', label: 'Show a QR code for the location', kind: 'toggle' },
      { key: 'qrLabel', label: 'QR code caption', kind: 'text', max: 60 },
    ],
  },
  {
    key: 'blessing',
    title: 'Blessing',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 60 },
      { key: 'arabic', label: 'Dua in Arabic', kind: 'textarea', max: 400, rtl: true },
      { key: 'translation', label: 'Translation', kind: 'textarea', max: 400 },
      { key: 'reference', label: 'Reference', kind: 'text', max: 60 },
    ],
  },
  {
    key: 'wishes',
    title: 'Guest wishes',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 60 },
      { key: 'intro', label: 'Line above the form', kind: 'textarea', max: 300 },
      { key: 'likes', label: 'Let guests like wishes', kind: 'toggle' },
      {
        key: 'requireApproval',
        label: 'Approve wishes before they appear',
        kind: 'toggle',
        help: 'New wishes wait in the Guest wishes tab until you show them.',
      },
    ],
  },
  {
    key: 'closing',
    title: 'Closing',
    fields: [
      { key: 'message', label: 'Closing message', kind: 'textarea', max: 400 },
      { key: 'signoff', label: 'Sign-off', kind: 'text', max: 40 },
      { key: 'image', label: 'Closing photo', kind: 'image', help: 'Leave empty to reuse the couple photo.' },
      { key: 'footer', label: 'Footer', kind: 'text', max: 120 },
    ],
  },
  {
    key: 'music',
    title: 'Music',
    help: 'Plays after a guest opens the invitation, with a button to pause it.',
    fields: [
      {
        key: 'url',
        label: 'Song',
        kind: 'audio',
        help: 'Upload an MP3, M4A or AAC (up to 20 MB), or paste a YouTube link. A YouTube song shows as a small player in an Our Song section, as YouTube requires. Leave empty for no music.',
      },
      { key: 'title', label: 'Song name', kind: 'text', max: 80, help: 'Shown on the music button and under a YouTube player.' },
    ],
  },
  {
    key: 'labels',
    title: 'Buttons and small headings',
    fields: [
      { key: 'songHeading', label: 'Our Song heading', kind: 'text', max: 60, help: 'Shown above a YouTube song.' },
      { key: 'eventsHeading', label: 'Events heading', kind: 'text', max: 60 },
      { key: 'viewLocation', label: 'Location button', kind: 'text', required: true, max: 30 },
      { key: 'addToCalendar', label: 'Calendar button', kind: 'text', required: true, max: 30 },
      { key: 'directions', label: 'Directions button', kind: 'text', required: true, max: 30 },
      { key: 'sendWishes', label: 'Send wishes button', kind: 'text', required: true, max: 30 },
      { key: 'share', label: 'Share button', kind: 'text', required: true, max: 30 },
      { key: 'days', label: 'Countdown: days', kind: 'text', required: true, max: 20 },
      { key: 'hours', label: 'Countdown: hours', kind: 'text', required: true, max: 20 },
      { key: 'minutes', label: 'Countdown: minutes', kind: 'text', required: true, max: 20 },
      { key: 'seconds', label: 'Countdown: seconds', kind: 'text', required: true, max: 20 },
    ],
  },
  {
    key: 'sections',
    title: 'Sections shown',
    fields: [
      { key: 'intro', label: 'Welcome', kind: 'toggle' },
      { key: 'countdown', label: 'Countdown', kind: 'toggle' },
      { key: 'invitation', label: 'Invitation wording', kind: 'toggle' },
      { key: 'events', label: 'Events', kind: 'toggle' },
      { key: 'venue', label: 'Venue', kind: 'toggle' },
      { key: 'blessing', label: 'Blessing', kind: 'toggle' },
      { key: 'wishes', label: 'Guest wishes', kind: 'toggle' },
      { key: 'closing', label: 'Closing', kind: 'toggle' },
    ],
  },
  {
    key: 'site',
    title: 'Link preview',
    help: 'What WhatsApp and other apps show when the link is shared.',
    fields: [
      { key: 'title', label: 'Title', kind: 'text', required: true, max: 100 },
      { key: 'description', label: 'Description', kind: 'text', max: 200 },
      { key: 'shareImage', label: 'Preview image', kind: 'image', help: 'Leave empty to use the couple photo.' },
      {
        key: 'utcOffset',
        label: 'Time zone (UTC offset)',
        kind: 'offset',
        required: true,
        help: 'India is +05:30. Used for the countdown and calendar.',
      },
    ],
  },
];

export class ConfigError extends Error {}

const DEFAULT_MAX = { text: 200, textarea: 1500 } as const;
const URL_MAX = 2000;

// Control characters other than line breaks never belong in invitation text.
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/g;

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** Links must be web addresses or files served by this site. */
function isSafeLink(value: string, allowLocal: boolean): boolean {
  if (allowLocal && /^\/(?!\/)[\w\-./%]*$/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function blank(kind: FieldKind): string | boolean {
  return kind === 'toggle' ? false : '';
}

function checkField(field: Field, value: unknown, where: string): string | boolean {
  const name = `${where}${field.label}`;
  if (field.kind === 'toggle') {
    if (typeof value !== 'boolean') throw new ConfigError(`${name} must be on or off`);
    return value;
  }
  if (typeof value !== 'string') throw new ConfigError(`${name} must be text`);
  let text = value.replace(/\r\n?/g, '\n').replace(CONTROL, '');
  text = field.kind === 'textarea' ? text.trim() : text.replace(/\s+/g, ' ').trim();
  if (!text) {
    if (field.required) throw new ConfigError(`${name} is required`);
    return '';
  }
  switch (field.kind) {
    case 'text':
    case 'textarea': {
      const max = field.max ?? DEFAULT_MAX[field.kind];
      if ([...text].length > max) throw new ConfigError(`${name} must be ${max} characters or fewer`);
      return text;
    }
    case 'date':
      if (!isValidDate(text)) throw new ConfigError(`${name} must be a date`);
      return text;
    case 'time':
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new ConfigError(`${name} must be a time such as 18:30`);
      return text;
    case 'color':
      if (!/^#[0-9a-f]{6}$/i.test(text)) throw new ConfigError(`${name} must be a colour such as #0e1b3d`);
      return text.toLowerCase();
    case 'design':
      if (!DESIGNS.some((design) => design.id === text)) throw new ConfigError(`${name} must be one of the designs`);
      return text;
    case 'offset':
      if (!/^[+-](0\d|1[0-4]):[0-5]\d$/.test(text)) throw new ConfigError(`${name} must look like +05:30`);
      return text;
    case 'image':
    case 'audio':
    case 'url':
      if (text.length > URL_MAX || !isSafeLink(text, field.kind !== 'url')) {
        throw new ConfigError(`${name} must be a web address starting with https://`);
      }
      if (field.kind === 'audio' && isYouTubeLink(text) && !parseYouTube(text)) {
        throw new ConfigError(`${name} must link to one YouTube video. Copy the link from the video's Share button.`);
      }
      return text;
  }
}

function checkGroup(fields: Field[], input: unknown, base: Record<string, unknown> | null, where: string) {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    result[field.key] =
      field.key in source ? checkField(field, source[field.key], where) : (base?.[field.key] ?? blank(field.kind));
  }
  return result;
}

/**
 * Checks an invitation and fills anything missing from `base`. Unknown keys
 * are dropped, so a stored copy from an older version still loads.
 */
export function normaliseInvitation(input: unknown, base: Invitation | null): Invitation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ConfigError('Invitation must be an object');
  const source = input as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const group of SCHEMA) {
    const given = source[group.key];
    const fallback = base?.[group.key];
    if (group.list) {
      if (given === undefined && fallback) {
        result[group.key] = fallback;
        continue;
      }
      if (!Array.isArray(given)) throw new ConfigError(`${group.title} must be a list`);
      if (given.length < group.list.min || given.length > group.list.max) {
        throw new ConfigError(`${group.title}: add between ${group.list.min} and ${group.list.max}`);
      }
      result[group.key] = given.map((item, index) =>
        checkGroup(group.fields, item, null, `${group.list!.item} ${index + 1}: `),
      );
    } else {
      result[group.key] = checkGroup(
        group.fields,
        given,
        (fallback as Record<string, unknown> | undefined) ?? null,
        `${group.title}: `,
      );
    }
  }
  return result as unknown as Invitation;
}

/** Reads the committed invitation file that seeds the site. */
export function loadDefaults(file: string): Invitation {
  return normaliseInvitation(JSON.parse(readFileSync(file, 'utf8')), null);
}

/** Every uploaded file the invitation points at. */
export function mediaUrls(invitation: Invitation): string[] {
  return [
    invitation.cover.image,
    invitation.intro.image,
    invitation.venue.image,
    invitation.closing.image,
    invitation.site.shareImage,
    invitation.music.url,
  ].filter(Boolean);
}
