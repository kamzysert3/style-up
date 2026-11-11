import { buildRubricPrompt, type Occasion } from './rubric';

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

/** 0 = the most repeatable score a model can give for the same photo. */
const TEMPERATURE = envNumber(process.env.GEMINI_TEMPERATURE, 0);
/**
 * Score each photo this many times and keep the median. 1 = a single call.
 * 3 smooths run-to-run noise at three times the quota.
 */
const SAMPLES = Math.max(1, Math.min(5, Math.round(envNumber(process.env.GEMINI_SAMPLES, 1))));

function envNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

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
  /** True when a fallback answered: its scale can differ from the primary's. */
  fallback: boolean;
}

type ModelScore = Omit<ScoreResult, 'model' | 'fallback'>;

/** The model answered, but not with a score we can use. Never papered over. */
export class MalformedScoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedScoreError';
  }
}

const SUBSCORE_KEYS = [
  'fit_silhouette',
  'color_harmony',
  'occasion_appropriateness',
  'style_coherence',
  'styling_details',
] as const;

/**
 * A score the model actually gave, or an error. A missing, non-numeric or
 * out-of-range value is rejected rather than replaced: an invented number would
 * be indistinguishable from a real one once it is on screen and in history.
 */
function requireScore(value: unknown, field: string): number {
  const isNumeric =
    typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
  const n = isNumeric ? Math.round(Number(value)) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new MalformedScoreError(`"${field}" is missing or not a 0-100 number`);
  }
  return n;
}

/** The photo has no outfit to judge. About the photo, not the model: never retried. */
export class NoOutfitError extends Error {
  constructor() {
    super(
      "Couldn't find an outfit in this photo. Retake it with the whole outfit in frame, head to toe.",
    );
    this.name = 'NoOutfitError';
  }
}

/** Gemini structured-output schema; property order makes the model reason before it scores. */
const SCORE_FIELD = { type: 'INTEGER', minimum: 0, maximum: 100 };
const TOP_LEVEL_KEYS = [
  'outfit_visible',
  'observations',
  'subscores',
  'strengths',
  'improvements',
  'summary',
  'score',
];
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    outfit_visible: { type: 'BOOLEAN' },
    observations: { type: 'STRING' },
    subscores: {
      type: 'OBJECT',
      properties: Object.fromEntries(SUBSCORE_KEYS.map((key) => [key, SCORE_FIELD])),
      required: [...SUBSCORE_KEYS],
      propertyOrdering: [...SUBSCORE_KEYS],
    },
    strengths: { type: 'ARRAY', items: { type: 'STRING' } },
    improvements: { type: 'ARRAY', items: { type: 'STRING' } },
    summary: { type: 'STRING' },
    score: SCORE_FIELD,
  },
  required: TOP_LEVEL_KEYS,
  propertyOrdering: TOP_LEVEL_KEYS,
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v)).filter((s) => s.trim().length > 0);
}

/** Defensive normalization — never trust the model to return exactly what we asked. */
export function normalizeScore(raw: unknown): ModelScore {
  if (typeof raw !== 'object' || raw === null) {
    throw new MalformedScoreError('Score payload is not an object');
  }
  const obj = raw as Record<string, unknown>;
  const rawSubs =
    typeof obj.subscores === 'object' && obj.subscores !== null
      ? (obj.subscores as Record<string, unknown>)
      : {};

  const subscores = {} as ScoreResult['subscores'];
  for (const key of SUBSCORE_KEYS) {
    subscores[key] = requireScore(rawSubs[key], `subscores.${key}`);
  }

  const strengths = toStringArray(obj.strengths).slice(0, 3);
  const improvements = toStringArray(obj.improvements).slice(0, 3);
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';

  if (strengths.length === 0 && improvements.length === 0 && !summary) {
    throw new MalformedScoreError('Score payload has no usable content');
  }

  return {
    score: requireScore(obj.score, 'score'),
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

/** One model, with a single retry if it answers with an unusable score. */
async function callModelStrict(
  model: string,
  prompt: string,
  imageBase64: string,
  mimeType: string,
  controller: AbortController,
): Promise<ModelScore> {
  try {
    return await callModel(model, prompt, imageBase64, mimeType, controller);
  } catch (err) {
    if (!(err instanceof MalformedScoreError) || controller.signal.aborted) throw err;
    console.error(`[score] ${model} gave an unusable score (${err.message}); retrying once`);
    return await callModel(model, prompt, imageBase64, mimeType, controller);
  }
}

async function callModel(
  model: string,
  prompt: string,
  imageBase64: string,
  mimeType: string,
  controller: AbortController,
): Promise<ModelScore> {
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
                { text: prompt },
                { inline_data: { mime_type: mimeType, data: imageBase64 } },
              ],
            },
          ],
          generationConfig: {
            temperature: TEMPERATURE,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
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

  let parsed: unknown;
  try {
    parsed = extractJson(text);
  } catch {
    throw new MalformedScoreError('response is not JSON');
  }
  // Checked before the numbers: a "0" for a photo of a sofa is not a score.
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as { outfit_visible?: unknown }).outfit_visible === false
  ) {
    throw new NoOutfitError();
  }
  return normalizeScore(parsed);
}

