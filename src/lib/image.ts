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
 * Resize to <=1024px longest edge, compress to JPEG, persist a permanent
 * copy under documents/outfits/, and return base64 for scoring.
 */
export async function preparePhoto(uri: string): Promise<PreparedPhoto> {
  if (Platform.OS === 'web') {
    // No File API on web — keep the in-memory URI and decode when needed.
    const base64 = uri.startsWith('data:') ? dataUriToBase64(uri) : await blobUriToBase64(uri);
    return { displayUri: uri, base64 };
  }

  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: MAX_EDGE, height: null });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });

  const dir = new Directory(Paths.document, 'outfits');
  if (!dir.exists) dir.create({ intermediates: true });

  const dest = new File(dir, `${Date.now()}.jpg`);
  if (dest.exists) dest.delete();
  await new File(saved.uri).copy(dest);

  return { displayUri: dest.uri, base64: await dest.base64() };
}
