import type { Occasion } from './occasion';
import { authHeaders, getProxyToken, getProxyUrl } from './settings';
import { fetchWithTimeout, isTimeoutError } from './timeout';

export interface SubScores {
  fit_silhouette: number;
  color_harmony: number;
  occasion_appropriateness: number;
  style_coherence: number;
  styling_details: number;
}

export interface ScoreResult {
  score: number;
  subscores: SubScores;
  strengths: string[];
  improvements: string[];
  summary: string;
  /** Which model produced the score — matters when a fallback answered. */
  model?: string;
  /** True when a fallback model answered; its scale can differ from the primary's. */
  fallback?: boolean;
}

export type ScoringErrorKind = 'network' | 'server' | 'response';

export class ScoringError extends Error {
  constructor(
    message: string,
    readonly kind: ScoringErrorKind,
  ) {
    super(message);
    this.name = 'ScoringError';
  }
}

function assertResult(data: unknown): ScoreResult {
  if (typeof data !== 'object' || data === null) {
    throw new ScoringError('Server returned an unexpected response.', 'response');
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.score !== 'number' || typeof obj.subscores !== 'object' || obj.subscores === null) {
    throw new ScoringError('Server returned an unexpected response.', 'response');
  }
  return {
    score: obj.score,
    subscores: obj.subscores as SubScores,
    strengths: Array.isArray(obj.strengths) ? (obj.strengths as string[]) : [],
    improvements: Array.isArray(obj.improvements) ? (obj.improvements as string[]) : [],
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    model: typeof obj.model === 'string' ? obj.model : undefined,
    fallback: obj.fallback === true,
  };
}

/** POST the photo to the proxy and return the validated score for that occasion. */
export async function requestScore(imageBase64: string, occasion: Occasion): Promise<ScoreResult> {
  const [base, token] = await Promise.all([getProxyUrl(), getProxyToken()]);

  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${base}/score`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({ image: imageBase64, mimeType: 'image/jpeg', occasion }),
      },
      90_000,
    );
  } catch (err) {
    throw new ScoringError(
      isTimeoutError(err)
        ? 'The scoring server took too long to answer.'
        : `Can't reach the scoring server at ${base}.`,
      'network',
    );
  }

  if (!response.ok) {
    let detail = `The scoring server answered with an error (${response.status}).`;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string' && body.error.trim()) detail = body.error;
    } catch {
      // keep default message
    }
    throw new ScoringError(detail, 'server');
  }

  return assertResult(await response.json());
}
