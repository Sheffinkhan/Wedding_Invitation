import { describe, expect, it } from 'vitest';
import { normaliseInvitation } from '../src/config.js';
import { renderInvitation } from '../src/render.js';
import { isYouTubeLink, parseYouTube } from '../src/youtube.js';
import { DEFAULTS } from './fixtures.js';

describe('parseYouTube', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 0],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=2', 0],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42', 42],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=abc', 0],
    ['https://youtu.be/dQw4w9WgXcQ?si=share-token&t=90', 90],
    ['https://youtu.be/dQw4w9WgXcQ?t=1m30s', 90],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1h2m3s', 3723],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 0],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ?start=15', 15],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 0],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 0],
  ])('reads %s', (link, start) => {
    expect(parseYouTube(link)).toEqual({ id: 'dQw4w9WgXcQ', start });
  });

  it('ignores a start time it cannot read', () => {
    expect(parseYouTube('https://youtu.be/dQw4w9WgXcQ?t=soon')?.start).toBe(0);
  });

  it('refuses links without one video', () => {
    for (const link of [
      'https://www.youtube.com/',
      'https://www.youtube.com/@channel',
      'https://www.youtube.com/playlist?list=PL123',
      'https://www.youtube.com/watch?v=short',
      'https://youtu.be/',
      'https://example.com/watch?v=dQw4w9WgXcQ',
      'not a link',
    ]) {
      expect(parseYouTube(link), link).toBeNull();
    }
    expect(isYouTubeLink('https://www.youtube.com/@channel')).toBe(true);
    expect(isYouTubeLink('https://example.com/song.mp3')).toBe(false);
  });
});

describe('a YouTube song on the invitation', () => {
  const withSong = (url: string, title = '') => normaliseInvitation({ ...DEFAULTS, music: { url, title } }, DEFAULTS);
  const options = { baseUrl: 'https://wedding.example', version: 'v', qrSvg: null, wishesAvailable: true };

  it('is checked when saved', () => {
    expect(withSong('https://youtu.be/dQw4w9WgXcQ').music.url).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(() => withSong('https://www.youtube.com/playlist?list=PL123')).toThrow('must link to one YouTube video');
    expect(withSong('https://example.com/song.mp3').music.url).toBe('https://example.com/song.mp3');
  });

  it('plays in a visible Our Song player instead of a hidden audio element', () => {
    const html = renderInvitation(withSong('https://youtu.be/dQw4w9WgXcQ?t=30', 'Tala al Badru'), options);
    expect(html).toContain('id="song"');
    expect(html).toContain('<h2 class="title" id="song-title" data-reveal>Our Song</h2>');
    expect(html).toContain('<p class="song__name" data-reveal>Tala al Badru</p>');
    expect(html).toContain('data-youtube-player');
    expect(html).toContain('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ&amp;t=30s"');
    expect(html).toContain('data-music');
    expect(html).not.toContain('<audio');
    const data = JSON.parse(html.match(/id="invite-data">(.*?)<\/script>/)![1]);
    expect(data.music).toEqual({ title: 'Tala al Badru', youtube: { id: 'dQw4w9WgXcQ', start: 30 } });
  });

  it('keeps uploaded songs in an audio element with no Our Song section', () => {
    const html = renderInvitation(withSong('/files/uploads/audio-a.mp3'), options);
    expect(html).toContain('<audio data-audio src="/files/uploads/audio-a.mp3"');
    expect(html).not.toContain('id="song"');
  });
});
