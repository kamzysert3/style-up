import { serve } from '@hono/node-server';
import { app } from './app';

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, () => {
  console.log(`StyleUp scoring proxy listening on http://localhost:${port}`);
  console.log(`Health check: http://localhost:${port}/health`);
  console.log(
    process.env.PROXY_TOKEN
      ? 'Access token required for /score (PROXY_TOKEN is set).'
      : 'No PROXY_TOKEN set: anyone who can reach this port can score. Fine on a trusted LAN only.',
  );
});
