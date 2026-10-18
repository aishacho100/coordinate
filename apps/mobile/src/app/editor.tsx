import { cropAspectRatio, computeCrop } from '@coordinate/layout';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/app-button';
import { IconButton } from '@/components/icon-button';
import type { IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { EditorCanvas, type CanvasHandlers } from '@/features/editor/editor-canvas';
import { useEditor } from '@/features/editor/editor-context';
import { ColorPanel, LabelPanel, LinePanel, PhotoPanel, TemplatePanel } from '@/features/editor/editor-panels';
import { rotatePhoto90 } from '@/features/editor/photo-io';

type Tab = 'photo' | 'template' | 'label' | 'color' | 'line';
const TABS: { value: Tab; icon: IconName; name: string }[] = [
  { value: 'photo', icon: 'crop', name: '写真' },
  { value: 'template', icon: 'frame', name: 'テンプレート' },
  { value: 'label', icon: 'text', name: 'ラベル' },
  { value: 'color', icon: 'contrast', name: '色' },
  { value: 'line', icon: 'pointer', name: '線' },
];

export default function EditorScreen() {
  const router = useRouter();
  const { state, snapshot, dispatch, canUndo, canRedo } = useEditor();
  const { width: winW, height: winH } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>('photo');
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlers = useMemo<CanvasHandlers>(
    () => ({
      onSelect: (id) => {
        dispatch({ type: 'select', id });
        if (id && tab === 'photo') setTab('label');
      },
      onBegin: () => dispatch({ type: 'begin' }),
      onMoveLabel: (id, target, dx, dy) => dispatch({ type: 'moveLabel', id, target, dx, dy }),
      onPanCrop: (dx, dy) => dispatch({ type: 'panCrop', dx, dy }),
    }),
    [dispatch, tab],
  );

  const rotate = useCallback(async () => {
    if (!snapshot) return;
    setRotating(true);
    setError(null);
    try {
      const photo = await rotatePhoto90(snapshot.photo);
      dispatch({ type: 'replacePhoto', photo, rotated90: true });
    } catch {
      setError('写真の回転に失敗しました。もう一度お試しください。');
    } finally {
      setRotating(false);
    }
  }, [snapshot, dispatch]);

  if (!snapshot) {
    return (
      <ThemedView style={styles.empty}>
        <ThemedText>編集する写真がありません。</ThemedText>
        <AppButton label="ホームに戻る" onPress={() => router.replace('/')} />
      </ThemedView>
    );
  }

  const { photo, doc } = snapshot;
  const crop = doc.crop ?? computeCrop(photo.width, photo.height, doc.aspect);
  const ratio = cropAspectRatio(crop, photo.width, photo.height);
  // 写真が主役。キャンバスは画面の約半分まで使い、残りを操作パネルに使う。
  const availW = winW - Spacing.three * 2;
  const canvasW = Math.floor(Math.min(availW, winH * 0.52 * ratio));

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
        <View style={styles.topBar}>
          <IconButton
            icon="undo"
            accessibilityLabel="元に戻す"
            tooltipPlacement="below"
            disabled={!canUndo}
            onPress={() => dispatch({ type: 'undo' })}
          />
          <IconButton
            icon="redo"
            accessibilityLabel="やり直す"
            tooltipPlacement="below"
            disabled={!canRedo}
            onPress={() => dispatch({ type: 'redo' })}
          />
          <IconButton
            icon="yen"
            accessibilityLabel="価格を表示(全体)"
            tooltipPlacement="below"
            selected={doc.showPrices}
            onPress={() => dispatch({ type: 'setShowPrices', showPrices: !doc.showPrices })}
          />
          <View style={{ flex: 1 }} />
          <IconButton
            icon="arrowRight"
            variant="main"
            size={48}
            accessibilityLabel="書き出しへ"
            tooltipPlacement="below"
            onPress={() => router.push('/export')}
          />
        </View>

        <View style={styles.canvasWrap}>
          <EditorCanvas
            photo={photo}
            doc={doc}
            width={canvasW}
            selectedId={state.selectedId}
            cropMode={tab === 'photo'}
            handlers={handlers}
          />
        </View>

        <View style={styles.tabs}>
          {TABS.map((t) => (
            <IconButton
              key={t.value}
              icon={t.icon}
              accessibilityLabel={t.name}
              selected={tab === t.value}
              onPress={() => setTab(t.value)}
            />
          ))}
        </View>

        <ScrollView style={styles.panelScroll} contentContainerStyle={styles.panelContent} keyboardShouldPersistTaps="handled">
          {error ? (
            <ThemedText type="small" accessibilityRole="alert" themeColor="error">
              {error}
            </ThemedText>
          ) : null}
          {tab === 'photo' ? <PhotoPanel doc={doc} dispatch={dispatch} onRotate={rotate} busy={rotating} /> : null}
          {tab === 'template' ? <TemplatePanel doc={doc} dispatch={dispatch} /> : null}
          {tab === 'label' ? <LabelPanel doc={doc} selectedId={state.selectedId} dispatch={dispatch} /> : null}
          {tab === 'color' ? <ColorPanel doc={doc} selectedId={state.selectedId} dispatch={dispatch} /> : null}
          {tab === 'line' ? <LinePanel doc={doc} selectedId={state.selectedId} dispatch={dispatch} /> : null}
        </ScrollView>

      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, zIndex: 2 },
  canvasWrap: { alignItems: 'center', paddingVertical: Spacing.two },
  tabs: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  panelScroll: { flex: 1 },
  panelContent: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
});
