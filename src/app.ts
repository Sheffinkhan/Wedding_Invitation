import path from 'node:path';
import express, { type ErrorRequestHandler, type Request, type RequestHandler, type Response } from 'express';
import QRCode from 'qrcode';
import { ConfigError, SCHEMA, type Invitation } from './config.js';
import { DESIGNS, FRAME_PATHS } from './designs.js';
import { calendarFile, mapsLink, resolveEvents } from './events.js';
import { ReadOnlyError, type InvitationStore } from './invitationStore.js';
import type { LoginGate } from './login.js';
import { renderInvitation } from './render.js';
import { FILES_ROUTE, StorageError, ConflictError, type Storage } from './storage.js';
import { TEMPLATE_LIMIT, TemplateError, TemplateNotFound, type TemplateStore } from './templates.js';
import { createUploads, PART_BYTES, UploadError } from './uploads.js';
import { checkWish, createRateLimiter, WishError, WishNotFound, type WishStatus, type WishStore } from './wishes.js';

export interface AppDeps {
  invitations: InvitationStore;
  /** Without storage, wishes and uploads are switched off and the editor is read-only. */
  storage: Storage | null;
  wishes: WishStore | null;
  /** Saved versions of the invitation; needs storage. */
  templates: TemplateStore | null;
  publicDir: string;
  /** Where local storage keeps uploaded files, served at /files/uploads. */
  localFilesDir?: string;
  /** Online: the site is public and only the editor needs the login. Locally everything stays on this machine. */
  online: boolean;
  login?: LoginGate;
  /** Online without a usable password, the editor shows this instead of opening. */
  editorSetupMessage?: string;
  version: string;
  now?: () => Date;
  wrongPasswordDelayMs?: number;
  /** Wishes sent faster than this after the page loaded are treated as bots. */
  minimumWishMs?: number;
}

class BadRequest extends Error {}
class NotFound extends Error {}
class Unavailable extends Error {}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const WISH_STATUSES: WishStatus[] = ['visible', 'pending', 'hidden'];
// What the editor needs before anyone is signed in.
const OPEN_EDITOR_PATHS = new Set(['/api/admin/session', '/api/admin/login', '/api/admin/logout']);

