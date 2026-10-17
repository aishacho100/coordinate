import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function Chip({
  label,
  selected,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** 表示名だけでは対象が分からないとき(例: 「削除」)の読み上げ名。省略時は label。 */
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.chip,
        selected
          ? { backgroundColor: theme.text, borderColor: theme.text }
          : { backgroundColor: 'transparent', borderColor: theme.border },
      ]}>
      <ThemedText type="small" style={{ color: selected ? theme.background : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

export function SwitchRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <ThemedText type="small">{label}</ThemedText>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: theme.backgroundSelected, true: theme.text }}
        thumbColor={theme.background}
      />
    </View>
  );
}

export function Stepper({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const theme = useTheme();
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v * 100) / 100)));
  return (
    <View style={styles.row}>
      <ThemedText type="small">{label}</ThemedText>
      <View style={styles.stepper}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}を減らす`}
          onPress={() => set(value - step)}
          style={[styles.stepBtn, { borderColor: theme.border }]}>
          <ThemedText>−</ThemedText>
        </Pressable>
        <ThemedText type="small" style={styles.stepValue}>
          {format ? format(value) : String(value)}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}を増やす`}
          onPress={() => set(value + step)}
          style={[styles.stepBtn, { borderColor: theme.border }]}>
          <ThemedText>＋</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

export function Swatches({
  label,
  colors,
  value,
  onChange,
}: {
  label: string;
  colors: readonly string[];
  value: string;
  onChange: (c: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText type="small">{label}</ThemedText>
      <View style={styles.swatches}>
        {colors.map((c) => (
          <Pressable
            key={c}
            accessibilityRole="button"
            accessibilityLabel={`${label} ${c}`}
            accessibilityState={{ selected: c.toLowerCase() === value.toLowerCase() }}
            onPress={() => onChange(c)}
            style={[
              styles.swatch,
              { backgroundColor: c, borderColor: c.toLowerCase() === value.toLowerCase() ? theme.text : theme.border },
              c.toLowerCase() === value.toLowerCase() && styles.swatchOn,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { minWidth: 44, textAlign: 'center' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth * 2 },
  swatchOn: { borderWidth: 2 },
});
