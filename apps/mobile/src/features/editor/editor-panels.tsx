import { FONT_KEYS, TEMPLATES, resolveLabelStyle, getTemplate, type FontKey } from '@coordinate/layout';
import type { EditDocument, LabelStyle } from '@coordinate/shared';
import type { Dispatch } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Chip, Stepper, SwitchRow, Swatches } from '@/components/controls';
import { IconButton } from '@/components/icon-button';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { newLabelId } from './editor-context';
import { FONT_LABEL_JA } from './fonts';
import type { EditorAction } from './reducer';

type Dispatcher = Dispatch<EditorAction>;

const ASPECTS: { value: EditDocument['aspect']; label: string }[] = [
  { value: '4:5', label: '4:5(投稿)' },
  { value: '1:1', label: '1:1' },
  { value: '9:16', label: '9:16(ストーリーズ)' },
  { value: 'original', label: '元の比率' },
];

/** 写真タブ: 縦横比・切り取り位置・回転。 */
export function PhotoPanel({
  doc,
  dispatch,
  onRotate,
  busy,
}: {
  doc: EditDocument;
  dispatch: Dispatcher;
  onRotate: () => void;
  busy: boolean;
}) {
  return (
    <View style={styles.panel}>
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
      <ThemedText type="small" themeColor="textSecondary">
        写真をドラッグすると、切り取る位置を動かせます。ラベルを置く前に整えるのがおすすめです。
      </ThemedText>
      <View style={styles.wrap}>
        <IconButton
          icon="rotate"
          variant="outline"
          size={48}
          accessibilityLabel={busy ? '回転中' : '90°回転'}
          disabled={busy}
          onPress={onRotate}
        />
      </View>
    </View>
  );
}

