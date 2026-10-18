import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/icon-button';
import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useAnalysis } from '@/features/analysis/analysis-context';
import { useEditor } from '@/features/editor/editor-context';
import { pickPhoto } from '@/features/editor/photo-io';

// 仮の写真(公開前に自前の写真か AI 生成へ差し替える。このファイルを置き換えるだけで済む)。
const HOME_BG = require('../../assets/images/home-bg.jpg');

const INK = 'rgba(15,14,13,';
const TOP_FADE = [`${INK}.92)`, `${INK}.5)`, `${INK}0)`] as const;
const BOTTOM_FADE = [Colors.background, `${INK}.6)`, `${INK}0)`] as const;

const MAIN_SIZE = 56;

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { snapshot, dispatch } = useEditor();
  const { dispatch: analysisDispatch } = useAnalysis();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async () => {
    setBusy(true);
    setError(null);
    try {
      const photo = await pickPhoto();
      if (photo) {
        analysisDispatch({ type: 'reset' });
        dispatch({ type: 'loadPhoto', photo });
        router.push('/analyzing');
      }
    } catch {
      setError('写真を読み込めませんでした。別の写真でお試しください。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Image source={HOME_BG} style={StyleSheet.absoluteFill} contentFit="cover" accessible={false} />
      <View style={[StyleSheet.absoluteFill, styles.veil]} pointerEvents="none" />
      <LinearGradient
        pointerEvents="none"
        colors={TOP_FADE}
        locations={[0, 0.38, 0.7]}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        pointerEvents="none"
        colors={BOTTOM_FADE}
        locations={[0.04, 0.3, 0.55]}
        start={{ x: 0.5, y: 1 }}
        end={{ x: 0.5, y: 0 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.top, { paddingTop: insets.top + Spacing.two }]}>
        <Text style={styles.logo} accessibilityRole="header">
          Coordinate
        </Text>
        <View style={[styles.settings, { top: insets.top }]}>
          <IconButton
            icon="settings"
            accessibilityLabel="設定"
            tooltipPlacement="below"
            onPress={() => router.push('/settings')}
          />
        </View>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + Spacing.five }]}>
        {error ? (
          <ThemedText type="small" accessibilityRole="alert" style={styles.error}>
            {error}
          </ThemedText>
        ) : null}
        <View style={styles.actions}>
          <IconButton icon="plus" variant="main" size={MAIN_SIZE} accessibilityLabel="写真を選ぶ" onPress={choose} disabled={busy} />
          {snapshot ? (
            <View style={styles.resume}>
              <IconButton icon="edit" accessibilityLabel="編集を続ける" onPress={() => router.push('/editor')} />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  veil: { backgroundColor: `${INK}.30)` },
  top: { alignItems: 'center' },
  logo: {
    fontFamily: Fonts.latinItalic,
    fontSize: 30,
    letterSpacing: 7,
    color: '#E8DCC0',
    paddingVertical: Spacing.two,
  },
  settings: { position: 'absolute', right: Spacing.two },
  bottom: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', gap: Spacing.three },
  actions: { alignItems: 'center', justifyContent: 'center' },
  resume: { position: 'absolute', left: '50%', marginLeft: MAIN_SIZE / 2 + Spacing.three },
  error: { color: Colors.error, textAlign: 'center', paddingHorizontal: Spacing.four },
});
