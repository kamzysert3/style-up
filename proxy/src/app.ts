import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { scoreOutfit } from './score';

export const app = new Hono();

app.use('/*', cors());

app.get('/health', (c) =>
  c.json({
    ok: true,
    model: process.env.GEMINI_MODEL ?? 'gemini-3.8-flash',
    fallbacks: (
      process.env.GEMINI_FALLBACK_MODELS ??
      'gemini-3.7-flash,gemini-3.5-flash,gemini-3.1-flash-lite'
    )
      .split(',')
      .map((m: string) => m.trim())
      .filter((m: string) => m.length > 0),
    keyConfigured: Boolean(process.env.GEMINI_API_KEY),
  }),
);

app.post('/score', async (c) => {
  let body: { image?: unknown; mimeType?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Request body must be JSON' }, 400);
  }

  if (typeof body.image !== 'string' || body.image.length === 0) {
    return c.json({ error: '"image" (base64 string) is required' }, 400);
  }
  if (body.image.length > 20_000_000) {
    return c.json({ error: 'Image too large' }, 413);
  }
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : 'image/jpeg';

  try {
    const result = await scoreOutfit(body.image, mimeType);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[score]', message);
    return c.json({ error: message }, 502);
  }
});
