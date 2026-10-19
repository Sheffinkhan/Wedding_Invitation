import type { Invitation } from './config.js';
import { designById, FRAME_PATHS, fontsUrl, frameMask, type Design } from './designs.js';
import { cardDate, longDate, resolveEvents, timeRange, weekday, type ResolvedEvent } from './events.js';

export interface PageOptions {
  /** e.g. https://example.vercel.app, for the link preview tags. */
  baseUrl: string;
  /** Added to asset addresses so a new deployment is never served stale files. */
  version: string;
  /** QR code for the venue location, as SVG markup. */
  qrSvg: string | null;
  /** Whether guest wishes can be stored. */
  wishesAvailable: boolean;
}

/** Every piece of invitation text goes through here before it reaches the page. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const lines = (value: string) => value.split('\n').map(escapeHtml).join('<br>');

/** Data for the page script. `<` is escaped so the text can never close the script tag. */
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

const absolute = (url: string, base: string) => (url.startsWith('/') ? base + url : url);

const icon = (name: string, className = 'icon') =>
  `<svg class="${className}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;

const divider = (className = '') => `<svg class="divider ${className}" aria-hidden="true" focusable="false"><use href="#i-divider"/></svg>`;

/** Shared drawings, referenced with <use>. Colours come from the theme through CSS. */
const SPRITE = `<svg width="0" height="0" class="sprite" aria-hidden="true" focusable="false">
<defs>
<symbol id="i-petal" viewBox="0 0 40 40"><path d="M20 40C-3 26 4 4 20 0c16 4 23 26 0 40Z"/></symbol>
<symbol id="i-rose" viewBox="-50 -50 100 100"><g class="rose">
<g class="rose__outer"><path d="M0 0C-20-8-26-38 0-47 26-38 20-8 0 0Z"/><path transform="rotate(72)" d="M0 0C-20-8-26-38 0-47 26-38 20-8 0 0Z"/><path transform="rotate(144)" d="M0 0C-20-8-26-38 0-47 26-38 20-8 0 0Z"/><path transform="rotate(216)" d="M0 0C-20-8-26-38 0-47 26-38 20-8 0 0Z"/><path transform="rotate(288)" d="M0 0C-20-8-26-38 0-47 26-38 20-8 0 0Z"/></g>
<g class="rose__mid" transform="rotate(36) scale(.66)"><path d="M0 0C-20-8-26-38 0-47 26-38 20-8 0 0Z"/><path transform="rotate(72)" d="M0 0C-20-8-26-38 0-47 26-38 20-8 0 0Z"/><path transform="rotate(144)" d="M0 0C-20-8-26-38 0-47 26-38 20-8 0 0Z"/><path transform="rotate(216)" d="M0 0C-20-8-26-38 0-47 26-38 20-8 0 0Z"/><path transform="rotate(288)" d="M0 0C-20-8-26-38 0-47 26-38 20-8 0 0Z"/></g>
<path class="rose__heart" d="M-2 3c-6-2-6-10 1-12 8-2 14 5 11 12-3 8-15 9-20 2-6-8 0-20 11-21"/>
</g></symbol>
<symbol id="i-leaf" viewBox="0 -12 48 24"><path class="leaf" d="M0 0C10-13 34-13 48 0 34 13 10 13 0 0Z"/><path class="leaf__vein" d="M3 0H44"/></symbol>
<symbol id="i-sprig" viewBox="0 0 220 130"><g class="sprig">
<path class="stem" d="M8 122C52 98 92 84 140 70s58-34 74-62M70 94c4-22 18-40 40-50M136 72c18 6 36 20 46 40"/>
<use href="#i-leaf" x="40" y="86" width="44" height="22" transform="rotate(-28 62 97)"/>
<use href="#i-leaf" x="96" y="64" width="44" height="22" transform="rotate(-62 118 75)"/>
<use href="#i-leaf" x="150" y="84" width="40" height="20" transform="rotate(48 170 94)"/>
<use href="#i-leaf" x="178" y="30" width="36" height="18" transform="rotate(-70 196 39)"/>
<use href="#i-rose" x="92" y="26" width="64" height="64"/>
<use href="#i-rose" x="30" y="70" width="44" height="44"/>
<use href="#i-rose" x="160" y="52" width="40" height="40"/>
<circle class="bud" cx="112" cy="40" r="4"/><circle class="bud" cx="200" cy="12" r="3.5"/><circle class="bud" cx="184" cy="110" r="3"/>
</g></symbol>
<symbol id="i-divider" viewBox="0 0 240 24"><g class="ornament">
<path d="M8 12H92M148 12H232"/><circle cx="100" cy="12" r="1.8"/><circle cx="140" cy="12" r="1.8"/>
<g transform="translate(120 12)"><rect x="-7" y="-7" width="14" height="14"/><rect x="-7" y="-7" width="14" height="14" transform="rotate(45)"/><circle r="2.4" class="fill"/></g>
</g></symbol>
<symbol id="i-pin" viewBox="0 0 24 24"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.6"/></symbol>
<symbol id="i-calendar" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></symbol>
<symbol id="i-heart" viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.3-9.4C1.4 7.6 3.6 4.5 7 4.5c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.4 0 5.6 3.1 4.3 6.6-1.8 4.8-9.3 9.4-9.3 9.4Z"/></symbol>
<symbol id="i-music" viewBox="0 0 24 24"><path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></symbol>
<symbol id="i-share" viewBox="0 0 24 24"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.9l7.6-4.6M8.2 13.1l7.6 4.6"/></symbol>
</defs></svg>`;

/** The dreamy garden drawn when no photo has been added. `night` is the darker closing version. */
function gardenScene(id: string, night = false): string {
  return `<svg class="scene${night ? ' scene--night' : ''}" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Floral garden with a crescent moon">
