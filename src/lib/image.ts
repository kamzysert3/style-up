import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

/** Longest edge sent to the model — well under Gemini limits, fast to upload. */
const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.7;

export interface PreparedPhoto {
  /** Permanent on-device URI kept for history. */
  displayUri: string;
  /** Base64 payload for the scoring proxy. */
  base64: string;
}

function dataUriToBase64(uri: string): string {
  const comma = uri.indexOf(',');
  return comma >= 0 ? uri.slice(comma + 1) : uri;
}

async function blobUriToBase64(uri: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(dataUriToBase64(result));
      else reject(new Error('Could not read image data.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image data.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Shrink to <=1024px on the longest edge, compress to JPEG, persist a permanent
 * copy under documents/outfits/, and return base64 for scoring.
 */
export async function preparePhoto(uri: string): Promise<PreparedPhoto> {
  if (Platform.OS === 'web') {
    // No File API on web — keep the in-memory URI and decode when needed.
    const base64 = uri.startsWith('data:') ? dataUriToBase64(uri) : await blobUriToBase64(uri);
    return { displayUri: uri, base64 };
  }

  // Render once to learn the real (orientation-applied) size, then shrink the
  // longest edge only — never the short one, and never upscale a small photo.
  let rendered = await ImageManipulator.manipulate(uri).renderAsync();
  if (Math.max(rendered.width, rendered.height) > MAX_EDGE) {
    const context = ImageManipulator.manipulate(rendered);
    context.resize(
      rendered.width >= rendered.height ? { width: MAX_EDGE } : { height: MAX_EDGE },
    );
    rendered = await context.renderAsync();
  }
  const saved = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });

  const dir = outfitsDir();
  if (!dir.exists) dir.create({ intermediates: true });

  const dest = new File(dir, `${Date.now()}.jpg`);
  if (dest.exists) dest.delete();
  const temp = new File(saved.uri);
  await temp.copy(dest);
  try {
    temp.delete(); // the manipulator's cache copy is no longer needed
  } catch {
    // the OS clears the cache directory on its own
  }

  return { displayUri: dest.uri, base64: await dest.base64() };
}

function outfitsDir(): Directory {
  return new Directory(Paths.document, 'outfits');
}

function baseName(uri: string): string {
  return uri.slice(uri.lastIndexOf('/') + 1);
}

/**
 * Where a stored photo lives right now. The app's documents path is not stable
 * (iOS changes it on every update or reinstall), so the saved absolute URI is
 * only trusted for its file name.
 */
export function resolvePhotoUri(storedUri: string): string {
  if (Platform.OS === 'web') return storedUri;
  return new File(outfitsDir(), baseName(storedUri)).uri;
}

/** Delete a persisted photo. Never throws: a leftover file must not block the UI. */
export function deletePhoto(storedUri: string): void {
  if (Platform.OS === 'web') return;
  try {
    const file = new File(outfitsDir(), baseName(storedUri));
    if (file.exists) file.delete();
  } catch {
    // swept up by pruneOrphanPhotos on the next launch
  }
}

/**
 * Delete photos no history row points at: shots that were abandoned when the
 * app was closed mid-preview, and leftovers from before deletes removed files.
 * Run only at startup, before any new photo can be waiting in the preview.
 */
export function pruneOrphanPhotos(referencedUris: string[]): void {
  if (Platform.OS === 'web') return;
  try {
    const dir = outfitsDir();
    if (!dir.exists) return;
    const keep = new Set(referencedUris.map(baseName));
    for (const entry of dir.list()) {
      if (entry instanceof File && !keep.has(entry.name)) entry.delete();
    }
  } catch {
    // best effort; try again next launch
  }
}
