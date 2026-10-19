import path from 'node:path';
import { createApp } from './app.js';
import { loadDefaults } from './config.js';
import { createSite } from './site.js';
import { diskStorage } from './storage.js';

// The project folder, wherever the server is started from.
const root = path.resolve(import.meta.dirname, '..');
const dataDir = path.join(root, '.data');
const port = Number(process.env.PORT) || 3001;
const storage = diskStorage(dataDir);

const app = createApp({
  ...createSite(storage, loadDefaults(path.join(root, 'content', 'invitation.json'))),
  storage,
  publicDir: path.join(root, 'public'),
  localFilesDir: path.join(dataDir, 'files'),
  online: false,
  version: String(Date.now()),
});

// Local only: the editor has no password here, so nothing outside this machine may reach it.
app.listen(port, '127.0.0.1', () => {
  console.log(`Invitation: http://localhost:${port}`);
  console.log(`Editor:     http://localhost:${port}/admin`);
});
