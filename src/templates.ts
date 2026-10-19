import { randomBytes } from 'node:crypto';
import { mediaUrls, normaliseInvitation, type Invitation } from './config.js';
import { updateDoc, type Storage } from './storage.js';

/** The couple asked for room to keep five versions of the invitation. */
export const TEMPLATE_LIMIT = 5;
const NAME_MAX = 40;
const DOC = 'templates';

export class TemplateError extends Error {}
export class TemplateNotFound extends Error {}

interface SavedTemplate {
  id: string;
  name: string;
  savedAt: string;
  invitation: Invitation;
}

/** What the editor lists: enough to recognise a template without loading it. */
export interface TemplateSummary {
  id: string;
  name: string;
  savedAt: string;
  design: string;
  colours: [string, string, string, string];
  couple: string;
}

export interface TemplateStore {
  list(): Promise<TemplateSummary[]>;
  get(id: string): Promise<Invitation>;
  /** Saves under `name`, replacing a template with the same name. */
  save(name: unknown, invitation: unknown): Promise<TemplateSummary>;
  remove(id: string): Promise<void>;
  /** Uploaded files the saved templates point at, so they are never cleaned up while in use. */
  mediaUrls(): Promise<string[]>;
}

function summary(template: SavedTemplate): TemplateSummary {
  const { theme, couple } = template.invitation;
  return {
    id: template.id,
    name: template.name,
    savedAt: template.savedAt,
    design: theme.design,
    colours: [theme.navy, theme.ivory, theme.mist, theme.gold],
    couple: `${couple.groom} & ${couple.bride}`,
  };
}

function checkName(value: unknown): string {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!name) throw new TemplateError('Give the template a name.');
  if ([...name].length > NAME_MAX) throw new TemplateError(`Template names must be ${NAME_MAX} characters or fewer.`);
  return name;
}

/**
 * Saved copies of the whole invitation (design, colours, wording, photos and
 * music), so the couple can keep versions and switch between them.
 */
export function createTemplateStore(
  storage: Storage,
  defaults: Invitation,
  options: { liveMedia: () => Promise<string[]>; now?: () => Date },
): TemplateStore {
  const now = options.now ?? (() => new Date());
  const parse = (text: string | undefined): SavedTemplate[] => {
    const stored = text ? (JSON.parse(text) as SavedTemplate[]) : [];
    // Templates saved by an older version gain any fields added since.
    return stored.map((template) => ({ ...template, invitation: normaliseInvitation(template.invitation, defaults) }));
  };
  const read = async () => parse((await storage.readDoc(DOC))?.text);

  /** Removes uploads that only the given templates used. */
  async function cleanUp(dropped: SavedTemplate[], remaining: SavedTemplate[]) {
    const kept = new Set([...(await options.liveMedia()), ...remaining.flatMap((template) => mediaUrls(template.invitation))]);
    const unused = [...new Set(dropped.flatMap((template) => mediaUrls(template.invitation)))].filter(
      (url) => !kept.has(url) && storage.owns(url),
    );
    if (unused.length) {
      await storage.removeFiles(unused).catch((error) => console.error('Could not remove old uploads:', error));
    }
  }

  return {
    async list() {
      return (await read())
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
        .map(summary);
    },

    async get(id) {
      const found = (await read()).find((template) => template.id === id);
      if (!found) throw new TemplateNotFound('That template no longer exists.');
      return found.invitation;
    },

    async save(rawName, rawInvitation) {
      const name = checkName(rawName);
      const invitation = normaliseInvitation(rawInvitation, defaults);
      const { saved, replaced, remaining } = await updateDoc(storage, DOC, (text) => {
        const templates = parse(text);
        const index = templates.findIndex((template) => template.name.toLowerCase() === name.toLowerCase());
        if (index < 0 && templates.length >= TEMPLATE_LIMIT) {
          throw new TemplateError(`You can keep up to ${TEMPLATE_LIMIT} templates. Delete one or save over an existing one.`);
        }
        const saved: SavedTemplate = {
          id: index < 0 ? randomBytes(9).toString('base64url') : templates[index].id,
          name,
          savedAt: now().toISOString(),
          invitation,
        };
        const replaced = index < 0 ? [] : templates.splice(index, 1, saved);
        if (index < 0) templates.push(saved);
        return { text: JSON.stringify(templates), result: { saved, replaced, remaining: templates } };
      });
      if (replaced.length) await cleanUp(replaced, remaining);
      return summary(saved);
    },

    async remove(id) {
      const { dropped, remaining } = await updateDoc(storage, DOC, (text) => {
        const templates = parse(text);
        const index = templates.findIndex((template) => template.id === id);
        if (index < 0) throw new TemplateNotFound('That template no longer exists.');
        const dropped = templates.splice(index, 1);
        return { text: JSON.stringify(templates), result: { dropped, remaining: templates } };
      });
      await cleanUp(dropped, remaining);
    },

    async mediaUrls() {
      return (await read()).flatMap((template) => mediaUrls(template.invitation));
    },
  };
}
