import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton, TopBar } from '@/components/ui';
import { getProxyUrl, setProxyUrl, testConnection } from '@/lib/settings';
import { colors, radius, spacing, type } from '@/theme';

type Status =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; model: string }
  | { kind: 'err'; message: string };

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    void (async () => setUrl(await getProxyUrl()))();
  }, []);

  async function saveAndTest() {
    setStatus({ kind: 'testing' });
    await setProxyUrl(url);
    const result = await testConnection(url);
    setStatus(
      result.ok ? { kind: 'ok', model: result.model } : { kind: 'err', message: result.error },
    );
  }

  return (
    <View style={styles.fill}>
      <TopBar showBack />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxxl }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Scoring server</Text>
          <Text style={styles.help}>
            Your own small proxy that holds the API key and talks to Gemini. The key never
            ships in the app.
          </Text>
          <TextInput
            value={url}
            onChangeText={(next) => {
              setUrl(next);
              setStatus({ kind: 'idle' });
            }}
            placeholder="http://192.168.1.10:8787"
            placeholderTextColor={colors.inkMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            inputMode="url"
            style={styles.input}
          />
          <PrimaryButton
            label="Save & test"
            onPress={() => void saveAndTest()}
            loading={status.kind === 'testing'}
          />
          {status.kind === 'ok' ? (
            <Text style={styles.statusOk}>Connected · model {status.model}</Text>
          ) : null}
          {status.kind === 'err' ? (
            <Text style={styles.statusErr}>{status.message}</Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Running on your phone</Text>
          <Text style={styles.help}>
            The phone must reach the computer running the proxy. Start it there with{' '}
            <Text style={styles.mono}>npm run proxy</Text>, then use your computer’s LAN
            address (find it with <Text style={styles.mono}>ipconfig</Text>) — for example{' '}
            <Text style={styles.mono}>http://192.168.1.10:8787</Text>.
          </Text>
          <Text style={styles.help}>
            Simulators can use the defaults:{' '}
            <Text style={styles.mono}>http://localhost:8787</Text> (iOS) or{' '}
            <Text style={styles.mono}>http://10.0.2.2:8787</Text> (Android emulator).
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeading}>About</Text>
          <Text style={styles.help}>
            StyleUp scores one outfit at a time, on demand. Scores and photos stay on this
            device — the photo is sent only to your proxy, for scoring.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },

  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  title: { ...type.screenTitle, color: colors.ink },

  section: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    gap: spacing.md,
  },
  sectionHeading: { ...type.label, fontWeight: '600', color: colors.ink },
  help: { ...type.body, color: colors.inkMuted },
  mono: { color: colors.ink, fontWeight: '600' },

  input: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    color: colors.ink,
    fontSize: 16,
  },
  statusOk: { ...type.label, color: colors.good },
  statusErr: { ...type.label, color: colors.bad },
});
