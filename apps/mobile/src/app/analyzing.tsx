import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAnalysis } from '@/features/analysis/analysis-context';
import { useEditor } from '@/features/editor/editor-context';
import { AnalyzeError, analyzePhoto, ERROR_MESSAGES } from '@/lib/analyze-api';
import { useTheme } from '@/hooks/use-theme';

export default function AnalyzingScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { snapshot } = useEditor();
  const { state, dispatch } = useAnalysis();
  const started = useRef(false);
  const uri = snapshot?.photo.uri;

  const run = useCallback(async () => {
    if (!uri) return;
    dispatch({ type: 'start' });
    try {
      const response = await analyzePhoto(uri);
      dispatch({ type: 'succeeded', response });
      router.replace('/result');
    } catch (e) {
      dispatch({ type: 'failed', kind: e instanceof AnalyzeError ? e.kind : 'analysis_failed' });
    }
  }, [uri, dispatch, router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  if (!uri) {
    return (
      <Screen>
        <ThemedText>解析する写真がありません。</ThemedText>
        <View style={styles.buttons}>
          <AppButton label="ホームに戻る" onPress={() => router.replace('/')} />
        </View>
      </Screen>
    );
  }

  if (state.status === 'failed') {
    return (
      <Screen>
        <View style={styles.center}>
          <ThemedText type="subtitle">解析できませんでした</ThemedText>
          <ThemedText accessibilityRole="alert" themeColor="textSecondary">
            {ERROR_MESSAGES[state.kind]}
          </ThemedText>
        </View>
        <View style={styles.buttons}>
          <AppButton label="もう一度試す" onPress={() => void run()} />
          <AppButton label="手動で編集する" variant="secondary" onPress={() => router.replace('/editor')} />
          <AppButton label="ホームに戻る" variant="secondary" onPress={() => router.replace('/')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.center}>
        <ActivityIndicator color={theme.text} />
        <ThemedText type="subtitle">解析しています</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          写真を解析サーバーへ送り、写っているアイテムを検出しています。数秒かかります。
        </ThemedText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { gap: Spacing.three, alignItems: 'center', paddingVertical: Spacing.five },
  buttons: { gap: Spacing.three },
});
