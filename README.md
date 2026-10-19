# Wedding Invitation

A digital wedding invitation for **Sahal & Sahadiya**, made for guests who open it from WhatsApp on their phones.

- Opening screen with Bismillah, the couple's photo in an arch, falling petals and an **Open Invitation** button
- Welcome with a Quran verse, a live countdown to the Nikkah, the invitation wording from the printed card
- Event cards (Nikkah and Reception) with **View Location** and **Add to Calendar** (Google Calendar, or an `.ics` file for iPhone and Outlook)
- Venue with **Get Directions** and a QR code for the location
- A dua for the couple, guest **wishes** that are saved for everyone to see (with likes and optional approval), and a closing message with a share button
- Background music after the guest opens the invitation, with a pause button

## The editor

Open `/admin`. Everything on the invitation can be changed there:

- **Five designs**: Royal Navy, Emerald Mihrab, Rose Blush, Midnight Gold, Pearl Minimal. Picking one loads its colours, which you can then adjust.
- **Live preview** (phone or desktop size) that shows your changes before you save them.
- **My templates**: save the whole invitation (design, wording, photos, song) under a name, load it back later, save over it or delete it. Up to five.
- All wording, events (up to four), venue and map link, photos (couple, background, venue, closing, link preview), the song, button labels, which sections show, and the time zone.
- **Guest wishes**: approve, hide or delete.

Nothing changes for guests until you press **Save changes**. They see it within a minute.

## Run it locally

```bash
npm install
```

```bash
npm start
```

The invitation is at http://localhost:3001 and the editor at http://localhost:3001/admin (no password on your own computer). Local edits, wishes and uploads are kept in `.data/`, which is never committed.

```bash
npm test
```

## Put it online with Vercel

1. In Vercel, **Add New → Project**, import the `Wedding_Invitation` GitHub repository, and deploy. No build settings are needed; `vercel.json` handles it.
2. **Storage → Create → Blob**, with **Public** access, and connect it to this project. Edits, wishes, templates, photos and music are stored there.
3. **Settings → Environment Variables**: add `ADMIN_PASSWORD` (at least 12 characters). This is the editor password.
4. **Deployments → Redeploy** so the store and password take effect.

Then share the project's address (for example `https://wedding-invitation.vercel.app`) on WhatsApp. Until a Blob store is connected the invitation still works, showing `content/invitation.json`, but wishes and saving are switched off. Without `ADMIN_PASSWORD` the editor stays closed.

## Changing the defaults in code

`content/invitation.json` is the starting invitation. Edit it and redeploy if you prefer a file to the editor. Once something has been saved in the editor, the saved version is shown instead.