<defs>
<linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="sky-top"/><stop offset=".62" class="sky-mid"/><stop offset="1" class="sky-low"/></linearGradient>
<radialGradient id="${id}-glow" cx=".5" cy=".3" r=".5"><stop offset="0" class="glow" stop-opacity=".9"/><stop offset="1" class="glow" stop-opacity="0"/></radialGradient>
<mask id="${id}-moon"><rect width="300" height="400" fill="#fff"/><circle cx="162" cy="84" r="22" fill="#000"/></mask>
</defs>
<rect width="300" height="400" fill="url(#${id}-sky)"/>
<circle class="glow-disk" cx="150" cy="120" r="150" fill="url(#${id}-glow)"/>
<g class="stars"><circle cx="58" cy="60" r="1.4"/><circle cx="236" cy="48" r="1.2"/><circle cx="210" cy="118" r="1"/><circle cx="84" cy="128" r="1"/><circle cx="262" cy="152" r="1.3"/><circle cx="36" cy="170" r="1"/></g>
<circle class="moon" cx="150" cy="92" r="26" mask="url(#${id}-moon)"/>
<path class="moon" d="M196 66l2.6 6 6 2.6-6 2.6-2.6 6-2.6-6-6-2.6 6-2.6Z"/>
<g class="cloud cloud--a"><ellipse cx="60" cy="214" rx="70" ry="20"/><ellipse cx="98" cy="200" rx="40" ry="22"/><ellipse cx="34" cy="204" rx="30" ry="16"/></g>
<g class="cloud cloud--b"><ellipse cx="236" cy="190" rx="74" ry="18"/><ellipse cx="206" cy="176" rx="36" ry="20"/><ellipse cx="262" cy="178" rx="28" ry="15"/></g>
<g class="domes"><path d="M104 300v-30c0-26 22-44 46-58 24 14 46 32 46 58v30Z"/><path d="M147 212h6l-3-14Z"/><rect x="70" y="214" width="12" height="86"/><path d="M68 216c0-12 8-20 8-26 0 6 8 14 8 26Z"/><rect x="218" y="214" width="12" height="86"/><path d="M216 216c0-12 8-20 8-26 0 6 8 14 8 26Z"/></g>
<g class="cloud cloud--c"><ellipse cx="150" cy="306" rx="190" ry="34"/><ellipse cx="40" cy="290" rx="70" ry="26"/><ellipse cx="270" cy="292" rx="70" ry="24"/></g>
<use href="#i-sprig" x="-62" y="272" width="230" height="136"/>
<use href="#i-sprig" x="-62" y="280" width="230" height="136" transform="scale(-1 1) translate(-300 0)"/>
<use href="#i-rose" x="112" y="318" width="76" height="76"/>
</svg>`;
}

/** Arches and a dome in gold line work, used when no venue photo has been added. */
const VENUE_SCENE = `<svg class="scene scene--venue" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Illustration of an arched hall">
<rect width="400" height="260" class="venue-bg"/>
<g class="venue-lines">
<path d="M150 104c0-30 22-48 50-62 28 14 50 32 50 62"/><path d="M200 42V31"/><path d="M203.5 17.5a6.5 6.5 0 1 0 0 12 5 5 0 1 1 0-12Z"/><path d="M140 104h120v18H140Z"/>
<path d="M40 232V140h320v92"/><path d="M30 140h340M30 232h340"/>
<path d="M62 232v-50a22 22 0 0 1 44 0v50M126 232v-50a22 22 0 0 1 44 0v50M230 232v-50a22 22 0 0 1 44 0v50M294 232v-50a22 22 0 0 1 44 0v50"/>
<path d="M178 232v-60a22 26 0 0 1 44 0v60"/>
<path d="M30 122h24v110H30ZM346 122h24v110h-24Z"/><path d="M30 122c0-12 12-24 12-34 0 10 12 22 12 34M346 122c0-12 12-24 12-34 0 10 12 22 12 34"/>
</g>
<g class="stars"><circle cx="70" cy="40" r="1.4"/><circle cx="320" cy="56" r="1.2"/><circle cx="110" cy="84" r="1"/><circle cx="290" cy="100" r="1"/><circle cx="352" cy="30" r="1.3"/></g>
</svg>`;

/** A photo or drawing cut to the design's frame shape, with a fine gold outline. */
function frame(design: Design, content: string, className: string, attributes = ''): string {
  return `<figure class="frame ${className}"${attributes}><div class="frame__art">${content}</div><svg class="frame__line" viewBox="0 0 300 400" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="${FRAME_PATHS[design.frame]}"/></svg></figure>`;
}

function photo(url: string, alt: string, eager = false): string {
  return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}

function names(inv: Invitation, tag: 'h1' | 'h2' | 'p', extra = '', id = ''): string {
  const { groom, bride, joiner } = inv.couple;
  return `<${tag}${id ? ` id="${id}"` : ''} class="names ${extra}"><span class="names__one">${escapeHtml(groom)}</span>${
    joiner ? `<span class="names__joiner">${escapeHtml(joiner)}</span>` : '<span class="names__joiner">&amp;</span>'
  }<span class="names__two">${escapeHtml(bride)}</span></${tag}>`;
}

function cover(inv: Invitation, first: ResolvedEvent, design: Design): string {
  const { cover: c, couple } = inv;
  const art = c.image ? photo(c.image, `${couple.groom} and ${couple.bride}`, true) : gardenScene('cover', design.night);
  return `<header class="cover" id="cover">
