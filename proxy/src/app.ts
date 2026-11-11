import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { DEFAULT_OCCASION, OCCASIONS, isOccasion } from './rubric';
import { NoOutfitError, scoreOutfit } from './score';

export const app = new Hono();

app.use('/*', cors());

/**
 * Shared secret. When PROXY_TOKEN is set, /score only answers requests carrying
 * `Authorization: Bearer <token>`, so a reachable URL alone can't spend the
 * Gemini quota. Unset = open, which is only acceptable on a trusted LAN.
 */
function tokenState(header: string | undefined): 'open' | 'ok' | 'missing' | 'wrong' {
  const expected = process.env.PROXY_TOKEN ?? '';
  if (!expected) return 'open';
  const given = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? '';
  if (!given) return 'missing';
  return constantTimeEqual(given, expected) ? 'ok' : 'wrong';
}

/** Comparison time depends only on the supplied value's length, never on where it differs. */
function constantTimeEqual(given: string, expected: string): boolean {
  let diff = given.length ^ expected.length;
  for (let i = 0; i < given.length; i++) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i % expected.length);
  }
  return diff === 0;
}

app.get('/health', (c) =>
  c.json({
    ok: true,
    // Lets the app's "Save & test" say whether its token will be accepted.
    auth: tokenState(c.req.header('Authorization')),
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
  const auth = tokenState(c.req.header('Authorization'));
  if (auth === 'missing' || auth === 'wrong') {
    return c.json(
      {
        error:
          auth === 'missing'
            ? 'This scoring server needs an access token. Add it in Settings.'
            : 'The access token was rejected. Check it in Settings.',
      },
      401,
    );
  }

  let body: { image?: unknown; mimeType?: unknown; occasion?: unknown };
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

  // Absent = the default lens (older clients); present but unknown = a client bug.
  const occasion = body.occasion ?? DEFAULT_OCCASION;
  if (!isOccasion(occasion)) {
    return c.json(
      { error: `"occasion" must be one of: ${Object.keys(OCCASIONS).join(', ')}` },
      400,
    );
  }

  try {
    const result = await scoreOutfit(body.image, mimeType, occasion);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[score]', message);
    // 422: the request was fine but this photo can't be scored; retrying won't help.
    return c.json({ error: message }, err instanceof NoOutfitError ? 422 : 502);
  }
});
