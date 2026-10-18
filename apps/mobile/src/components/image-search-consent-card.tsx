import { StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export const IMAGE_SEARCH_CONSENT_TEXT =
  '商品を探すため、切り抜いた画像を外部の画像検索(SerpApi・Google)に送ります。写真全体ではなく、アイテムの部分だけです。当社のサーバーには保存されません。SerpApi が送った画像を保持する期間は公表されていません。';

type Props = {
  onGrant: () => void;
  onDecline: () => void;
};

/** 最初に「商品を探す」を押したときに、アイテムのカードの中へ出す同意の説明。 */
export function ImageSearchConsentCard({ onGrant, onDecline }: Props) {
  const theme = useTheme();
  return (
    <View style={[styles.wrap, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <ThemedText type="eyebrow" themeColor="textSecondary">
        Image search
      </ThemedText>
      <ThemedText type="small" style={styles.body}>
        {IMAGE_SEARCH_CONSENT_TEXT}
      </ThemedText>
      <View style={styles.buttons}>
        <AppButton label="同意して探す" onPress={onGrant} />
        <AppButton label="画像を送らずに探す" variant="secondary" onPress={onDecline} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  body: { lineHeight: 22, fontSize: 12.5 },
  buttons: { gap: Spacing.two, paddingTop: Spacing.two },
});
