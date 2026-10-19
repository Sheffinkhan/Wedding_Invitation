/** A YouTube video to play as the invitation's song. */
export interface YouTubeVideo {
  id: string;
  /** Seconds into the video to start from, taken from a `t=` or `start=` in the link. */
  start: number;
}

const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isYouTubeLink(value: string): boolean {
  return HOSTS.has(hostOf(value) ?? '');
}

/** “90”, “90s”, “1m30s” or “1h2m3s” as seconds. */
function seconds(value: string | null): number {
  if (!value) return 0;
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(value);
  if (!match) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

/** Reads the video from any common YouTube link: watch, share, Shorts, embed, live or YouTube Music. */
export function parseYouTube(value: string): YouTubeVideo | null {
  if (!isYouTubeLink(value)) return null;
  const url = new URL(value);
  let id: string | null;
  if (url.hostname.toLowerCase() === 'youtu.be') id = url.pathname.split('/')[1] ?? null;
  else if (url.pathname === '/watch') id = url.searchParams.get('v');
  else id = /^\/(?:embed|shorts|live|v)\/([^/]+)/.exec(url.pathname)?.[1] ?? null;
  if (!id || !VIDEO_ID.test(id)) return null;
  return { id, start: seconds(url.searchParams.get('t') ?? url.searchParams.get('start')) };
}
