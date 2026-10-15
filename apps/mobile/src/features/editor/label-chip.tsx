import { resolveLabelStyle, visibleLines, type TemplateDefinition } from '@coordinate/layout';
import type { Label } from '@coordinate/shared';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { withAlpha } from '@/lib/color';

import { FONT_FAMILY } from './fonts';

type Props = {
  label: Label;
  template: TemplateDefinition;
  showPrices: boolean;
  /** キャンバス幅/360。画面サイズが違っても、書き出し画像と同じ見た目になる。 */
  unit: number;
  selected?: boolean;
  onLayout?: (e: LayoutChangeEvent) => void;
};

/** ラベル本体(ブランド名・商品名・価格)。表示行が無ければ何も描かない。 */
export function LabelChip({ label, template, showPrices, unit, selected = false, onLayout }: Props) {
  const lines = visibleLines(label, showPrices);
  if (!lines) return null;
  const s = resolveLabelStyle(template, label);
  const { box } = template;
  const fontFamily = FONT_FAMILY[s.fontFamily];
  const shadow = box.textShadow
    ? { textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 * unit }
    : null;

  return (
    <View
      onLayout={onLayout}
      style={[
        styles.box,
        {
          backgroundColor: withAlpha(s.backgroundColor, s.opacity),
          borderRadius: box.radius * unit,
          paddingHorizontal: box.paddingX * unit,
          paddingVertical: box.paddingY * unit,
          borderWidth: box.borderWidth * unit,
          borderColor: box.borderColor,
        },
        selected && styles.selected,
      ]}>
      {lines.brand ? (
        <Text
          style={[
            { fontFamily, color: s.textColor, fontSize: s.fontSize * unit * 0.85, letterSpacing: 1.2 * unit },
            shadow,
          ]}>
          {lines.brand}
        </Text>
      ) : null}
      {lines.name ? (
        <Text style={[{ fontFamily, color: s.textColor, fontSize: s.fontSize * unit }, shadow]}>{lines.name}</Text>
      ) : null}
      {lines.price ? (
        <Text
          style={[
            {
              fontFamily,
              color: s.textColor,
              fontSize: s.fontSize * unit * template.priceScale,
              marginTop: 1 * unit,
            },
            shadow,
          ]}>
          {lines.price}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignSelf: 'flex-start', maxWidth: 220, gap: 0 },
  selected: { outlineColor: '#3D8BFF', outlineWidth: 2, outlineStyle: 'solid' },
});