<div class="cover__curtain cover__curtain--left" aria-hidden="true"></div><div class="cover__curtain cover__curtain--right" aria-hidden="true"></div>
<div class="cover__inner">
${c.bismillah ? `<p class="bismillah" lang="ar" dir="rtl">${escapeHtml(c.bismillah)}</p>` : ''}
${c.label ? `<p class="eyebrow">${escapeHtml(c.label)}</p>` : ''}
${frame(design, art, 'frame--cover')}
${names(inv, 'h1', 'names--cover')}
<p class="cover__date">${escapeHtml(c.dateText || longDate(first.date))}</p>
<a class="btn btn--navy btn--open" id="open" href="#invitation">${escapeHtml(c.button)}</a>
</div>
</header>`;
}

function intro(inv: Invitation, first: ResolvedEvent): string {
  const i = inv.intro;
  const background = i.image || inv.cover.image;
  return `<section class="section intro" id="welcome" aria-labelledby="welcome-title">
<div class="intro__bg" data-parallax>${background ? photo(background, '') : gardenScene('intro', true)}</div>
<div class="intro__shade" aria-hidden="true"></div>
<div class="intro__content">
${i.heading ? `<p class="eyebrow eyebrow--light" data-reveal>${escapeHtml(i.heading)}</p>` : ''}
${names(inv, 'h2', 'names--light', 'welcome-title')}
${divider('divider--light')}
${i.message ? `<p class="lead" data-reveal>${lines(i.message)}</p>` : ''}
<p class="when" data-reveal><span>${escapeHtml(weekday(first.date))}</span><span>${escapeHtml(cardDate(first.date))}</span><span>${escapeHtml(timeRange(first))}</span></p>
${first.note ? `<p class="when__note" data-reveal>${escapeHtml(first.note)}</p>` : ''}
${
  i.verseArabic || i.verseTranslation
    ? `<blockquote class="verse" data-reveal>${i.verseArabic ? `<p class="arabic" lang="ar" dir="rtl">${lines(i.verseArabic)}</p>` : ''}${
        i.verseTranslation ? `<p class="verse__text">${lines(i.verseTranslation)}</p>` : ''
      }${i.verseReference ? `<cite>${escapeHtml(i.verseReference)}</cite>` : ''}</blockquote>`
    : ''
}
</div>
</section>`;
}

function countdown(inv: Invitation, first: ResolvedEvent): string {
  const { countdown: c, labels } = inv;
  const unit = (key: string, label: string) =>
    `<div class="unit"><span class="unit__value" data-unit="${key}">--</span><span class="unit__label">${escapeHtml(label)}</span></div>`;
  return `<section class="section countdown" id="countdown" aria-labelledby="countdown-title">
