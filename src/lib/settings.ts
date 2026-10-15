import Storage from 'expo-sqlite/kv-store';

import { fetchWithTimeout, isTimeoutError } from './timeout';

const PROXY_URL_KEY = 'settings.proxyUrl';

/** Local dev default: simulator/emulator reach the host differently. */
export const DEFAULT_PROXY_URL = 'http://localhost:8787';

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export async function getProxyUrl(): Promise<string> {
  try {
    const stored = await Storage.getItem(PROXY_URL_KEY);
    if (stored && normalize(stored)) return normalize(stored);
  } catch {
    // fall through to default
  }
  return DEFAULT_PROXY_URL;
}

export async function setProxyUrl(url: string): Promise<void> {
  await Storage.setItem(PROXY_URL_KEY, normalize(url));
}

export async function testConnection(
  url: string,
): Promise<{ ok: true; model: string } | { ok: false; error: string }> {
  try {
    const res = await fetchWithTimeout(`${normalize(url)}/health`, { method: 'GET' }, 8_000);
    if (!res.ok) return { ok: false, error: `Server answered ${res.status}.` };
    const body = (await res.json()) as { ok?: boolean; model?: string };
    if (!body.ok) return { ok: false, error: 'Server is reachable but not healthy.' };
    return { ok: true, model: body.model ?? 'unknown model' };
  } catch (err) {
    return { ok: false, error: isTimeoutError(err) ? 'Timed out.' : 'Connection failed.' };
  }
}
