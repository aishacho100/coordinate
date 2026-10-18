import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ButtonMaxWidth, Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  label: string;
  /** 読み上げ用の名前。省略すると label を使う。 */
  accessibilityLabel?: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
};

/** 幅を絞った中央配置のボタン(文字を残す所だけで使う)。主要操作は金の塗り、副次操作は細い線。 */
export function AppButton({ label, accessibilityLabel, onPress, variant = 'primary', disabled = false }: Props) {
  const theme = useTheme();
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        primary
          ? { backgroundColor: theme.accent, borderColor: theme.accent }
          : { backgroundColor: 'transparent', borderColor: theme.border },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}>
      <ThemedText
        type="smallBold"
        style={[styles.label, { color: primary ? theme.onAccent : theme.text }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: ButtonMaxWidth,
    minHeight: 50,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  label: { fontFamily: Fonts.sansMedium, letterSpacing: 1.2 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
