import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAnalysis } from '@/features/analysis/analysis-context';
import { useEditor } from '@/features/editor/editor-context';
import { pickPhoto } from '@/features/editor/photo-io';
import { useTheme } from '@/hooks/use-theme';

const STEPS = [
  ['01', '写真を選ぶ'],
  ['02', 'AIがアイテムを検出'],
  ['03', '結果を確認・修正'],
  ['04', '編集して書き出し・共有'],
] as const;

export default function HomeScreen() {
  const router = useRouter();
  const theme = useTheme();
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
    <Screen>
      <View style={styles.hero}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          Outfit, credited.
        </ThemedText>
        <ThemedText type="display">コーデ写真を、{'\n'}1枚選ぶだけ。</ThemedText>
        <ThemedText themeColor="textSecondary">
          服・靴・バッグ・アクセサリーのブランド名や価格を添えた、投稿用の1枚に仕上げます。
        </ThemedText>
      </View>

      {error ? (
        <ThemedText type="small" accessibilityRole="alert" style={{ color: '#C0392B' }}>
          {error}
        </ThemedText>
      ) : null}

      <View style={styles.buttons}>
        <AppButton label={busy ? '読み込み中…' : '写真を選ぶ'} onPress={choose} disabled={busy} />
        {snapshot ? (
          <AppButton label="編集を続ける" variant="secondary" onPress={() => router.push('/editor')} />
        ) : null}
        <AppButton label="設定・プライバシー" variant="secondary" onPress={() => router.push('/settings')} />
      </View>

      <View style={styles.steps}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          How it works
        </ThemedText>
        {STEPS.map(([no, text]) => (
          <View key={no} style={[styles.step, { borderTopColor: theme.border }]}>
            <ThemedText type="eyebrow" themeColor="textSecondary" style={styles.stepNo}>
              {no}
            </ThemedText>
            <ThemedText type="small" style={styles.stepText}>
              {text}
            </ThemedText>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: Spacing.three, paddingTop: Spacing.three },
  buttons: { gap: Spacing.three },
  steps: { gap: Spacing.two },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
  },
  stepNo: { width: 28 },
  stepText: { flex: 1 },
});
