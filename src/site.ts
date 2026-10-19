import { mediaUrls, type Invitation } from './config.js';
import { createInvitationStore } from './invitationStore.js';
import type { Storage } from './storage.js';
import { createTemplateStore, type TemplateStore } from './templates.js';
import { createWishStore } from './wishes.js';

/**
 * The stores behind the site, wired so that uploads still used by the live
 * invitation or by a saved template are never removed.
 */
export function createSite(storage: Storage | null, defaults: Invitation) {
  let templates: TemplateStore | null = null;
  const invitations = createInvitationStore(storage, defaults, {
    keepMedia: async () => (templates ? templates.mediaUrls() : []),
  });
  if (storage) {
    templates = createTemplateStore(storage, defaults, {
      liveMedia: async () => mediaUrls(await invitations.load()),
    });
  }
  return { invitations, templates, wishes: storage ? createWishStore(storage) : null };
}
