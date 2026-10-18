import { DEFAULT_CATEGORIES, type QualityIssue } from '@coordinate/shared';
import { Image } from 'expo-image';
import { useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { Chip } from '@/components/controls';
import { IconButton } from '@/components/icon-button';
import { ImageSearchConsentCard } from '@/components/image-search-consent-card';
import { ProductCandidates } from '@/components/product-candidates';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { newItemId, useAnalysis } from '@/features/analysis/analysis-context';
import type { ResultItem } from '@/features/analysis/analysis-reducer';
import { cropItem } from '@/features/analysis/crop-item';
import { itemsToLabelInputs } from '@/features/analysis/items-to-labels';
import { thumbLayout } from '@/features/analysis/thumb-layout';
import { newLabelId, useEditor } from '@/features/editor/editor-context';
import { currentCrop } from '@/features/editor/reducer';
import { useTheme } from '@/hooks/use-theme';
import { AnalyzeError, ERROR_MESSAGES } from '@/lib/analyze-api';
import { identifyItem } from '@/lib/identify-api';
import { getImageSearchConsent, setImageSearchConsent } from '@/lib/image-search-consent';

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

/** 切り抜きのサムネイルの一辺(pt)。 */
const THUMB = 52;

export default function ResultScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const theme = useTheme();
  const { snapshot, dispatch: editorDispatch } = useEditor();
  const { state, dispatch } = useAnalysis();
  // 開いているカテゴリ選択。'new' は手動追加、'edit' は選択中アイテムの編集パネル。
  const [picking, setPicking] = useState<'new' | 'edit' | null>(null);
  // 下に詳しく出す(選択中の)アイテム。未選択や削除後は先頭を使う。
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 探している最中の項目。state の更新を待たずに、二重に送らないための印。
  const searching = useRef(new Set<string>());
  // 同意のカードを出している項目。同意の値そのものは端末の保存(設定画面と共有)を押すたびに読む。
  const [asking, setAsking] = useState<string[]>([]);

  // 編集した内容や探した結果があるときだけ、戻る操作(戻るキー・スワイプ・ヘッダー)を止めて確認する。
  // 「この内容で編集へ」は push なのでこの画面は取り除かれず、確認は出ない。
  const hasEdits = state.status === 'done' && state.dirty;
  usePreventRemove(hasEdits, ({ data }) => {
    Alert.alert('編集内容が失われます', '戻ると、この画面での変更と探した商品の結果が失われます。', [
      { text: 'キャンセル', style: 'cancel' },
      { text: '戻る', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  if (!snapshot || state.status !== 'done') {
    return (
      <Screen>
        <ThemedText>認識結果がありません。</ThemedText>
        <AppButton label="ホームに戻る" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  const { photo } = snapshot;
  const selected = state.items.find((it) => it.id === selectedId) ?? state.items[0] ?? null;
  const select = (id: string) => {
    setSelectedId(id);
    setPicking((cur) => (cur === 'new' ? cur : null));
  };

  /** searching に印を付けたあとで呼ぶ。終わったら印を外す。 */
  const search = async (it: ResultItem, imageSearchConsent: boolean) => {
    if (!it.detected) {
      searching.current.delete(it.id);
      return;
    }
    dispatch({ type: 'identifyStart', id: it.id });
    try {
      const cropUri = await cropItem(photo, it.box);
      const response = await identifyItem(cropUri, { ...it.detected, categoryId: it.categoryId }, { imageSearchConsent });
      dispatch({ type: 'identifySucceeded', id: it.id, response });
    } catch (e) {
      dispatch({ type: 'identifyFailed', id: it.id, kind: e instanceof AnalyzeError ? e.kind : 'identify_failed' });
    } finally {
      searching.current.delete(it.id);
    }
  };

  const requestSearch = async (it: ResultItem) => {
    if (!it.detected || searching.current.has(it.id)) return;
    searching.current.add(it.id);
    const consent = await getImageSearchConsent();
    if (consent === 'unset') {
      searching.current.delete(it.id);
      setAsking((cur) => (cur.includes(it.id) ? cur : [...cur, it.id]));
      return;
    }
    await search(it, consent === 'granted');
  };

  const answerConsent = async (it: ResultItem, value: 'granted' | 'declined') => {
    if (searching.current.has(it.id)) return;
    searching.current.add(it.id);
    await setImageSearchConsent(value);
    // どれかで選んだら、ほかのアイテムの同意のカードも閉じる。
    setAsking([]);
    await search(it, value === 'granted');
  };

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
      <View style={[styles.photoWrap, { aspectRatio: photo.width / photo.height, borderColor: theme.border }]}>
        <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} contentFit="cover" accessible={false} />
        {state.items.map((it) => (
          <ItemMarker key={it.id} item={it} active={it.id === selected?.id} />
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

      <View style={styles.thumbs}>
        {state.items.map((it) => (
          <Thumb key={it.id} item={it} photo={photo} active={it.id === selected?.id} onPress={() => select(it.id)} />
        ))}
        <IconButton
          icon="plus"
          accessibilityLabel="アイテムを追加"
          onPress={() => setPicking((cur) => (cur === 'new' ? null : 'new'))}
        />
      </View>

      {picking === 'new' ? (
        <CategoryPicker
          onPick={(categoryId) => {
            const id = newItemId();
            dispatch({ type: 'addManual', id, categoryId });
            setSelectedId(id);
            setPicking(null);
          }}
        />
      ) : null}

      {state.items.length === 0 ? (
        <View style={styles.empty}>
          <ThemedText type="subtitle">アイテムを見つけられませんでした</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            ＋から手動で追加できます。
          </ThemedText>
        </View>
      ) : null}

      {selected ? (
        <ItemDetail
          key={selected.id}
          item={selected}
          editing={picking === 'edit'}
          onToggleEdit={() => setPicking((cur) => (cur === 'edit' ? null : 'edit'))}
          onPick={(categoryId) => {
            dispatch({ type: 'setCategory', id: selected.id, categoryId });
            setPicking(null);
          }}
          onBrand={(brand) => dispatch({ type: 'setBrand', id: selected.id, brand })}
          onRemove={() => {
            dispatch({ type: 'remove', id: selected.id });
            setPicking((cur) => (cur === 'edit' ? null : cur));
          }}
          onSearch={() => void requestSearch(selected)}
          asking={asking.includes(selected.id)}
          onGrant={() => void answerConsent(selected, 'granted')}
          onDecline={() => void answerConsent(selected, 'declined')}
        />
      ) : null}

      <View style={styles.proceed}>
        <IconButton icon="arrowRight" accessibilityLabel="この内容で編集へ" variant="outline" onPress={proceed} />
      </View>
    </Screen>
  );
}

/** 写真の上の、アイテムの位置を示す金の細い点(白縁)とブランド名の小さなタグ。 */
function ItemMarker({ item, active }: { item: ResultItem; active: boolean }) {
  const cx = item.box.x + item.box.w / 2;
  const cy = item.box.y + item.box.h / 2;
  const brand = item.brand.trim();
  const dot = active ? 16 : 12;
  return (
    <View pointerEvents="none" style={[styles.marker, { left: `${cx * 100}%`, top: `${cy * 100}%` }]}>
      <View
        style={[
          styles.dot,
          { width: dot, height: dot, borderRadius: dot / 2, marginLeft: -dot / 2, marginTop: -dot / 2 },
        ]}
      />
      {brand ? (
        <View style={[styles.tag, cx > 0.55 ? { right: 14 } : { left: 14 }]}>
          <ThemedText type="small" style={styles.tagText} numberOfLines={1}>
            {brand}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

/** 切り抜きの小さな写真。写真をそのまま拡大して見せる(ファイルは切り出さない)。選択中は金の縁。 */
function Thumb({
  item,
  photo,
  active,
  onPress,
}: {
  item: ResultItem;
  photo: { uri: string; width: number; height: number };
  active: boolean;
  onPress: () => void;
}) {
  const l = thumbLayout(photo, item.box, THUMB - 4);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${categoryName(item.categoryId)}を選ぶ`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.thumb, active && styles.thumbOn]}>
      <View style={styles.thumbClip}>
        <Image
          source={{ uri: photo.uri }}
          style={{ position: 'absolute', width: l.width, height: l.height, left: l.left, top: l.top }}
          contentFit="fill"
          accessible={false}
        />
      </View>
    </Pressable>
  );
}

function ItemDetail({
  item,
  editing,
  onToggleEdit,
  onPick,
  onBrand,
  onRemove,
  onSearch,
  asking,
  onGrant,
  onDecline,
}: {
  item: ResultItem;
  editing: boolean;
  onToggleEdit: () => void;
  onPick: (categoryId: string) => void;
  onBrand: (brand: string) => void;
  onRemove: () => void;
  onSearch: () => void;
  asking: boolean;
  onGrant: () => void;
  onDecline: () => void;
}) {
  const theme = useTheme();
  const name = categoryName(item.categoryId);
  const readFromPhoto = item.origin === 'ai' && item.level !== 'unidentified';
  const brandless = item.brand.trim() === '';
  const status = item.identify.status;
  const loading = status === 'loading';
  // 同意の説明を出している間は検索ボタンを隠し、押すものを同意のカードのボタンだけにする。
  const showSearch = !!item.detected && !(asking && !loading);
  const searchLabel = loading
    ? '探しています'
    : status === 'failed' || status === 'done'
      ? 'もう一度探す'
      : `${name}の商品を探す`;
  return (
    <View style={styles.detail}>
      <View style={styles.summary}>
        <ThemedText type="smallBold">{name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {brandless ? 'ブランド不明' : item.brand}
        </ThemedText>
      </View>
      {!brandless ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
          {readFromPhoto ? '写真内の文字から読み取りました' : '入力した内容です'}
        </ThemedText>
      ) : null}

      <View style={styles.actions}>
        {showSearch ? (
          <IconButton icon="search" variant="main" accessibilityLabel={searchLabel} disabled={loading} onPress={onSearch} />
        ) : null}
        <IconButton icon="edit" accessibilityLabel={`${name}を編集`} onPress={onToggleEdit} />
        <IconButton icon="trash" accessibilityLabel={`${name}を削除`} onPress={onRemove} />
      </View>

      {editing ? (
        <View style={styles.editBox}>
          <TextInput
            accessibilityLabel={`${name}のブランド`}
            value={item.brand}
            onChangeText={onBrand}
            placeholder="ブランド名(任意)"
            placeholderTextColor={theme.textSecondary}
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement },
            ]}
          />
          <CategoryPicker current={item.categoryId} onPick={onPick} />
        </View>
      ) : null}

      {item.detected ? (
        <SearchResult identify={item.identify} asking={asking} onGrant={onGrant} onDecline={onDecline} />
      ) : null}
    </View>
  );
}

function SearchResult({
  identify,
  asking,
  onGrant,
  onDecline,
}: {
  identify: ResultItem['identify'];
  asking: boolean;
  onGrant: () => void;
  onDecline: () => void;
}) {
  const theme = useTheme();
  if (asking && identify.status !== 'loading') {
    return <ImageSearchConsentCard onGrant={onGrant} onDecline={onDecline} />;
  }
  if (identify.status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary">
          探しています
        </ThemedText>
      </View>
    );
  }
  if (identify.status === 'failed') {
    return (
      <ThemedText type="small" themeColor="error" accessibilityRole="alert" style={styles.centerText}>
        {ERROR_MESSAGES[identify.kind]}
      </ThemedText>
    );
  }
  if (identify.status === 'done') {
    return <ProductCandidates response={identify.response} />;
  }
  return null;
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
  photoWrap: { width: '100%', borderRadius: 14, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth * 2 },
  marker: { position: 'absolute', width: 0, height: 0 },
  dot: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    backgroundColor: Colors.accent,
  },
  tag: {
    position: 'absolute',
    top: -10,
    maxWidth: 140,
    paddingHorizontal: 9,
    borderRadius: 999,
    backgroundColor: 'rgba(15,14,13,0.82)',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(201,179,138,0.4)',
  },
  tagText: { fontSize: 11, lineHeight: 18, letterSpacing: 0.4 },
  advice: { gap: Spacing.one, paddingVertical: Spacing.three, paddingHorizontal: Spacing.three, borderRadius: 12 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  thumb: { width: THUMB, height: THUMB, borderRadius: 12, padding: 2, borderWidth: 1.5, borderColor: 'transparent' },
  thumbOn: { borderColor: Colors.accent },
  thumbClip: { flex: 1, borderRadius: 9, overflow: 'hidden', backgroundColor: Colors.backgroundElement },
  empty: { gap: Spacing.one, alignItems: 'center', paddingVertical: Spacing.three },
  detail: { gap: Spacing.three },
  summary: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  note: { marginTop: -Spacing.two, fontSize: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.four },
  editBox: { gap: Spacing.three },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    fontFamily: Fonts.sans,
    fontSize: 15,
  },
  loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  centerText: { textAlign: 'center' },
  picker: { gap: Spacing.three },
  pickerGroup: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  proceed: { alignItems: 'center', paddingTop: Spacing.two },
});
