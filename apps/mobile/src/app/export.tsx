import { computeCrop, cropAspectRatio } from '@coordinate/layout';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/app-button';
import { Chip } from '@/components/controls';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { EditorCanvas } from '@/features/editor/editor-canvas';
import { useEditor } from '@/features/editor/editor-context';
import {
  EXPORT_WIDTH,
  ExportError,
  exportSize,
  renderToFile,
  saveToDevice,
  shareImage,
  type ExportFormat,
} from '@/features/export/export-image';

type Aspect = '4:5' | '1:1' | '9:16' | 'original';
const ASPECTS: { value: Aspect; label: string }[] = [
  { value: '4:5', label: '4:5' },
  { value: '1:1', label: '1:1' },
  { value: '9:16', label: '9:16' },
  { value: 'original', label: '元の比率' },
];

type Status = { kind: 'info' | 'error'; text: string } | null;

export default function ExportScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { snapshot, dispatch } = useEditor();
  const { width: winW, height: winH } = useWindowDimensions();
  const shotRef = useRef<View>(null);
  const [format, setFormat] = useState<ExportFormat>('png');
  const [busy, setBusy] = useState<'save' | 'share' | null>(null);
  const [status, setStatus] = useState<Status>(null);

  if (!snapshot) {
    return (
      <ThemedView style={styles.empty}>
        <ThemedText>書き出す画像がありません。</ThemedText>
        <AppButton label="ホームに戻る" onPress={() => router.replace('/')} />
      </ThemedView>
    );
  }

  const { photo, doc } = snapshot;
  const crop = doc.crop ?? computeCrop(photo.width, photo.height, doc.aspect);
  const ratio = cropAspectRatio(crop, photo.width, photo.height);
  const size = exportSize(ratio);
  const canvasW = Math.floor(Math.min(winW - Spacing.four * 2, winH * 0.5 * ratio));

  const run = async (kind: 'save' | 'share') => {
    setBusy(kind);
    setStatus(null);
    try {
      const uri = await renderToFile(shotRef, format, ratio);
      if (kind === 'save') {
        await saveToDevice(uri);
        setStatus({ kind: 'info', text: '端末の写真に保存しました。' });
      } else {
        await shareImage(uri, format);
      }
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof ExportError ? e.message : '書き出しに失敗しました。' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            Preview
          </ThemedText>
          <View style={styles.preview}>
            {/* この View をそのまま画像として書き出す。プレビューと書き出し結果が一致する。 */}
            <View ref={shotRef} collapsable={false}>
              <EditorCanvas photo={photo} doc={doc} width={canvasW} />
            </View>
          </View>
          <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
            出力サイズ {size.width} × {size.height}px(幅 {EXPORT_WIDTH}px)
          </ThemedText>

          <ThemedText type="smallBold">画面比率</ThemedText>
          <View style={styles.wrap}>
            {ASPECTS.map((a) => (
              <Chip
                key={a.value}
                label={a.label}
                selected={doc.aspect === a.value}
                onPress={() => dispatch({ type: 'setAspect', aspect: a.value })}
              />
            ))}
          </View>

          <ThemedText type="smallBold">画像形式</ThemedText>
          <View style={styles.wrap}>
            <Chip label="PNG(高画質)" selected={format === 'png'} onPress={() => setFormat('png')} />
            <Chip label="JPEG(軽量)" selected={format === 'jpg'} onPress={() => setFormat('jpg')} />
          </View>

          {status ? (
            <ThemedText
              type="small"
              accessibilityRole={status.kind === 'error' ? 'alert' : undefined}
              style={{ color: status.kind === 'error' ? theme.error : theme.success }}>
              {status.text}
            </ThemedText>
          ) : null}

          <View style={styles.actions}>
            <AppButton label={busy === 'share' ? '準備中…' : '共有する(Instagramなど)'} onPress={() => run('share')} disabled={busy !== null} />
            <AppButton label={busy === 'save' ? '保存中…' : '端末に保存'} variant="secondary" onPress={() => run('save')} disabled={busy !== null} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four },
  content: { padding: Spacing.four, gap: Spacing.three },
  preview: { alignItems: 'center' },
  center: { textAlign: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  actions: { gap: Spacing.three, marginTop: Spacing.three },
});
