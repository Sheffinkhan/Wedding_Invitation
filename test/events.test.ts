import { describe, expect, it } from 'vitest';
import { normaliseInvitation } from '../src/config.js';
import { calendarFile, cardDate, clockTime, longDate, mapsLink, ordinal, resolveEvents, timeRange, weekday } from '../src/events.js';
import { DEFAULTS } from './fixtures.js';

describe('dates and times', () => {
  it('writes ordinals as printed cards do', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '101st',
      '111th',
      '112th',
    ]);
  });

  it('formats calendar dates without time zone shifts', () => {
    expect(weekday('2027-01-03')).toBe('Sunday');
    expect(longDate('2027-01-03')).toBe('Sunday, 3 January 2027');
    expect(cardDate('2027-01-03')).toBe('3rd January 2027');
  });

  it('uses a 12-hour clock', () => {
    expect(['00:05', '11:30', '12:00', '18:00', '23:59'].map(clockTime)).toEqual(['12:05 AM', '11:30 AM', '12:00 PM', '6:00 PM', '11:59 PM']);
    expect(timeRange({ start: '18:00', end: '21:00' })).toBe('6:00 PM – 9:00 PM');
    expect(timeRange({ start: '11:30', end: '' })).toBe('11:30 AM');
  });

  it('searches Google Maps by name and address unless a link is given', () => {
    expect(mapsLink('Hall', 'Road,\nTown', '')).toBe('https://www.google.com/maps/search/?api=1&query=Hall%2C%20Road%2C%20Town');
    expect(mapsLink('Hall', '', 'https://maps.app.goo.gl/abc')).toBe('https://maps.app.goo.gl/abc');
  });
});

describe('resolveEvents', () => {
  const [nikkah, reception] = resolveEvents(DEFAULTS);

  it('turns local times into exact moments using the venue offset', () => {
    expect(nikkah.startsAt.toISOString()).toBe('2027-01-03T06:00:00.000Z');
    // No end time: two hours are assumed for calendars.
    expect(nikkah.endsAt.toISOString()).toBe('2027-01-03T08:00:00.000Z');
    expect(reception.startsAt.toISOString()).toBe('2027-01-03T12:30:00.000Z');
    expect(reception.endsAt.toISOString()).toBe('2027-01-03T15:30:00.000Z');
  });

  it('uses the main venue unless an event has its own', () => {
    expect(nikkah.venueName).toBe('Padamugal Madrassa Hall');
    expect(nikkah.maps).toContain('Padamugal%20Madrassa%20Hall');
    const inv = normaliseInvitation(
      {
        ...DEFAULTS,
        events: [{ ...DEFAULTS.events[0], venue: 'Juma Masjid', start: '23:00', end: '01:00' }],
      },
      DEFAULTS,
    );
    const [own] = resolveEvents(inv);
    expect(own.venueName).toBe('Juma Masjid');
    expect(own.venueAddress).toBe('');
    expect(own.maps).toBe('https://www.google.com/maps/search/?api=1&query=Juma%20Masjid');
    // Ending after midnight.
    expect(own.endsAt.getTime() - own.startsAt.getTime()).toBe(2 * 60 * 60 * 1000);
  });

  it('builds a Google Calendar link in UTC', () => {
    const url = new URL(reception.calendarUrl);
    expect(url.searchParams.get('dates')).toBe('20270103T123000Z/20270103T153000Z');
    expect(url.searchParams.get('text')).toBe('Reception · Sahal & Sahadiya');
  });
});

describe('calendarFile', () => {
  it('escapes text and folds long lines', () => {
    const inv = normaliseInvitation({ ...DEFAULTS, venue: { ...DEFAULTS.venue, name: 'Hall; East, Wing' } }, DEFAULTS);
    const [event] = resolveEvents(inv);
    const file = calendarFile(inv, event, new Date('2026-10-19T06:00:00Z'));
    expect(file.endsWith('\r\n')).toBe(true);
    expect(file).toContain('DTSTART:20270103T060000Z');
    expect(file).toContain('DTSTAMP:20261019T060000Z');
    expect(file).toContain('LOCATION:Hall\\; East\\, Wing\\, Padamugal\\, Kakkanad\\, Ernakulam\\, Kerala');
    for (const line of file.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(file.replace(/\r\n /g, '')).toContain(`URL:${event.maps}`);
  });
});