${c.heading ? `<h2 class="title" id="countdown-title" data-reveal>${escapeHtml(c.heading)}</h2>` : '<h2 class="visually-hidden" id="countdown-title">Countdown</h2>'}
<p class="countdown__target" data-reveal><span>${escapeHtml(first.title)}</span>${escapeHtml(longDate(first.date))} · ${escapeHtml(timeRange(first))}</p>
<div class="countdown__grid" data-countdown data-reveal>${unit('days', labels.days)}${unit('hours', labels.hours)}${unit('minutes', labels.minutes)}${unit('seconds', labels.seconds)}</div>
<p class="countdown__message" data-countdown-message role="status" hidden></p>
</section>`;
}

function invitationCard(inv: Invitation): string {
  const w = inv.invitation;
  const corner = (position: string) => `<svg class="corner corner--${position}" aria-hidden="true" focusable="false"><use href="#i-sprig"/></svg>`;
  return `<section class="section card-section" id="invitation-card" aria-labelledby="card-title">
<div class="card" data-reveal>
${corner('top')}${corner('bottom')}
${w.heading ? `<h2 class="eyebrow card__heading" id="card-title">${escapeHtml(w.heading)}</h2>` : '<h2 class="visually-hidden" id="card-title">Invitation</h2>'}
${w.hosts ? `<p class="card__hosts">${escapeHtml(w.hosts)}</p>` : ''}
${w.hostsAddress ? `<p class="card__address">${lines(w.hostsAddress)}</p>` : ''}
${divider()}
${w.message ? `<p class="card__message">${lines(w.message)}</p>` : ''}
<p class="card__name">${escapeHtml(inv.couple.groom)}</p>
${w.groomDetails ? `<p class="card__details">${lines(w.groomDetails)}</p>` : ''}
<p class="card__joiner">${escapeHtml(inv.couple.joiner || '&')}</p>
<p class="card__name">${escapeHtml(inv.couple.bride)}</p>
${w.brideDetails ? `<p class="card__details">${lines(w.brideDetails)}</p>` : ''}
${inv.cover.bismillah ? `<p class="card__bismillah" lang="ar" dir="rtl">${escapeHtml(inv.cover.bismillah)}</p>` : ''}
</div>
</section>`;
}

function eventCard(inv: Invitation, event: ResolvedEvent): string {
  const { labels } = inv;
  return `<article class="event" data-reveal>
<h3 class="event__title">${escapeHtml(event.title)}</h3>
${divider('divider--small')}
<p class="event__day">On ${escapeHtml(weekday(event.date))}</p>
<p class="event__date">${escapeHtml(cardDate(event.date))}</p>
<p class="event__time">${escapeHtml(timeRange(event))}</p>
${event.note ? `<p class="event__note">(${escapeHtml(event.note)})</p>` : ''}
<p class="event__venue">${icon('pin')}<span>${escapeHtml(event.venueName)}</span></p>
<div class="event__actions">
<a class="btn btn--outline" href="${escapeHtml(event.maps)}" target="_blank" rel="noopener">${icon('pin')}${escapeHtml(labels.viewLocation)}</a>
<details class="calendar">
<summary class="btn btn--navy">${icon('calendar')}${escapeHtml(labels.addToCalendar)}</summary>
<div class="calendar__menu">
<a href="${escapeHtml(event.calendarUrl)}" target="_blank" rel="noopener">Google Calendar</a>
<a href="/calendar/${event.index}.ics" download="${escapeHtml(event.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'event')}.ics">Apple / Outlook</a>
</div>
</details>
</div>
</article>`;
}

function events(inv: Invitation, resolved: ResolvedEvent[]): string {
  return `<section class="section events" id="events" aria-labelledby="events-title">
