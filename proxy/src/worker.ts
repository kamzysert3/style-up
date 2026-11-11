/**
 * Cloudflare Workers entry point. The same Hono app as the Node server
 * (server.ts); Workers just want it as the default export.
 * Run locally with `npx wrangler dev`, ship with `npx wrangler deploy`.
 */
import { app } from './app';

export default app;
