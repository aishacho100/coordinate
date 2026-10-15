import { cropAspectRatio, computeCrop } from '@coordinate/layout';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/app-button';
import { Chip, SwitchRow } from '@/components/controls';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { EditorCanvas, type CanvasHandlers } from '@/features/editor/editor-canvas';
import { useEditor } from '@/features/editor/editor-context';
import { LabelPanel, PhotoPanel, TemplatePanel } from '@/features/editor/editor-panels';
import { rotatePhoto90 } from '@/features/editor/photo-io';

type Tab = 'photo' | 'template' | 'label';

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
        if (id) setTab('label');
      },
      onBegin: () => dispatch({ type: 'begin' }),
      onMoveLabel: (id, target, dx, dy) => dispatch({ type: 'moveLabel', id, target, dx, dy }),
      onPanCrop: (dx, dy) => dispatch({ type: 'panCrop', dx, dy }),
    }),
    [dispatch],
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
  // キャンバスは画面の約45%までに収め、残りを操作パネルに使う。
  const availW = winW - Spacing.three * 2;
  const canvasW = Math.floor(Math.min(availW, winH * 0.45 * ratio));

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
        <View style={styles.topBar}>
          <Chip label="元に戻す" selected={false} onPress={canUndo ? () => dispatch({ type: 'undo' }) : () => {}} />
          <Chip label="やり直す" selected={false} onPress={canRedo ? () => dispatch({ type: 'redo' }) : () => {}} />
          <View style={{ flex: 1 }} />
          <ThemedText type="small" themeColor="textSecondary">
            {canUndo ? '編集済み' : ' '}
          </ThemedText>
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
          <Chip label="写真" selected={tab === 'photo'} onPress={() => setTab('photo')} />
          <Chip label="テンプレート" selected={tab === 'template'} onPress={() => setTab('template')} />
          <Chip label="ラベル" selected={tab === 'label'} onPress={() => setTab('label')} />
        </View>

        <ScrollView style={styles.panelScroll} contentContainerStyle={styles.panelContent} keyboardShouldPersistTaps="handled">
          <SwitchRow
            label="価格を表示(全体)"
            value={doc.showPrices}
            onValueChange={(v) => dispatch({ type: 'setShowPrices', showPrices: v })}
          />
          {error ? (
            <ThemedText type="small" accessibilityRole="alert" style={{ color: '#C0392B' }}>
              {error}
            </ThemedText>
          ) : null}
          {tab === 'photo' ? <PhotoPanel doc={doc} dispatch={dispatch} onRotate={rotate} busy={rotating} /> : null}
          {tab === 'template' ? <TemplatePanel doc={doc} dispatch={dispatch} /> : null}
          {tab === 'label' ? <LabelPanel doc={doc} selectedId={state.selectedId} dispatch={dispatch} /> : null}
        </ScrollView>

        <View style={styles.footer}>
          <AppButton label="書き出しへ" onPress={() => router.push('/export')} />
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  canvasWrap: { alignItems: 'center', paddingVertical: Spacing.two },
  tabs: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  panelScroll: { flex: 1 },
  panelContent: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  footer: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.three },
});
