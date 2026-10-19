# CLAUDE.md — Wedding_Invitation

Project config. Overrides `Engineering/CLAUDE.md` where they conflict.

Written by hand: `Engineering/PROJECT_CLAUDE_TEMPLATE.md` did not exist at kickoff. Regenerate from the template once it does.

## What it is

A digital Muslim wedding invitation (Sahal & Sahadiya, Nikkah and Reception on 3 January 2027) that guests open from a WhatsApp link, with a countdown, venue directions, calendar files and guest wishes. An editor at `/admin` changes every text, photo, the song, the colours and the design, previews changes before saving, and keeps up to five saved templates.

## Stack

- Node.js 22, TypeScript (ESM, run with `tsx`, no build step), same setup as Email_Sender
- Express 5 server; plain HTML/CSS/JS in `public/` (no framework, no bundler)
- Vercel Blob for edits, wishes, templates and uploads online; a local folder (`.data/`) otherwise
- `qrcode` for the venue QR code; Vitest with v8 coverage

## Commands

- `npm start` — run on http://localhost:3001 (editor at /admin, no password locally)
- `npm test` — tests with coverage, fails under 80% lines
- `npm run typecheck` — `tsc --noEmit`

## Layout

- `content/invitation.json` — the committed invitation. Seeds the site until the first save in the editor
- `src/config.ts` — the `Invitation` type and `SCHEMA`, which builds the editor form and validates every save
- `src/designs.ts` — the five designs (fonts, frame shape, colours); their looks are under `[data-design]` in `public/styles.css`
- `src/render.ts` — invitation HTML. All couple-entered text is escaped here
- `src/events.ts` — dates, times, Google Maps and calendar links, `.ics` files
- `src/app.ts` — routes, access guards, error mapping
- `src/site.ts` — wires the invitation, template and wish stores together
- `src/storage.ts` / `src/blobStorage.ts` — disk and Vercel Blob storage with conflict-checked writes
- `src/wishes.ts`, `src/templates.ts`, `src/invitationStore.ts`, `src/uploads.ts`, `src/login.ts`
- `src/server.ts` local wiring (excluded from coverage), `src/hosted.ts` Vercel wiring, `api/index.ts` exports it
- `public/` — `invite.js` (guest page), `admin.*` (editor), `styles.css`, `assets/` (favicon, link preview image)

## Decisions

- **Same stack and Vercel setup as Email_Sender**, so the owner deploys it the same way. The legacy `builds` config in `vercel.json` routes everything to `api/index.ts`.
- **Rendered on the server**, so WhatsApp link previews see the names, date and image. The editor preview posts unsaved changes to `/api/admin/preview`, which uses the same `renderInvitation`, so preview and page cannot differ.
- **Templates are data, not HTML.** Designs only change fonts, frame shape, colours and a few section styles. A new design needs an entry in `DESIGNS`, a frame in `FRAME_PATHS` if new, and its rules under `[data-design='id']`.
- **At most 5 saved templates** (`TEMPLATE_LIMIT`), mirroring Email_Sender. Saving under an existing name replaces it. A template is a whole invitation (design, wording, photos, song).
- **Uploads are removed only when nothing uses them**: not the live invitation and not any saved template.
- **Wishes are one document with ETag-checked writes** (`updateDoc`), so two guests posting at once cannot overwrite each other. No IP addresses are stored. Spam checks: hidden honeypot field, minimum time on page, link limit, duplicate check, per-instance rate limit, optional approval before showing. Without storage the page says wishes are not open; it never fakes a success.
- **Uploads go in 3.5 MB parts** to stay under Vercel's 4.5 MB request limit, and are joined on the server. File type is read from the first bytes, never from the name. Photos are resized in the browser to 2000 px.
- **Documents live in a randomly named Blob folder** (the store is public because photos and the song must load on guests' phones).
- **Music starts only after the guest taps Open Invitation**, with a pause button, and pauses when the page is hidden.
- **Two access modes.** Locally the server binds to `127.0.0.1` and rejects foreign `Host`/`Origin`. Online the invitation is public, other sites' requests are refused, and the editor needs `ADMIN_PASSWORD` (12+ characters). Without it the editor answers only with a setup message.
- **Reduced motion is respected**: no petals, parallax or entrance effects.

## Rules

- `ADMIN_PASSWORD` lives only in Vercel environment variables. Never commit it, log it, or return it.
- Nothing under `.data/` leaves the machine.
- Tests use the in-memory storage in `test/memoryStorage.ts` and a fake Blob client; they never touch a real store.
- Coverage floor: 80% lines.

## Open items

- `hooks-templates/` and `ci-templates/` do not exist at the Engineering root yet, so no hooks or CI are applied.
- The venue address and map link are a best guess from the hall's name. Paste the real Google Maps link in the editor (Venue, Google Maps link).
- `public/assets/share.jpg` has the names baked in. If the names change, upload a new preview image in the editor.
