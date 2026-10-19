import { createHostedApp } from '../src/hosted.js';

// Vercel runs this file as one function that serves the whole site.
export default createHostedApp(process.env, process.cwd());
