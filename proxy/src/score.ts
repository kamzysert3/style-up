import { RUBRIC_PROMPT } from './rubric';

/**
 * Primary model, then fallbacks. Newest Flash models are the best stylists but
 * also the most contested; when one is saturated (503) or stalls, stepping down
 * keeps scoring usable. Override with GEMINI_MODEL / GEMINI_FALLBACK_MODELS.
 */
const PRIMARY_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.8-flash';
const FALLBACK_MODELS = (
  process.env.GEMINI_FALLBACK_MODELS ??
  'gemini-3.7-flash,gemini-3.5-flash,gemini-3.1-flash-lite'
)
  .split(',')
  .map((m: string) => m.trim())
  .filter((m: string) => m.length > 0);

const ATTEMPT_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS ?? 20_000);
/** Start the next model this early if the current one hasn't answered. */
const HEDGE_DELAY_MS = Number(process.env.GEMINI_HEDGE_MS ?? 4_000);

export interface ScoreResult {
  score: number;
  subscores: {
    fit_silhouette: number;
    color_harmony: number;
    occasion_appropriateness: number;
    style_coherence: number;
    styling_details: number;
  };
  strengths: string[];
  improvements: string[];
  summary: string;
  /** Which model actually produced this score. */
  model: string;
}

const SUBSCORE_KEYS = [
  'fit_silhouette',
  'color_harmony',
  'occasion_appropriateness',
  'style_coherence',
  'styling_details',
] as const;

function clampInt(value: unknown, fallback = 50): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v)).filter((s) => s.trim().length > 0);
}

/** Defensive normalization — never trust the model to return exactly what we asked. */
export function normalizeScore(raw: unknown): Omit<ScoreResult, 'model'> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Score payload is not an object');
  }
  const obj = raw as Record<string, unknown>;
  const rawSubs =
    typeof obj.subscores === 'object' && obj.subscores !== null
      ? (obj.subscores as Record<string, unknown>)
      : {};

  const subscores = {} as ScoreResult['subscores'];
  for (const key of SUBSCORE_KEYS) {
    subscores[key] = clampInt(rawSubs[key]);
  }

  const strengths = toStringArray(obj.strengths).slice(0, 3);
  const improvements = toStringArray(obj.improvements).slice(0, 3);
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';

  if (strengths.length === 0 && improvements.length === 0 && !summary) {
    throw new Error('Score payload has no usable content');
  }

  return {
    score: clampInt(obj.score),
    subscores,
    strengths,
    improvements,
    summary,
  };
}

/** The model *should* emit pure JSON, but sometimes wraps it in fences or prose. */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // fall through
    }
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error('No JSON object found in model response');
}

class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

async function callModel(
  model: string,
  imageBase64: string,
  mimeType: string,
  controller: AbortController,
): Promise<Omit<ScoreResult, 'model'>> {
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY ?? '',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: RUBRIC_PROMPT },
                { inline_data: { mime_type: mimeType, data: imageBase64 } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
          },
        }),
        signal: controller.signal,
      },
    );
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new GeminiError(
      aborted ? `timed out after ${ATTEMPT_TIMEOUT_MS}ms` : String(err),
      null,
      true, // timeouts and socket errors are worth another model
    );
  }

  if (!response.ok) {
    const body = await response.text();
    // 5xx/429 are load problems (try elsewhere); 4xx are our own bad request.
    const retryable = response.status === 429 || response.status >= 500;
    throw new GeminiError(
      `${model} → ${response.status}: ${body.slice(0, 200)}`,
      response.status,
      retryable,
    );
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    promptFeedback?: { blockReason?: string };
  };

  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) {
    const blocked = data.promptFeedback?.blockReason;
    // A blocked prompt is about the photo, not the model — don't try others.
    throw new GeminiError(blocked ? `photo rejected: ${blocked}` : 'empty response', null, false);
  }

  return normalizeScore(extractJson(text));
}

/**
 * Hedge across the model chain: launch the primary, and if it hasn't answered
 * within HEDGE_DELAY_MS (or fails outright) launch the next one alongside it.
 * First model to return a valid score wins; the rest are aborted.
 *
 * Serial fallback was measured at 34-43s on a saturated primary — a hedged race
 * lands in ~5s in the same conditions, at the cost of an occasional extra call.
 */
export async function scoreOutfit(imageBase64: string, mimeType: string): Promise<ScoreResult> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set (see .env.example)');
  }

  const models = [...new Set([PRIMARY_MODEL, ...FALLBACK_MODELS])];
  const startedAt = Date.now();

  return new Promise<ScoreResult>((resolve, reject) => {
    const inFlight: { controller: AbortController; timer: ReturnType<typeof setTimeout> }[] = [];
    const hedgeTimers: ReturnType<typeof setTimeout>[] = [];
    const launched = new Set<number>();
    const failures: string[] = [];
    let settled = false;

    const finish = (fn: () => void) => {
      settled = true;
      for (const timer of hedgeTimers) clearTimeout(timer);
      for (const { controller, timer } of inFlight) {
        clearTimeout(timer);
        controller.abort(); // don't pay for answers we no longer need
      }
      fn();
    };

    const launch = (index: number) => {
      if (settled || launched.has(index)) return;
      launched.add(index);
      const model = models[index];

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
      inFlight.push({ controller, timer });

      callModel(model, imageBase64, mimeType, controller)
        .then((result) => {
          if (settled) return;
          console.log(
            `[score] ${model} answered in ${Date.now() - startedAt}ms` +
              (model !== PRIMARY_MODEL ? ' (fallback)' : ''),
          );
          finish(() => resolve({ ...result, model }));
        })
        .catch((err: unknown) => {
          if (settled) return;
          const message = err instanceof Error ? err.message : String(err);
          failures.push(message);
          console.error(`[score] ${model} failed: ${message}`);

          // A rejected photo or a malformed request won't fare better elsewhere.
          if (err instanceof GeminiError && !err.retryable) {
            finish(() => reject(new Error(message)));
            return;
          }

          // All models tried and failed.
          if (launched.size === models.length && failures.length >= models.length) {
            finish(() =>
              reject(
                new Error(
                  `Gemini is overloaded right now — try again in a moment. (${message})`,
                ),
              ),
            );
            return;
          }

          // A failure is a useful signal: don't wait out the hedge timer.
          launchNext();
        });

      // Start the next model early if this one stalls.
      const nextIndex = index + 1;
      if (nextIndex < models.length) {
        hedgeTimers.push(setTimeout(() => launch(nextIndex), HEDGE_DELAY_MS));
      }
    };

    const launchNext = () => {
      for (let i = 0; i < models.length; i++) {
        if (!launched.has(i)) {
          launch(i);
          return;
        }
      }
    };

    launch(0);
  });
}