${inv.labels.eventsHeading ? `<h2 class="title" id="events-title" data-reveal>${escapeHtml(inv.labels.eventsHeading)}</h2>` : '<h2 class="visually-hidden" id="events-title">Events</h2>'}
<div class="events__grid${resolved.length === 1 ? ' events__grid--single' : ''}">${resolved.map((event) => eventCard(inv, event)).join('')}</div>
</section>`;
}

function venue(inv: Invitation, maps: string, qrSvg: string | null): string {
  const v = inv.venue;
  return `<section class="section venue" id="venue" aria-labelledby="venue-title">
${v.heading ? `<h2 class="title title--light" id="venue-title" data-reveal>${escapeHtml(v.heading)}</h2>` : '<h2 class="visually-hidden" id="venue-title">Venue</h2>'}
<div class="venue__layout">
<figure class="venue__photo" data-reveal>${v.image ? photo(v.image, v.name) : VENUE_SCENE}</figure>
<div class="venue__details" data-reveal>
<p class="venue__name">${escapeHtml(v.name)}</p>
${v.address ? `<p class="venue__address">${lines(v.address)}</p>` : ''}
${v.directions ? `<p class="venue__directions">${lines(v.directions)}</p>` : ''}
<a class="btn btn--gold" href="${escapeHtml(maps)}" target="_blank" rel="noopener">${icon('pin')}${escapeHtml(inv.labels.directions)}</a>
${
  v.showQr && qrSvg
    ? `<figure class="qr"><a class="qr__code" href="${escapeHtml(maps)}" target="_blank" rel="noopener" aria-label="Open the location in Google Maps">${qrSvg}</a>${
        v.qrLabel ? `<figcaption>${escapeHtml(v.qrLabel)}</figcaption>` : ''
      }</figure>`
    : ''
}
</div>
</div>
</section>`;
}

function blessing(inv: Invitation): string {
  const b = inv.blessing;
  return `<section class="section blessing" id="blessing" aria-labelledby="blessing-title">
<svg class="blessing__sprig" aria-hidden="true" focusable="false"><use href="#i-sprig"/></svg>
${b.heading ? `<h2 class="title" id="blessing-title" data-reveal>${escapeHtml(b.heading)}</h2>` : '<h2 class="visually-hidden" id="blessing-title">Blessing</h2>'}
${b.arabic ? `<p class="arabic arabic--large" lang="ar" dir="rtl" data-reveal>${lines(b.arabic)}</p>` : ''}
${b.translation ? `<p class="blessing__text" data-reveal>${lines(b.translation)}</p>` : ''}
${b.reference ? `<cite class="blessing__ref" data-reveal>${escapeHtml(b.reference)}</cite>` : ''}
</section>`;
}

function wishes(inv: Invitation, available: boolean): string {
  const w = inv.wishes;
  const body = available
    ? `<form class="wish-form" data-wish-form novalidate data-reveal>
<label class="field"><span>Your name</span><input name="name" maxlength="60" autocomplete="name" required></label>
<label class="field"><span>Your message</span><textarea name="message" maxlength="500" rows="4" required></textarea><span class="field__count" data-count>0 / 500</span></label>
<div class="hp" aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></div>
<button class="btn btn--navy" type="submit">${icon('heart')}<span>${escapeHtml(inv.labels.sendWishes)}</span></button>
<p class="form-status" data-form-status role="status" aria-live="polite"></p>
</form>
<div class="wish-list" data-wish-list><p class="muted">Loading wishes…</p></div>`
    : '<p class="muted wishes__closed">Wishes will open here soon.</p>';
  return `<section class="section wishes" id="wishes" aria-labelledby="wishes-title">
${w.heading ? `<h2 class="title" id="wishes-title" data-reveal>${escapeHtml(w.heading)}</h2>` : '<h2 class="visually-hidden" id="wishes-title">Wishes</h2>'}
${w.intro ? `<p class="section__intro" data-reveal>${lines(w.intro)}</p>` : ''}
${body}
</section>`;
}

function closing(inv: Invitation, design: Design): string {
  const c = inv.closing;
  const image = c.image || inv.cover.image;
  const { groom, bride } = inv.couple;
  return `<section class="section closing" id="closing" aria-labelledby="closing-title">
