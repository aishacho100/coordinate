import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { Colors, Fonts } from '@/constants/theme';

/** 長押しで出す名前を自動で消すまでの時間(ms)。 */
export const TOOLTIP_MS = 2200;
const TIP_W = 140;

type Props = {
  icon: IconName;
  /** 読み上げ名。長押しで小さく見せる名前も同じ。必須。 */
  accessibilityLabel: string;
  onPress: () => void;
  /** main: 金の丸(いま押すもの)。outline: 細い枠の丸。plain: 枠なしの細い線。 */
  variant?: 'main' | 'plain' | 'outline';
  disabled?: boolean;
  /** main / outline の直径。既定 56。plain は 44 固定。 */
  size?: number;
  tooltipPlacement?: 'above' | 'below';
};

/** アイコンだけのボタン(44pt 以上)。文字ラベルは出さず、長押しで名前を一時表示する。 */
export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  variant = 'plain',
  disabled = false,
  size = 56,
  tooltipPlacement = 'above',
}: Props) {
  const main = variant === 'main';
  const outline = variant === 'outline';
  const box = main || outline ? Math.max(size, 44) : 44;
  const [tip, setTip] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const showTip = () => {
    setTip(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTip(false), TOOLTIP_MS);
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onLongPress={showTip}
        style={({ pressed }) => [
          styles.base,
          { width: box, height: box, borderRadius: box / 2 },
          main && { backgroundColor: Colors.accent },
          outline && styles.outline,
          pressed && styles.pressed,
          disabled && styles.disabled,
        ]}>
        <Icon name={icon} size={main ? 26 : 24} color={main ? Colors.onAccent : Colors.text} />
      </Pressable>
      {tip ? (
        <View
          pointerEvents="none"
          style={[styles.tip, { left: (box - TIP_W) / 2 }, tooltipPlacement === 'above' ? { bottom: box + 6 } : { top: box + 6 }]}>
          <Text style={styles.tipText} numberOfLines={1}>
            {accessibilityLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  base: { alignItems: 'center', justifyContent: 'center' },
  outline: { borderWidth: 1, borderColor: Colors.textSecondary },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  tip: {
    position: 'absolute',
    width: TIP_W,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Colors.backgroundElement,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  tipText: { color: Colors.text, fontFamily: Fonts.sans, fontSize: 11, letterSpacing: 0.4 },
});
