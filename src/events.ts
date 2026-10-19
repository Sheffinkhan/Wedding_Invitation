import type { EventItem, Invitation } from './config.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DEFAULT_LENGTH_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** An event with its venue filled in and its times resolved. */
export interface ResolvedEvent extends EventItem {
  index: number;
  venueName: string;
  venueAddress: string;
  maps: string;
  startsAt: Date;
  endsAt: Date;
  calendarUrl: string;
}

/** The weekday and date of a YYYY-MM-DD string, read as a calendar date so time zones cannot shift it. */
function parts(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  return { weekday: DAYS[day.getUTCDay()], date: day.getUTCDate(), month: MONTHS[day.getUTCMonth()], year: day.getUTCFullYear() };
}

export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

export function weekday(date: string): string {
  return parts(date).weekday;
}

/** “Sunday, 3 January 2027” */
export function longDate(date: string): string {
  const p = parts(date);
  return `${p.weekday}, ${p.date} ${p.month} ${p.year}`;
}

/** “3rd January 2027”, as printed cards write it. */
export function cardDate(date: string): string {
  const p = parts(date);
  return `${ordinal(p.date)} ${p.month} ${p.year}`;
}

/** “6:00 PM” from “18:00”. */
export function clockTime(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

export function timeRange(event: Pick<EventItem, 'start' | 'end'>): string {
  return event.end ? `${clockTime(event.start)} – ${clockTime(event.end)}` : clockTime(event.start);
}

export function mapsLink(name: string, address: string, link: string): string {
  if (link) return link;
  const query = [name, address.replace(/\s*\n\s*/g, ' ')].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** 20270103T060000Z */
function calendarStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function eventTitle(event: EventItem, invitation: Invitation): string {
  const { groom, bride } = invitation.couple;
  return `${event.title} · ${groom} & ${bride}`;
}

export function resolveEvents(invitation: Invitation): ResolvedEvent[] {
  const { venue, site } = invitation;
  return invitation.events.map((event, index) => {
    const startsAt = new Date(`${event.date}T${event.start}:00${site.utcOffset}`);
    let endsAt = event.end ? new Date(`${event.date}T${event.end}:00${site.utcOffset}`) : new Date(startsAt.getTime() + DEFAULT_LENGTH_MS);
    // An end earlier than the start means the event runs past midnight.
    if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + DAY_MS);
    const ownVenue = Boolean(event.venue);
    const venueName = event.venue || venue.name;
    const venueAddress = ownVenue ? '' : venue.address;
    const maps = event.mapsUrl || (ownVenue ? mapsLink(venueName, '', '') : mapsLink(venue.name, venue.address, venue.mapsUrl));
    const location = [venueName, venueAddress.replace(/\s*\n\s*/g, ' ')].filter(Boolean).join(', ');
    const calendarUrl =
      'https://calendar.google.com/calendar/render?' +
      new URLSearchParams({
        action: 'TEMPLATE',
        text: eventTitle(event, invitation),
        dates: `${calendarStamp(startsAt)}/${calendarStamp(endsAt)}`,
        location,
        details: `Directions: ${maps}`,
      }).toString();
    return { ...event, index, venueName, venueAddress, maps, startsAt, endsAt, calendarUrl };
  });
}

function escapeIcs(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Lines longer than 75 bytes are folded, as the calendar format requires. */
function fold(line: string): string {
  const out: string[] = [];
  let current = '';
  for (const char of line) {
    const limit = out.length ? 74 : 75;
    if (Buffer.byteLength(current + char) > limit) {
      out.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  out.push(current);
  return out.join('\r\n ');
}

/** A calendar file for one event, which phones open straight into their calendar app. */
export function calendarFile(invitation: Invitation, event: ResolvedEvent, now: Date): string {
  const location = [event.venueName, event.venueAddress.replace(/\s*\n\s*/g, ' ')].filter(Boolean).join(', ');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Wedding Invitation//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.date}-${event.index}-${calendarStamp(event.startsAt)}@wedding-invitation`,
    `DTSTAMP:${calendarStamp(now)}`,
    `DTSTART:${calendarStamp(event.startsAt)}`,
    `DTEND:${calendarStamp(event.endsAt)}`,
    `SUMMARY:${escapeIcs(eventTitle(event, invitation))}`,
    `LOCATION:${escapeIcs(location)}`,
    `DESCRIPTION:${escapeIcs(`Directions: ${event.maps}`)}`,
    `URL:${event.maps}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
