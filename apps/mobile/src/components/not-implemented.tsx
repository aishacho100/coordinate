import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = { phase: number; description: string };

/** 未実装機能を実装済みのように見せないための表示。 */
export function NotImplemented({ phase, description }: Props) {
  const theme = useTheme();
  return (
    <ThemedView style={[styles.box, { borderColor: theme.border }]}>
      <ThemedText type="smallBold">未実装(Phase {phase} で実装予定)</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {description}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  box: {
    padding: Spacing.three,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderStyle: 'dashed',
    gap: Spacing.one,
  },
});
