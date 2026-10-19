import path from 'node:path';
import type express from 'express';
import { createApp } from './app.js';
import { blobStorage, findBlobCredentials } from './blobStorage.js';
import { loadDefaults } from './config.js';
import { createLoginGate } from './login.js';
import { createSite } from './site.js';

const MIN_PASSWORD_LENGTH = 12;

/**
 * The online (Vercel) version. The invitation itself is public. The editor
 * needs ADMIN_PASSWORD, and stays closed until one of 12 or more characters
 * is set. Edits, wishes and uploads need a Blob store connected to the
 * project (BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID); without one, the site
 * shows content/invitation.json and wishes stay closed.
 */
export function createHostedApp(env: Record<string, string | undefined>, root: string): express.Express {
  const defaults = loadDefaults(path.join(root, 'content', 'invitation.json'));
  const credentials = findBlobCredentials(env);
  const storage = credentials ? blobStorage(credentials) : null;
  const password = env.ADMIN_PASSWORD ?? '';

  let editorSetupMessage: string | undefined;
  if (!password) {
    editorSetupMessage =
      'The editor is not set up yet: add ADMIN_PASSWORD in the Vercel project under Settings, Environment Variables, then redeploy.';
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    editorSetupMessage = `ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters. Change it in Vercel, then redeploy.`;
  }

  return createApp({
    ...createSite(storage, defaults),
    storage,
    publicDir: path.join(root, 'public'),
    online: true,
    login: editorSetupMessage ? undefined : createLoginGate(password),
    editorSetupMessage,
    version: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || env.VERCEL_DEPLOYMENT_ID || String(Date.now()),
  });
}
