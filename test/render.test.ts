import { describe, expect, it } from 'vitest';
import { normaliseInvitation, type Invitation } from '../src/config.js';
import { escapeHtml, renderInvitation, type PageOptions } from '../src/render.js';
import { DEFAULTS } from './fixtures.js';

const OPTIONS: PageOptions = { baseUrl: 'https://wedding.example', version: 'abc', qrSvg: '<svg id="qr"></svg>', wishesAvailable: true };
const render = (change: Partial<Invitation> = {}, options: Partial<PageOptions> = {}) =>
  renderInvitation(normaliseInvitation({ ...DEFAULTS, ...change }, DEFAULTS), { ...OPTIONS, ...options });

describe('renderInvitation', () => {
  it('shows the printed card wording and every section', () => {
    const html = render();
    for (const text of [
      'Mr. Siyad K A &amp; Mrs. Haseena Siyad',
      'D/o Mr. T M Salam &amp; Mrs. Sumayya Salam',
      'Thattuparambil House, Cheruvattor P.O.,<br>Kothamangalam.',
      'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
      '3rd January 2027',
      '11:30 AM',
      '6:00 PM – 9:00 PM',
      '(1448 Rajab 25)',
      'Padamugal Madrassa Hall',
      'Sunday, 3 January 2027',
    ]) {
      expect(html).toContain(text);
    }
    for (const id of ['cover', 'welcome', 'countdown', 'invitation-card', 'events', 'venue', 'blessing', 'wishes', 'closing']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('<svg id="qr"></svg>');
    expect(html).toContain('href="/calendar/1.ics"');
  });

  it('escapes everything the couple types', () => {
    const html = render({ couple: { groom: '<script>alert(1)</script>', bride: 'A "B"', joiner: '' } });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('A &quot;B&quot;');
    // With no joining word an ampersand is shown.
    expect(html).toContain('<span class="names__joiner">&amp;</span>');
    expect(escapeHtml(`'`)).toBe('&#39;');
  });

  it('keeps page data from closing its script tag', () => {
    const html = render({ countdown: { ...DEFAULTS.countdown, startedMessage: '</script><script>alert(1)</script>' } });
    const data = html.match(/<script type="application\/json" id="invite-data">(.*?)<\/script>/)![1];
    expect(data).not.toContain('</');
    expect(JSON.parse(data).countdown.started).toBe('</script><script>alert(1)</script>');
    expect(JSON.parse(data).countdown.start).toBe('2027-01-03T06:00:00.000Z');
    expect(JSON.parse(data).countdown.end).toBe('2027-01-03T15:30:00.000Z');
  });

  it('builds link previews with absolute addresses', () => {
    expect(render()).toContain('<meta property="og:image" content="https://wedding.example/assets/share.jpg">');
    expect(render({ cover: { ...DEFAULTS.cover, image: '/files/uploads/a.jpg' } })).toContain(
      'content="https://wedding.example/files/uploads/a.jpg"',
    );
    expect(render({ site: { ...DEFAULTS.site, shareImage: 'https://cdn.example/s.jpg' } })).toContain('content="https://cdn.example/s.jpg"');
  });

  it('leaves out switched-off sections and empty extras', () => {
    const sections = Object.fromEntries(Object.keys(DEFAULTS.sections).map((key) => [key, false])) as Invitation['sections'];
    const html = render({ sections, closing: { ...DEFAULTS.closing, footer: '' } });
    for (const id of ['welcome', 'countdown', 'invitation-card', 'events', 'venue', 'blessing', 'wishes', 'closing']) {
      expect(html).not.toContain(`id="${id}"`);
    }
    expect(html).toContain('id="cover"');
    expect(html).not.toContain('class="footer"');
    expect(html).not.toContain('data-music');
  });

  it('adds the music button only with a song', () => {
    const html = render({ music: { url: '/files/uploads/audio-a.mp3', title: 'Nasheed' } });
    expect(html).toContain('<audio data-audio src="/files/uploads/audio-a.mp3"');
    expect(html).toContain('Play music: Nasheed');
  });

  it('says when wishes cannot be stored instead of pretending', () => {
    const html = render({}, { wishesAvailable: false });
    expect(html).toContain('Wishes will open here soon.');
    expect(html).not.toContain('data-wish-form');
  });

  it('applies the chosen design', () => {
    const html = render({ theme: { design: 'emerald', navy: '#0f3b2e', ivory: '#f8f5ec', mist: '#dbe7dc', gold: '#c9a45c' } });
    expect(html).toContain('data-design="emerald"');
    expect(html).toContain('family=Cinzel');
    expect(html).toContain('--navy:#0f3b2e');
    expect(html).toContain('M0 400V175C0 105 88 70 150 0');
  });

  it('uses uploaded photos instead of the drawings', () => {
    const html = render({ venue: { ...DEFAULTS.venue, image: '/files/uploads/hall.jpg', showQr: false } });
    expect(html).toContain('<img src="/files/uploads/hall.jpg" alt="Padamugal Madrassa Hall" loading="lazy"');
    expect(html).not.toContain('class="qr"');
  });
});