/** テンプレートタブ。 */
export function TemplatePanel({ doc, dispatch }: { doc: EditDocument; dispatch: Dispatcher }) {
  const theme = useTheme();
  return (
    <View style={styles.panel}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two }}>
        {TEMPLATES.map((t) => {
          const on = t.id === doc.templateId;
          return (
            <Pressable
              key={t.id}
              accessibilityRole="button"
              accessibilityLabel={`テンプレート ${t.nameJa}`}
              accessibilityState={{ selected: on }}
              onPress={() => dispatch({ type: 'setTemplate', templateId: t.id })}
              style={[
                styles.tplCard,
                { backgroundColor: theme.backgroundElement, borderColor: on ? theme.text : theme.border, borderWidth: on ? 1.5 : 1 },
              ]}>
              <ThemedText type="smallBold">{t.nameJa}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
                {t.description}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.wrap}>
        <IconButton
          icon="reset"
          variant="outline"
          size={48}
          accessibilityLabel="配置を自動に戻す"
          onPress={() => dispatch({ type: 'resetLayout' })}
        />
        <IconButton
          icon="text"
          variant="outline"
          size={48}
          accessibilityLabel="文字・線の見た目を戻す"
          onPress={() => dispatch({ type: 'resetStyles' })}
        />
      </View>
    </View>
  );
}

const TEXT_COLORS = ['#FFFFFF', '#1B1A19', '#E9DBB8', '#FFE600', '#FF5A4F', '#4F7CFF'] as const;
const BG_COLORS = ['#FFFFFF', '#1B1A19', '#14110F', '#FFE600', '#F7F3EC', '#FF5A4F'] as const;
const LINE_COLORS = ['#FFFFFF', '#1B1A19', '#D9C48F', '#FFE600', '#FF5A4F', '#4F7CFF'] as const;
const ARROWS: { value: LabelStyle['arrow']; label: string }[] = [
  { value: 'none', label: 'なし' },
  { value: 'simple', label: '矢印' },
  { value: 'curved', label: '曲線矢印' },
  { value: 'dot', label: '丸' },
];

type LabelPanelProps = {
  doc: EditDocument;
  selectedId: string | null;
  dispatch: Dispatcher;
};

function useSelectedLabel(doc: EditDocument, selectedId: string | null) {
  const template = getTemplate(doc.templateId);
  const label = doc.labels.find((l) => l.id === selectedId) ?? null;
  const style = label ? resolveLabelStyle(template, label) : null;
  return { label, style };
}

function NoLabelHint({ doc }: { doc: EditDocument }) {
  return (
    <ThemedText type="small" themeColor="textSecondary">
      {doc.labels.length === 0
        ? 'ラベルタブの＋で、ブランド名・商品名・価格を入れられます。ラベルは写真上でドラッグして動かせます。'
        : '編集するラベルを選んでください。写真上のラベルをタップしても選べます。'}
    </ThemedText>
  );
}

function commitLabel(
  dispatch: Dispatcher,
  id: string,
  patch: Extract<EditorAction, { type: 'commitLabel' }>['patch'],
) {
  if (!id) return;
  dispatch({ type: 'commitLabel', id, patch });
}

/** ラベルタブ: 中身(文字・表示)・フォント・大きさ。 */
export function LabelPanel({ doc, selectedId, dispatch }: LabelPanelProps) {
  const theme = useTheme();
  const { label, style } = useSelectedLabel(doc, selectedId);

  const commit = (patch: Parameters<typeof commitLabel>[2]) => commitLabel(dispatch, label?.id ?? '', patch);
  const inputStyle = [
    styles.input,
    { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement, fontFamily: Fonts.sans },
  ];

  return (
    <View style={styles.panel}>
      <View style={styles.wrap}>
        {doc.labels.map((l, i) => (
          <Chip
            key={l.id}
            label={`${i + 1}. ${l.brand || l.name || '新しいラベル'}`}
            selected={l.id === selectedId}
            onPress={() => dispatch({ type: 'select', id: l.id })}
          />
        ))}
        <IconButton
          icon="plus"
          variant="outline"
          size={44}
          accessibilityLabel="ラベルを追加"
          onPress={() => dispatch({ type: 'addLabel', input: { id: newLabelId(), brand: 'BRAND', name: '商品名', price: '' } })}
        />
      </View>

      {!label || !style ? (
        <NoLabelHint doc={doc} />
      ) : (
        <>
          <TextInput
            accessibilityLabel="ブランド名"
            placeholder="ブランド名"
            placeholderTextColor={theme.textSecondary}
            value={label.brand}
            onFocus={() => dispatch({ type: 'begin' })}
            onChangeText={(t) => dispatch({ type: 'patchLabel', id: label.id, patch: { brand: t } })}
            style={inputStyle}
          />
          <TextInput
            accessibilityLabel="商品名"
            placeholder="商品名"
            placeholderTextColor={theme.textSecondary}
            value={label.name}
            onFocus={() => dispatch({ type: 'begin' })}
            onChangeText={(t) => dispatch({ type: 'patchLabel', id: label.id, patch: { name: t } })}
            style={inputStyle}
          />
          <TextInput
            accessibilityLabel="価格"
            placeholder="価格(例: ¥12,800)"
            placeholderTextColor={theme.textSecondary}
            value={label.price}
            onFocus={() => dispatch({ type: 'begin' })}
            onChangeText={(t) => dispatch({ type: 'patchLabel', id: label.id, patch: { price: t } })}
            style={inputStyle}
          />

          <View style={styles.wrap}>
            <Chip
              label="ブランド"
              accessibilityLabel="ブランド名を表示"
              selected={label.show.brand}
              onPress={() => commit({ show: { brand: !label.show.brand } })}
            />
            <Chip
              label="商品名"
              accessibilityLabel="商品名を表示"
              selected={label.show.name}
              onPress={() => commit({ show: { name: !label.show.name } })}
            />
            <Chip
              label="価格"
              accessibilityLabel="価格を表示"
              selected={label.show.price}
              onPress={() => commit({ show: { price: !label.show.price } })}
            />
          </View>
          <SwitchRow label="このラベルを表示" value={label.visible} onValueChange={(v) => commit({ visible: v })} />

          <View style={styles.wrap}>
            {FONT_KEYS.map((k: FontKey) => (
              <Chip key={k} label={FONT_LABEL_JA[k]} selected={style.fontFamily === k} onPress={() => commit({ style: { fontFamily: k } })} />
            ))}
          </View>
          <Stepper label="文字サイズ" value={style.fontSize} min={8} max={32} step={1} onChange={(v) => commit({ style: { fontSize: v } })} />

          <View style={styles.wrap}>
            <IconButton
              icon="trash"
              variant="outline"
              size={48}
              accessibilityLabel="このラベルを削除"
              onPress={() => dispatch({ type: 'removeLabel', id: label.id })}
            />
          </View>
        </>
      )}
    </View>
  );
}

/** 色タブ: 文字色・背景色・背景の濃さ。 */
export function ColorPanel({ doc, selectedId, dispatch }: LabelPanelProps) {
  const { label, style } = useSelectedLabel(doc, selectedId);
  if (!label || !style) {
    return (
      <View style={styles.panel}>
        <NoLabelHint doc={doc} />
      </View>
    );
  }
  const commit = (patch: Parameters<typeof commitLabel>[2]) => commitLabel(dispatch, label.id, patch);
  return (
    <View style={styles.panel}>
      <Swatches label="文字色" colors={TEXT_COLORS} value={style.textColor} onChange={(c) => commit({ style: { textColor: c } })} />
      <Swatches label="背景色" colors={BG_COLORS} value={style.backgroundColor} onChange={(c) => commit({ style: { backgroundColor: c } })} />
      <Stepper
        label="背景の濃さ"
        value={style.opacity}
        min={0}
        max={1}
        step={0.1}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => commit({ style: { opacity: v } })}
      />
    </View>
  );
}

/** 線タブ: 矢印の形・線の色・太さ。 */
export function LinePanel({ doc, selectedId, dispatch }: LabelPanelProps) {
  const { label, style } = useSelectedLabel(doc, selectedId);
  if (!label || !style) {
    return (
      <View style={styles.panel}>
        <NoLabelHint doc={doc} />
      </View>
    );
  }
  const commit = (patch: Parameters<typeof commitLabel>[2]) => commitLabel(dispatch, label.id, patch);
  return (
    <View style={styles.panel}>
      <View style={styles.wrap}>
        {ARROWS.map((a) => (
          <Chip key={a.value} label={a.label} selected={style.arrow === a.value} onPress={() => commit({ style: { arrow: a.value } })} />
        ))}
      </View>
      <Swatches label="線の色" colors={LINE_COLORS} value={style.lineColor} onChange={(c) => commit({ style: { lineColor: c } })} />
      <Stepper label="線の太さ" value={style.lineWidth} min={0} max={6} step={0.4} onChange={(v) => commit({ style: { lineWidth: v } })} />
      <ThemedText type="small" themeColor="textSecondary">
        青い丸を動かすと、線の指し先(アイテム側)を変えられます。
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: Spacing.three, paddingBottom: Spacing.five },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  tplCard: { width: 150, padding: Spacing.three, borderRadius: 14, gap: Spacing.one },
  input: {
    minHeight: 46,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    fontSize: 15,
  },
});
