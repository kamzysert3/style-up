import type { SQLiteDatabase } from 'expo-sqlite';

import { deletePhoto, pruneOrphanPhotos, resolvePhotoUri } from './image';
import { DEFAULT_OCCASION, isOccasion, type Occasion } from './occasion';
import type { ScoreResult } from './scoring';

export interface OutfitRecord extends Omit<ScoreResult, 'model' | 'fallback'> {
  id: number;
  photoUri: string;
  createdAt: number;
  /** null for rows scored before the column existed. */
  model: string | null;
  /** The user's own 0-100 score for this outfit; null until they rate it. */
  userScore: number | null;
  /** The lens it was scored through. Rows from before the picker were all everyday. */
  occasion: Occasion;
  /** True when a fallback model produced the score. */
  fallback: boolean;
}

const DB_VERSION = 1;

export async function migrateDb(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current < DB_VERSION) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS outfits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        photo_uri TEXT NOT NULL,
        score INTEGER NOT NULL,
        subscores TEXT NOT NULL,
        strengths TEXT NOT NULL,
        improvements TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  // Added after v1 shipped: which model produced the score. Idempotent so it
  // applies to fresh installs and existing databases alike.
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(outfits)');
  if (!columns.some((c) => c.name === 'model')) {
    await db.execAsync('ALTER TABLE outfits ADD COLUMN model TEXT');
  }
  // Calibration: the user's own score, compared against the model's.
  if (!columns.some((c) => c.name === 'user_score')) {
    await db.execAsync('ALTER TABLE outfits ADD COLUMN user_score INTEGER');
  }
  if (!columns.some((c) => c.name === 'occasion')) {
    await db.execAsync('ALTER TABLE outfits ADD COLUMN occasion TEXT');
  }
  if (!columns.some((c) => c.name === 'is_fallback')) {
    await db.execAsync('ALTER TABLE outfits ADD COLUMN is_fallback INTEGER NOT NULL DEFAULT 0');
  }

  if (current < DB_VERSION) {
    await db.execAsync(`PRAGMA user_version = ${DB_VERSION}`);
  }

  // Startup is the one moment no unsaved photo is waiting in the preview, so
  // sweep once per launch even if the provider re-initializes (fast refresh).
  if (!prunedThisLaunch) {
    prunedThisLaunch = true;
    const photos = await db.getAllAsync<{ photo_uri: string }>('SELECT photo_uri FROM outfits');
    pruneOrphanPhotos(photos.map((p) => p.photo_uri));
  }
}

let prunedThisLaunch = false;

interface Row {
  id: number;
  photo_uri: string;
  score: number;
  subscores: string;
  strengths: string;
  improvements: string;
  summary: string;
  created_at: number;
  model: string | null;
  user_score: number | null;
  occasion: string | null;
  is_fallback: number;
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseJsonSubscores(raw: string): ScoreResult['subscores'] {
  const fallback: ScoreResult['subscores'] = {
    fit_silhouette: 50,
    color_harmony: 50,
    occasion_appropriateness: 50,
    style_coherence: 50,
    styling_details: 50,
  };
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? { ...fallback, ...parsed } : fallback;
  } catch {
    return fallback;
  }
}

function rowToRecord(row: Row): OutfitRecord {
  return {
    id: row.id,
    photoUri: resolvePhotoUri(row.photo_uri),
    score: row.score,
    subscores: parseJsonSubscores(row.subscores),
    strengths: parseJsonArray(row.strengths),
    improvements: parseJsonArray(row.improvements),
    summary: row.summary,
    createdAt: row.created_at,
    model: row.model ?? null,
    userScore: row.user_score ?? null,
    occasion: isOccasion(row.occasion) ? row.occasion : DEFAULT_OCCASION,
    fallback: row.is_fallback === 1,
  };
}

/** Save (or clear, with null) the user's own score for an outfit. */
export async function setUserScore(
  db: SQLiteDatabase,
  id: number,
  userScore: number | null,
): Promise<void> {
  const value = userScore === null ? null : Math.max(0, Math.min(100, Math.round(userScore)));
  await db.runAsync('UPDATE outfits SET user_score = ? WHERE id = ?', value, id);
}

export async function insertOutfit(
  db: SQLiteDatabase,
  photoUri: string,
  result: ScoreResult,
  occasion: Occasion,
): Promise<number> {
  const res = await db.runAsync(
    `INSERT INTO outfits (photo_uri, score, subscores, strengths, improvements, summary, created_at, model, occasion, is_fallback)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    photoUri,
    result.score,
    JSON.stringify(result.subscores),
    JSON.stringify(result.strengths),
    JSON.stringify(result.improvements),
    result.summary,
    Date.now(),
    result.model ?? null,
    occasion,
    result.fallback ? 1 : 0,
  );
  return res.lastInsertRowId;
}

export async function getOutfit(db: SQLiteDatabase, id: number): Promise<OutfitRecord | null> {
  const row = await db.getFirstAsync<Row>('SELECT * FROM outfits WHERE id = ?', id);
  return row ? rowToRecord(row) : null;
}

export async function listOutfits(db: SQLiteDatabase): Promise<OutfitRecord[]> {
  const rows = await db.getAllAsync<Row>('SELECT * FROM outfits ORDER BY created_at DESC');
  return rows.map(rowToRecord);
}

/** Remove the score and its photo file. */
export async function deleteOutfit(db: SQLiteDatabase, id: number): Promise<void> {
  const row = await db.getFirstAsync<{ photo_uri: string }>(
    'SELECT photo_uri FROM outfits WHERE id = ?',
    id,
  );
  await db.runAsync('DELETE FROM outfits WHERE id = ?', id);
  if (row) deletePhoto(row.photo_uri);
}
