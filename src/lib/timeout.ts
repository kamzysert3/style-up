/**
 * `AbortSignal.timeout()` is not reliably available on Hermes — build the
 * timeout from an AbortController so it works on device and on Node.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** True when a fetch rejected because our timeout aborted it. */
export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
