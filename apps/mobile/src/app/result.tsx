import { DEFAULT_CATEGORIES, type QualityIssue } from '@coordinate/shared';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { Chip } from '@/components/controls';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { newItemId, useAnalysis } from '@/features/analysis/analysis-context';
import type { ResultItem } from '@/features/analysis/analysis-reducer';
import { itemsToLabelInputs } from '@/features/analysis/items-to-labels';
import { newLabelId, useEditor } from '@/features/editor/editor-context';
import { currentCrop } from '@/features/editor/reducer';
import { useTheme } from '@/hooks/use-theme';

const GROUPS = [
  ['clothing', '衣類'],
  ['shoes', '靴'],
  ['bag', 'バッグ'],
  ['accessory', 'アクセサリー'],
] as const;

const ISSUE_TEXT: Record<QualityIssue, string> = {
  low_resolution: '解像度が低い写真です。細部(文字やロゴ)が読み取れない場合があります。',
  too_dark: '暗い写真です。明るい場所で撮った写真のほうが正確に検出できます。',
  blurry: '写真がぼやけているようです。ブランド名が読み取れない場合があります。',
  not_full_body: '全身が写っていないようです。写っていないアイテムは検出されません。',
};

const categoryName = (id: string) => DEFAULT_CATEGORIES.find((c) => c.id === id)?.labelJa ?? id;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}秒`;
const indexText = (n: number) => String(n).padStart(2, '0');

export default function ResultScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { snapshot, dispatch: editorDispatch } = useEditor();
  const { state, dispatch } = useAnalysis();
  // どの項目のカテゴリ選択を開いているか。'new' は手動追加。
  const [picking, setPicking] = useState<string | null>(null);

  if (!snapshot || state.status !== 'done') {
    return (
      <Screen>
        <ThemedText>認識結果がありません。</ThemedText>
        <AppButton label="ホームに戻る" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  const { photo } = snapshot;
  const togglePicking = (key: string) => setPicking((cur) => (cur === key ? null : key));

  const proceed = () => {
    // 戻ってきて再度進んでも、ラベルを二重に追加しない。
    if (!state.applied) {
      const inputs = itemsToLabelInputs(state.items, currentCrop(snapshot), newLabelId);
      editorDispatch({ type: 'addLabels', inputs });
      dispatch({ type: 'applied' });
    }
    router.push('/editor');
  };

  return (
    <Screen>
      <View style={styles.head}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          Detected items
        </ThemedText>
        <ThemedText type="title">写っているアイテム</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {`品質確認 ${seconds(state.timings.quality)} ・ 検出 ${seconds(state.timings.detect)}`}
        </ThemedText>
      </View>

      <View style={[styles.photoWrap, { aspectRatio: photo.width / photo.height, borderColor: theme.border }]}>
        <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        {state.items.map((it, i) => (
          <View
            key={it.id}
            pointerEvents="none"
            style={[
              styles.box,
              {
                left: `${it.box.x * 100}%`,
                top: `${it.box.y * 100}%`,
                width: `${it.box.w * 100}%`,
                height: `${it.box.h * 100}%`,
              },
            ]}>
            <View style={styles.badge}>
              <ThemedText type="small" style={styles.badgeText}>
                {indexText(i + 1)}
              </ThemedText>
            </View>
          </View>
        ))}
      </View>

      {state.quality.issues.length > 0 ? (
        <View style={[styles.advice, { backgroundColor: theme.backgroundElement }]}>
          {state.quality.issues.map((issue) => (
            <ThemedText key={issue} type="small" themeColor="textSecondary">
              {ISSUE_TEXT[issue]}
            </ThemedText>
          ))}
        </View>
      ) : null}

      {state.items.length === 0 ? (
        <View style={styles.empty}>
          <ThemedText type="subtitle">アイテムを見つけられませんでした</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            下のボタンから手動で追加できます。
          </ThemedText>
        </View>
      ) : null}

      {state.items.map((it, i) => (
        <ItemCard
          key={it.id}
          index={i + 1}
          item={it}
          pickingCategory={picking === it.id}
          onTogglePick={() => togglePicking(it.id)}
          onPick={(categoryId) => {
            dispatch({ type: 'setCategory', id: it.id, categoryId });
            setPicking(null);
          }}
          onBrand={(brand) => dispatch({ type: 'setBrand', id: it.id, brand })}
          onRemove={() => dispatch({ type: 'remove', id: it.id })}
        />
      ))}

      {picking === 'new' ? (
        <View style={[styles.card, { borderColor: theme.border }]}>
          <ThemedText type="subtitle">追加するアイテム</ThemedText>
          <CategoryPicker
            onPick={(categoryId) => {
              dispatch({ type: 'addManual', id: newItemId(), categoryId });
              setPicking(null);
            }}
          />
        </View>
      ) : null}

      <View style={styles.buttons}>
        <AppButton label="この内容で編集へ" onPress={proceed} />
        <AppButton label="アイテムを追加" variant="secondary" onPress={() => togglePicking('new')} />
      </View>
    </Screen>
  );
}

function ItemCard({
  index,
  item,
  pickingCategory,
  onTogglePick,
  onPick,
  onBrand,
  onRemove,
}: {
  index: number;
  item: ResultItem;
  pickingCategory: boolean;
  onTogglePick: () => void;
  onPick: (categoryId: string) => void;
  onBrand: (brand: string) => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const name = categoryName(item.categoryId);
  const readFromPhoto = item.origin === 'ai' && item.level !== 'unidentified';
  return (
    <View style={[styles.card, { borderColor: theme.border }]}>
      <View style={styles.cardHead}>
        <ThemedText type="eyebrow" themeColor="textSecondary" style={styles.index}>
          {indexText(index)}
        </ThemedText>
        <ThemedText type="subtitle" style={styles.name}>
          {name}
        </ThemedText>
        <Chip
          label="変更"
          accessibilityLabel={`${name}のカテゴリを変更`}
          selected={pickingCategory}
          onPress={onTogglePick}
        />
      </View>
      {pickingCategory ? <CategoryPicker current={item.categoryId} onPick={onPick} /> : null}

      <View style={styles.brand}>
        <TextInput
          accessibilityLabel={`${name}のブランド`}
          value={item.brand}
          onChangeText={onBrand}
          placeholder="ブランド名(任意)"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { color: theme.text, borderColor: theme.border }]}
        />
        <ThemedText type="small" themeColor="textSecondary">
          {item.brand.trim() === ''
            ? 'ブランド不明'
            : readFromPhoto
              ? '写真内の文字から読み取りました'
              : '入力した内容です'}
        </ThemedText>
      </View>

      <View style={styles.cardFoot}>
        <Chip label="削除" accessibilityLabel={`${name}を削除`} selected={false} onPress={onRemove} />
      </View>
    </View>
  );
}

function CategoryPicker({ current, onPick }: { current?: string; onPick: (categoryId: string) => void }) {
  return (
    <View style={styles.picker}>
      {GROUPS.map(([group, label]) => (
        <View key={group} style={styles.pickerGroup}>
          <ThemedText type="small" themeColor="textSecondary">
            {label}
          </ThemedText>
          <View style={styles.chips}>
            {DEFAULT_CATEGORIES.filter((c) => c.group === group).map((c) => (
              <Chip key={c.id} label={c.labelJa} selected={c.id === current} onPress={() => onPick(c.id)} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { gap: Spacing.two },
  photoWrap: { width: '100%', borderRadius: 12, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth * 2 },
  box: { position: 'absolute', borderWidth: 1.5, borderColor: '#FFFFFF', borderRadius: 4 },
  badge: {
    position: 'absolute',
    top: -1,
    left: -1,
    minWidth: 24,
    height: 20,
    paddingHorizontal: 5,
    borderTopLeftRadius: 4,
    borderBottomRightRadius: 4,
    backgroundColor: '#1B1A19',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 11, lineHeight: 16, letterSpacing: 0.5 },
  advice: { gap: Spacing.one, paddingVertical: Spacing.three, paddingHorizontal: Spacing.three, borderRadius: 12 },
  empty: { gap: Spacing.one, alignItems: 'center', paddingVertical: Spacing.three },
  card: { gap: Spacing.three, padding: Spacing.three, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth * 2 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  index: { width: 28 },
  name: { flex: 1 },
  brand: { gap: Spacing.one },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    fontFamily: Fonts.sans,
    fontSize: 15,
  },
  cardFoot: { flexDirection: 'row', justifyContent: 'flex-end' },
  picker: { gap: Spacing.three },
  pickerGroup: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  buttons: { gap: Spacing.three, paddingTop: Spacing.two },
});