/**
 * Score one outfit for an occasion. With GEMINI_SAMPLES > 1 the photo is scored
 * several times and the median run is returned whole, so the feedback always
 * belongs to the number shown. Only runs from the same model are compared:
 * different models sit on different scales.
 */
export async function scoreOutfit(
  imageBase64: string,
  mimeType: string,
  occasion: Occasion,
): Promise<ScoreResult> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set (see .env.example)');
  }
  const prompt = buildRubricPrompt(occasion);
  if (SAMPLES === 1) return raceModels(prompt, imageBase64, mimeType);

  const settled = await Promise.allSettled(
    Array.from({ length: SAMPLES }, () => raceModels(prompt, imageBase64, mimeType)),
  );
  const results = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  if (results.length === 0) {
    throw (settled[0] as PromiseRejectedResult).reason;
  }

  // Keep the model that answered most often; on a tie, the primary over a fallback.
  const byModel = new Map<string, ScoreResult[]>();
  for (const result of results) {
    byModel.set(result.model, [...(byModel.get(result.model) ?? []), result]);
  }
  const group = [...byModel.values()].sort(
    (a, b) => b.length - a.length || Number(a[0].fallback) - Number(b[0].fallback),
  )[0];
  group.sort((a, b) => a.score - b.score);
  const median = group[Math.floor((group.length - 1) / 2)];
  console.log(
    `[score] median ${median.score} of [${group.map((r) => r.score).join(', ')}] from ${median.model}`,
  );
  return median;
}

/**
 * Hedge across the model chain: launch the primary, and if it hasn't answered
 * within HEDGE_DELAY_MS (or fails outright) launch the next one alongside it.
 * First model to return a valid score wins; the rest are aborted.
 *
 * Serial fallback was measured at 34-43s on a saturated primary — a hedged race
 * lands in ~5s in the same conditions, at the cost of an occasional extra call.
 */
function raceModels(prompt: string, imageBase64: string, mimeType: string): Promise<ScoreResult> {
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

      callModelStrict(model, prompt, imageBase64, mimeType, controller)
        .then((result) => {
          if (settled) return;
          console.log(
            `[score] ${model} answered in ${Date.now() - startedAt}ms` +
              (model !== PRIMARY_MODEL ? ' (fallback)' : ''),
          );
          finish(() => resolve({ ...result, model, fallback: model !== PRIMARY_MODEL }));
        })
        .catch((err: unknown) => {
          if (settled) return;
          const message = err instanceof Error ? err.message : String(err);
          failures.push(message);
          console.error(`[score] ${model} failed: ${message}`);

          // A rejected photo or a malformed request won't fare better elsewhere.
          if (err instanceof NoOutfitError) {
            finish(() => reject(err));
            return;
          }
          if (err instanceof GeminiError && !err.retryable) {
            finish(() => reject(new Error(message)));
            return;
          }

          // All models tried and failed.
          if (launched.size === models.length && failures.length >= models.length) {
            const reason =
              err instanceof MalformedScoreError
                ? "Couldn't get a usable score for this photo. Try again."
                : 'Gemini is overloaded right now — try again in a moment.';
            finish(() => reject(new Error(`${reason} (${message})`)));
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