${frame(design, image ? photo(image, `${groom} and ${bride}`) : gardenScene('closing', true), 'frame--closing', ' data-reveal')}
${c.message ? `<p class="closing__message" data-reveal>${lines(c.message)}</p>` : ''}
${c.signoff ? `<p class="closing__signoff" data-reveal>${escapeHtml(c.signoff)}</p>` : ''}
${names(inv, 'h2', 'names--closing', 'closing-title')}
<div class="bloom" aria-hidden="true" data-reveal><svg><use href="#i-rose"/></svg><svg><use href="#i-rose"/></svg><svg><use href="#i-rose"/></svg></div>
<button class="btn btn--outline" type="button" data-share>${icon('share')}${escapeHtml(inv.labels.share)}</button>
</section>`;
}

/** The whole invitation page. Everything shown comes from the invitation settings. */
export function renderInvitation(inv: Invitation, options: PageOptions): string {
  const { baseUrl, version } = options;
  const resolved = resolveEvents(inv);
  const first = resolved[0];
  const last = resolved.reduce((latest, event) => (event.endsAt > latest.endsAt ? event : latest), first);
  const maps = resolved.find((event) => !event.venue)?.maps ?? resolved[0].maps;
  const shareImage = absolute(inv.site.shareImage || inv.cover.image || '/assets/share.jpg', baseUrl);
  const s = inv.sections;
  const t = inv.theme;
  const design = designById(t.design);
  const asset = (file: string) => `/${file}?v=${encodeURIComponent(version)}`;

  const data = {
    countdown: {
      start: first.startsAt.toISOString(),
      end: last.endsAt.toISOString(),
      started: inv.countdown.startedMessage,
      ended: inv.countdown.endedMessage,
    },
    wishes: { available: options.wishesAvailable && s.wishes, likes: inv.wishes.likes },
    music: { url: inv.music.url, title: inv.music.title },
    share: { title: inv.site.title, text: inv.site.description },
  };

  return `<!doctype html>
<html lang="en" class="no-js" data-design="${design.id}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(inv.site.title)}</title>
<meta name="description" content="${escapeHtml(inv.site.description)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(inv.site.title)}">
<meta property="og:description" content="${escapeHtml(inv.site.description)}">
<meta property="og:image" content="${escapeHtml(shareImage)}">
<meta property="og:url" content="${escapeHtml(baseUrl)}/">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="${t.navy}">
<link rel="icon" href="${asset('assets/favicon.svg')}" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${escapeHtml(fontsUrl(design))}">
<link rel="stylesheet" href="${asset('styles.css')}">
<style>:root{--navy:${t.navy};--ivory:${t.ivory};--mist:${t.mist};--gold:${t.gold};--frame:${frameMask(design)}}</style>
<script>document.documentElement.className='js'</script>
</head>
<body>
${SPRITE}
<div class="petals" aria-hidden="true"></div>
${cover(inv, first, design)}
<main id="invitation" tabindex="-1">
${s.intro ? intro(inv, first) : ''}
${s.countdown ? countdown(inv, first) : ''}
${s.invitation ? invitationCard(inv) : ''}
${s.events ? events(inv, resolved) : ''}
${s.venue ? venue(inv, maps, options.qrSvg) : ''}
${s.blessing ? blessing(inv) : ''}
${s.wishes ? wishes(inv, options.wishesAvailable) : ''}
${s.closing ? closing(inv, design) : ''}
</main>
${inv.closing.footer ? `<footer class="footer"><p>${escapeHtml(inv.closing.footer)}</p></footer>` : ''}
${
  inv.music.url
    ? `<button class="music" type="button" data-music hidden aria-pressed="false">${icon('music')}<span class="visually-hidden" data-music-label>Play music${
        inv.music.title ? `: ${escapeHtml(inv.music.title)}` : ''
      }</span><span class="music__bars" aria-hidden="true"><i></i><i></i><i></i></span></button>
<audio data-audio src="${escapeHtml(inv.music.url)}" preload="none" loop></audio>`
    : ''
}
<script type="application/json" id="invite-data">${scriptJson(data)}</script>
<script src="${asset('invite.js')}" defer></script>
</body>
</html>
`;
}