function isLocal(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

// Locally the editor can change everything, so only pages from this machine may call the app.
const localOnly: RequestHandler = (req, res, next) => {
  const { host, origin } = req.headers;
  if (!host || !isLocal(`http://${host}`) || (origin !== undefined && !isLocal(origin))) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
};

// Online the site is public, but other websites may not send requests on a visitor's behalf.
const sameOrigin: RequestHandler = (req, res, next) => {
  const { host, origin } = req.headers;
  let originHost: string | null = null;
  try {
    originHost = origin === undefined || origin === 'null' ? null : new URL(origin).host;
  } catch {
    originHost = '';
  }
  if (originHost !== null && originHost !== host) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
};

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const type = (error as { type?: string }).type;
  if (
    error instanceof BadRequest ||
    error instanceof ConfigError ||
    error instanceof WishError ||
    error instanceof UploadError ||
    error instanceof TemplateError
  ) {
    res.status(400).json({ error: error.message });
  } else if (error instanceof NotFound || error instanceof WishNotFound || error instanceof TemplateNotFound) {
    res.status(404).json({ error: error.message });
  } else if (error instanceof ConflictError) {
    res.status(409).json({ error: 'Many people are writing at once. Please try again.' });
  } else if (error instanceof ReadOnlyError || error instanceof Unavailable) {
    res.status(503).json({ error: error.message });
  } else if (error instanceof StorageError) {
    res.status(502).json({ error: error.message });
  } else if (type === 'entity.too.large') {
    res.status(413).json({ error: 'That is too large.' });
  } else if (type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid request' });
  } else {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
};

const noStore = (res: Response) => res.set('Cache-Control', 'no-store');

export function createApp(deps: AppDeps): express.Express {
  const { invitations, storage, wishes, templates, publicDir, online, login, version } = deps;
  const now = deps.now ?? (() => new Date());
  const minimumWishMs = deps.minimumWishMs ?? 2500;
  const uploads = storage ? createUploads(storage) : null;
  const wishLimit = createRateLimiter(5, 10 * 60 * 1000);
  const likeLimit = createRateLimiter(120, 10 * 60 * 1000);
  // Pages and wish lists may be cached at Vercel's edge for a few seconds; locally never.
  const shortCache = (res: Response, seconds: number) =>
    online ? res.set('Cache-Control', `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=60`) : noStore(res);

  const app = express();
  app.disable('x-powered-by');
  if (online) app.set('trust proxy', true);
  app.use(online ? sameOrigin : localOnly);
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // ---- The invitation ----

  /** The invitation page; the editor's preview uses the same rendering, so the two cannot differ. */
  async function page(req: Request, invitation: Invitation): Promise<string> {
    const resolved = resolveEvents(invitation);
    const maps =
      resolved.find((event) => !event.venue)?.maps ??
      mapsLink(invitation.venue.name, invitation.venue.address, invitation.venue.mapsUrl);
    const qrSvg =
      invitation.sections.venue && invitation.venue.showQr
        ? await QRCode.toString(maps, {
            type: 'svg',
            margin: 1,
            errorCorrectionLevel: 'M',
            color: { dark: invitation.theme.navy, light: '#ffffff' },
          })
        : null;
    return renderInvitation(invitation, {
      baseUrl: `${req.protocol}://${req.get('host')}`,
      version,
      qrSvg,
      wishesAvailable: Boolean(wishes),
    });
  }

  app.get('/', async (req, res) => {
    const html = await page(req, await invitations.load());
    shortCache(res, 10);
    res.type('html').send(html);
  });

  app.get('/calendar/:file', async (req, res) => {
    const match = /^(\d{1,2})\.ics$/.exec(req.params.file);
    const invitation = await invitations.load();
    const event = match ? resolveEvents(invitation)[Number(match[1])] : undefined;
    if (!event) throw new NotFound('No such event');
    shortCache(res, 60);
    res
      .type('text/calendar; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="event-${event.index + 1}.ics"`)
      .send(calendarFile(invitation, event, now()));
  });

  // ---- Guest wishes ----

  const requireWishes = () => {
    if (!wishes) throw new Unavailable('Wishes are not open yet.');
    return wishes;
  };

  app.get('/api/wishes', async (_req, res) => {
    const store = requireWishes();
    const invitation = await invitations.load();
    if (!invitation.sections.wishes) throw new Unavailable('Wishes are closed.');
    const list = (await store.visible()).map(({ id, name, message, createdAt, likes }) => ({
      id,
      name,
      message,
      createdAt,
      ...(invitation.wishes.likes ? { likes } : {}),
    }));
    shortCache(res, 3);
    res.json({ wishes: list, likes: invitation.wishes.likes });
  });

  app.post('/api/wishes', express.json({ limit: '8kb' }), async (req, res) => {
    const store = requireWishes();
    const invitation = await invitations.load();
    if (!invitation.sections.wishes) throw new Unavailable('Wishes are closed.');
    const body = (req.body ?? {}) as Record<string, unknown>;
    // Bots fill in the hidden field or send the form the instant the page loads.
    if (body.website || !(Number(body.elapsedMs) >= minimumWishMs)) {
      throw new WishError('Sorry, that could not be sent. Please wait a moment and try again.');
    }
    const wish = checkWish(body);
    if (!wishLimit(req.ip ?? 'unknown')) throw new WishError('You have sent several wishes already. Please try again later.');
    const saved = await store.add(wish, invitation.wishes.requireApproval);
    noStore(res);
    res.status(201).json({
      wish: { id: saved.id, name: saved.name, message: saved.message, createdAt: saved.createdAt, likes: saved.likes },
      pending: saved.status === 'pending',
    });
  });

  app.post('/api/wishes/:id/like', express.json({ limit: '1kb' }), async (req, res) => {
    const store = requireWishes();
    const invitation = await invitations.load();
    if (!invitation.wishes.likes) throw new BadRequest('Likes are switched off.');
    if (!likeLimit(req.ip ?? 'unknown')) throw new BadRequest('Please slow down a little.');
    const liked = (req.body as { liked?: unknown } | undefined)?.liked;
    if (typeof liked !== 'boolean') throw new BadRequest('liked must be true or false');
    noStore(res);
    res.json({ likes: await store.like(req.params.id, liked) });
  });

  // ---- The editor ----

  app.get('/admin', (_req, res) => res.redirect('/admin.html'));

  app.use('/api/admin', (req, res, next) => {
    noStore(res);
    if (!online || OPEN_EDITOR_PATHS.has(req.originalUrl.split('?')[0])) return next();
    if (!login) return res.status(503).json({ error: deps.editorSetupMessage ?? 'The editor is not set up.' });
    if (!login.isSignedIn(req.headers.cookie)) return res.status(401).json({ error: 'Please sign in.' });
    next();
  });

  app.get('/api/admin/session', (req, res) => {
    res.json({
      loginRequired: online,
      signedIn: !online || Boolean(login?.isSignedIn(req.headers.cookie)),
      setupMessage: online && !login ? deps.editorSetupMessage : undefined,
      storage: storage?.kind ?? null,
      wishesAvailable: Boolean(wishes),
    });
  });

  app.post('/api/admin/login', express.json({ limit: '2kb' }), async (req, res) => {
    if (!online) return res.json({ ok: true });
    if (!login) return res.status(503).json({ error: deps.editorSetupMessage ?? 'The editor is not set up.' });
    if (!login.checkPassword((req.body as { password?: unknown } | undefined)?.password)) {
      await new Promise((resolve) => setTimeout(resolve, deps.wrongPasswordDelayMs ?? 1000));
      return res.status(401).json({ error: 'That password is not right.' });
    }
    res.set('Set-Cookie', login.issue()).json({ ok: true });
  });

  app.post('/api/admin/logout', (_req, res) => {
    if (login) res.set('Set-Cookie', login.clear());
    res.json({ ok: true });
  });

  app.get('/api/admin/schema', (_req, res) => res.json({ groups: SCHEMA, designs: DESIGNS, frames: FRAME_PATHS, templateLimit: TEMPLATE_LIMIT }));

  // Renders unsaved changes exactly as guests would see them.
  app.post('/api/admin/preview', express.json({ limit: '200kb' }), async (req, res) => {
    res.type('html').send(await page(req, invitations.check(req.body)));
  });

  app.get('/api/admin/invitation', async (_req, res) => res.json(await invitations.load()));

  app.put('/api/admin/invitation', express.json({ limit: '200kb' }), async (req, res) => {
    res.json(await invitations.save(req.body));
  });

  app.get('/api/admin/wishes', async (_req, res) => res.json(await requireWishes().all()));

  app.patch('/api/admin/wishes/:id', express.json({ limit: '1kb' }), async (req, res) => {
    const status = (req.body as { status?: unknown } | undefined)?.status;
    if (!WISH_STATUSES.includes(status as WishStatus)) throw new BadRequest('Unknown status');
    res.json(await requireWishes().setStatus(req.params.id, status as WishStatus));
  });

  app.delete('/api/admin/wishes/:id', async (req, res) => {
    await requireWishes().remove(req.params.id);
    res.json({ ok: true });
  });

  const requireTemplates = () => {
    if (!templates) throw new Unavailable('Saving templates needs a Vercel Blob store connected to this project.');
    return templates;
  };

  app.get('/api/admin/templates', async (_req, res) => res.json(await requireTemplates().list()));

  app.get('/api/admin/templates/:id', async (req, res) => res.json(await requireTemplates().get(req.params.id)));

  app.post('/api/admin/templates', express.json({ limit: '200kb' }), async (req, res) => {
    const { name, invitation } = (req.body ?? {}) as { name?: unknown; invitation?: unknown };
    res.status(201).json(await requireTemplates().save(name, invitation));
  });

  app.delete('/api/admin/templates/:id', async (req, res) => {
    await requireTemplates().remove(req.params.id);
    res.json({ ok: true });
  });

  const requireUploads = () => {
    if (!uploads) throw new Unavailable('Uploading needs a Vercel Blob store connected to this project.');
    return uploads;
  };

  app.post('/api/admin/uploads', (_req, res) => {
    res.status(201).json({ id: requireUploads().start(), partBytes: PART_BYTES });
  });

  app.put(
    '/api/admin/uploads/:id/:part',
    express.raw({ type: () => true, limit: PART_BYTES }),
    async (req, res) => {
      const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      await requireUploads().part(req.params.id, Number(req.params.part), data);
      res.status(204).end();
    },
  );

  app.post('/api/admin/uploads/:id/finish', express.json({ limit: '1kb' }), async (req, res) => {
    const { parts, kind } = (req.body ?? {}) as { parts?: unknown; kind?: unknown };
    res.status(201).json({ url: await requireUploads().finish(req.params.id, parts, kind) });
  });

  app.use('/api', (_req, _res, next) => next(new NotFound('Not found')));

  // ---- Files ----

  if (deps.localFilesDir) {
    // Local uploads. Temporary upload parts are never served.
    app.use(
      `${FILES_ROUTE}uploads`,
      express.static(path.join(deps.localFilesDir, 'uploads'), { fallthrough: false, index: false }),
    );
  }

  app.use(
    express.static(publicDir, {
      index: false,
      setHeaders(res, file) {
        // The editor must always be current; the rest is cached and re-fetched after a new deployment.
        if (/admin\.(html|js|css)$/.test(file)) res.set('Cache-Control', 'no-store');
        else if (online) res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
      },
    }),
  );

  app.use((_req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });

  app.use(errorHandler);
  return app;
}
