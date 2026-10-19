import path from 'node:path';
import { loadDefaults } from '../src/config.js';

/** The committed invitation, which the tests use as the base for every change. */
export const DEFAULTS = loadDefaults(path.join(process.cwd(), 'content', 'invitation.json'));
