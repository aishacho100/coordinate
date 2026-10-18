import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { useAnalysis } from '@/features/analysis/analysis-context';
import { useEditor } from '@/features/editor/editor-context';
import { AnalyzeError, analyzePhoto, ERROR_MESSAGES } from '@/lib/analyze-api';

export default function AnalyzingScreen() {
  const router = useRouter();
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
      <View style={styles.stage}>
        <Image
          source={{ uri }}
          style={styles.photo}
          contentFit="contain"
          accessible={false}
        />
        <ProgressLine />
      </View>
    </Screen>
  );
}

/** 細い進捗線。終わりが分からない処理なので、光の線が左から右へ流れ続ける。 */
function ProgressLine() {
  const [width, setWidth] = useState(0);
  const [x] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!width) return;
    x.setValue(0);
    const loop = Animated.loop(
      Animated.timing(x, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [width, x]);

  const seg = width * 0.3;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="解析しています"
      style={styles.track}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Animated.View
        style={[
          styles.glow,
          { width: seg, transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-seg, width] }) }] },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { gap: Spacing.three, alignItems: 'center', paddingVertical: Spacing.five },
  stage: { gap: Spacing.four, alignItems: 'center', paddingVertical: Spacing.four },
  photo: { width: '100%', maxWidth: 360, aspectRatio: 3 / 4, borderRadius: 4 },
  track: {
    width: '100%',
    maxWidth: 360,
    height: 2,
    backgroundColor: Colors.backgroundSelected,
    overflow: 'hidden',
  },
  glow: { height: 2, backgroundColor: Colors.accent },
  buttons: { gap: Spacing.three },
});
