import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';

import { PrimaryButton, SecondaryButton } from '@/components/ui';
import { insertOutfit } from '@/lib/db';
import { deletePhoto, preparePhoto, type PreparedPhoto } from '@/lib/image';
import { DEFAULT_OCCASION, OCCASIONS, type Occasion } from '@/lib/occasion';
import { requestScore, ScoringError } from '@/lib/scoring';
import { colors, radius, spacing, type } from '@/theme';

type Phase = 'camera' | 'preparing' | 'preview' | 'scoring' | 'error';

export default function CaptureScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const db = useSQLiteContext();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);

  const [phase, setPhase] = useState<Phase>('camera');
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [errorNeedsSettings, setErrorNeedsSettings] = useState(false);
  // Kept across retakes: several shots in a row are usually for the same occasion.
  const [occasion, setOccasion] = useState<Occasion>(DEFAULT_OCCASION);

  async function toPreview(uri: string) {
    setPhase('preparing');
    try {
      setPhoto(await preparePhoto(uri));
      setPhase('preview');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not prepare the photo.');
      setErrorNeedsSettings(false);
      setPhase('error');
    }
  }

  async function capture() {
    try {
      const picture = await cameraRef.current?.takePictureAsync({ quality: 0.9 });
      if (picture?.uri) await toPreview(picture.uri);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not take the photo.');
      setErrorNeedsSettings(false);
      setPhase('error');
    }
  }

  async function pickFromGallery() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.9,
      });
      const asset = result.assets?.[0];
      if (!result.canceled && asset) await toPreview(asset.uri);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not open the gallery.');
      setErrorNeedsSettings(false);
      setPhase('error');
    }
  }

  async function score() {
    if (!photo) return;
    setPhase('scoring');
    try {
      const result = await requestScore(photo.base64, occasion);
      const id = await insertOutfit(db, photo.displayUri, result, occasion);
      setPhoto(null);
      setPhase('camera');
      router.replace({ pathname: '/score', params: { id: String(id) } });
    } catch (err) {
      if (err instanceof ScoringError) {
        setErrorMsg(err.message);
        setErrorNeedsSettings(err.kind === 'network');
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Scoring failed.');
        setErrorNeedsSettings(false);
      }
      setPhase('error');
    }
  }

  function retake() {
    if (photo) deletePhoto(photo.displayUri); // never scored, so nothing else points at it
    setPhoto(null);
    setPhase('camera');
  }

  /* ---------- permission gate ---------- */
  if (!permission) {
    return <View style={styles.fill} />;
  }

  if (!permission.granted && phase !== 'error') {
    return (
      <View style={[styles.fill, styles.centered, { padding: spacing.xxl }]}>
        <Ionicons name="camera-outline" size={44} color={colors.inkMuted} />
        <Text style={styles.permissionTitle}>Camera access</Text>
        <Text style={styles.permissionBody}>
          StyleUp uses the camera to photograph your outfit. You can also score a photo you
          already have.
        </Text>
        <PrimaryButton
          label="Allow camera"
          onPress={() => void requestPermission()}
          style={{ alignSelf: 'stretch', marginTop: spacing.lg }}
        />
        <SecondaryButton
          label="Pick from gallery"
          onPress={() => void pickFromGallery()}
          style={{ alignSelf: 'stretch', marginTop: spacing.md }}
        />
      </View>
    );
  }

  /* ---------- preview / scoring / error ---------- */
  if (phase === 'preview' || phase === 'scoring' || (phase === 'error' && photo)) {
    const scoring = phase === 'scoring';
    return (
      <View style={styles.fill}>
        <View style={styles.previewImageWrap}>
          <Image source={{ uri: photo?.displayUri }} style={styles.previewImage} contentFit="contain" />
          {scoring ? (
            <View style={styles.previewScrim}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.previewScrimText}>Reading your outfit…</Text>
            </View>
          ) : null}
        </View>

        <View style={[styles.previewActions, { paddingBottom: insets.bottom + spacing.xl }]}>
          {phase === 'error' ? (
            <>
              <Text style={styles.errorText} accessibilityRole="alert">
                {errorMsg}
              </Text>
              <PrimaryButton
                label="Try again"
                onPress={() => setPhase('preview')}
                style={{ alignSelf: 'stretch' }}
              />
              <View style={styles.previewRow}>
                <SecondaryButton label="Retake" onPress={retake} style={{ flex: 1 }} />
                {errorNeedsSettings ? (
                  <SecondaryButton
                    label="Settings"
                    onPress={() => router.push('/settings')}
                    style={{ flex: 1 }}
                  />
                ) : null}
              </View>
            </>
          ) : (
            <>
              <View style={styles.occasionBlock}>
                <Text style={styles.occasionHeading}>Dressing for</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  accessibilityRole="radiogroup"
                  style={styles.occasionScroll}
                  contentContainerStyle={styles.occasionRow}
                >
                  {OCCASIONS.map(({ id, label }) => {
                    const selected = id === occasion;
                    return (
                      <Pressable
                        key={id}
                        accessibilityRole="radio"
                        accessibilityState={{ selected, disabled: scoring }}
                        disabled={scoring}
                        onPress={() => setOccasion(id)}
                        style={({ pressed }) => [
                          styles.chip,
                          selected && styles.chipSelected,
                          pressed && { opacity: 0.8 },
                          scoring && { opacity: 0.5 },
                        ]}
                      >
                        <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
              <PrimaryButton
                label="Score this outfit"
                onPress={() => void score()}
                loading={scoring}
                style={{ alignSelf: 'stretch' }}
              />
              <SecondaryButton
                label="Retake"
                onPress={retake}
                style={{ alignSelf: 'stretch', marginTop: spacing.md }}
              />
            </>
          )}
        </View>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={[styles.fill, styles.centered, { padding: spacing.xxl }]}>
        <Text style={styles.errorText} accessibilityRole="alert">
          {errorMsg}
        </Text>
        <PrimaryButton
          label="Back to camera"
          onPress={() => setPhase('camera')}
          style={{ alignSelf: 'stretch', marginTop: spacing.lg }}
        />
      </View>
    );
  }

  /* ---------- camera ---------- */
  return (
    <View style={styles.fill}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        onCameraReady={() => setCameraReady(true)}
      />

      {/* top overlay: wordmark + destinations */}
      <View style={[styles.cameraTop, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.wordmark}>StyleUp</Text>
        <View style={styles.cameraTopActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="History"
            hitSlop={8}
            onPress={() => router.push('/history')}
            style={({ pressed }) => [styles.roundButton, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="time-outline" size={22} color={colors.ink} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            hitSlop={8}
            onPress={() => router.push('/settings')}
            style={({ pressed }) => [styles.roundButton, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="settings-outline" size={22} color={colors.ink} />
          </Pressable>
        </View>
      </View>

      {phase === 'preparing' ? (
        <View style={styles.preparingPill}>
          <ActivityIndicator color={colors.ink} />
          <Text style={styles.preparingText}>Preparing photo…</Text>
        </View>
      ) : (
        <View style={styles.hintPill}>
          <Text style={styles.hintText}>Frame the whole outfit — head to toe</Text>
        </View>
      )}

      {/* bottom controls */}
      <View style={[styles.cameraControls, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pick from gallery"
          hitSlop={8}
          onPress={() => void pickFromGallery()}
          disabled={phase === 'preparing'}
          style={({ pressed }) => [styles.sideControl, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="images-outline" size={26} color={colors.ink} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          onPress={() => void capture()}
          disabled={phase === 'preparing' || !cameraReady}
          style={({ pressed }) => [
            styles.shutterRing,
            pressed && { opacity: 0.7 },
            (!cameraReady || phase === 'preparing') && { opacity: 0.4 },
          ]}
        >
          <View style={styles.shutterCore} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Flip camera"
          hitSlop={8}
          onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
          disabled={phase === 'preparing'}
          style={({ pressed }) => [styles.sideControl, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="camera-reverse-outline" size={26} color={colors.ink} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },

  permissionTitle: {
    ...type.title,
    color: colors.ink,
    marginTop: spacing.lg,
  },
  permissionBody: {
    ...type.body,
    color: colors.inkMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },

  cameraTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
  wordmark: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: colors.ink,
  },
  cameraTopActions: { flexDirection: 'row', gap: spacing.md },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },

  hintPill: {
    position: 'absolute',
    top: '18%',
    alignSelf: 'center',
    backgroundColor: colors.scrim,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    maxWidth: '85%',
  },
  hintText: {
    ...type.label,
    color: colors.ink,
    textAlign: 'center',
  },
  preparingPill: {
    position: 'absolute',
    top: '18%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.scrim,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  preparingText: { ...type.label, color: colors.ink },

  cameraControls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxxl,
    paddingTop: spacing.lg,
  },
  sideControl: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterCore: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.ink,
  },

  previewImageWrap: {
    flex: 1,
    backgroundColor: '#000',
    position: 'relative',
  },
  previewImage: { flex: 1 },
  previewScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  previewScrimText: { ...type.body, color: colors.ink },

  previewActions: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.bg,
  },
  previewRow: { flexDirection: 'row', gap: spacing.md },

  occasionBlock: { gap: spacing.sm },
  occasionHeading: {
    ...type.caption,
    color: colors.inkMuted,
  },
  // Bleed to the screen edges so chips scroll under the gutter instead of clipping at it.
  occasionScroll: { marginHorizontal: -spacing.xl },
  occasionRow: {
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.border,
  },
  chipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipLabel: {
    ...type.label,
    fontWeight: '600',
    color: colors.ink,
  },
  chipLabelSelected: { color: colors.accentInk },

  errorText: {
    ...type.body,
    color: colors.bad,
    textAlign: 'center',
  },
});
