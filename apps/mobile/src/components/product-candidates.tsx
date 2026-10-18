import type { IdentifyCandidate, IdentifyResponse, IdentifyVerdict, SearchStatus } from '@coordinate/shared';
import { Image } from 'expo-image';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatAsOf, formatPrice } from '@/lib/format-price';
import { useTheme } from '@/hooks/use-theme';

const HEADING: Record<IdentifyVerdict, string> = {
  identified: '特定できました',
  candidates: '候補が見つかりました',
  unidentified: '特定できませんでした',
};

const SUBTEXT: Partial<Record<IdentifyVerdict, string>> = {
  candidates: '似ている商品です。同じ商品とは確認できていません。',
  unidentified: '写真から読み取れる手がかりが足りず、商品名やブランドは決められませんでした。',
};

const SEARCH_SUBJECT = { lens: '画像検索は', serpapi: 'Google ショッピングの検索は', rakuten: '楽天市場の検索は' } as const;
const SEARCH_REASON: Record<Exclude<SearchStatus, 'ok'>, string> = {
  not_consented: '同意が必要です',
  not_configured: '未設定です',
  budget_exhausted: '今月の上限に達しました',
  failed: '失敗しました',
};

const PRICE_LABEL: Record<string, string> = {
  rakuten: '楽天市場の販売価格',
  google_shopping: 'Google ショッピングの表示価格',
};

const RAKUTEN_CREDIT_URL = 'https://developers.rakuten.com';

/** 商品特定の結果。確信度の数値は出さない(並び順は API 側で済んでいる)。 */
export function ProductCandidates({ response }: { response: IdentifyResponse }) {
  const theme = useTheme();
  const unavailable = (['lens', 'serpapi', 'rakuten'] as const)
    .filter((k) => response.searches[k] !== 'ok')
    .map((k) => {
      const status = response.searches[k] as Exclude<SearchStatus, 'ok'>;
      // 「画像検索は同意が必要です」ではなく「画像検索には同意が必要です」と読ませる。
      if (k === 'lens' && status === 'not_consented') return '画像検索には同意が必要です。';
      return `${SEARCH_SUBJECT[k]}${SEARCH_REASON[status]}。`;
    });
  const subtext = SUBTEXT[response.verdict];

  return (
    <View style={[styles.wrap, { borderColor: theme.border }]}>
      <ThemedText type="subtitle">{HEADING[response.verdict]}</ThemedText>
      {subtext ? (
        <ThemedText type="small" themeColor="textSecondary">
          {subtext}
        </ThemedText>
      ) : null}
      {response.comparison === 'failed' ? (
        <ThemedText type="small" themeColor="textSecondary">
          画像との照合ができなかったため、確定できません
        </ThemedText>
      ) : null}

      {response.verdict !== 'unidentified'
        ? response.candidates.map((c) => <Candidate key={`${c.product.source}:${c.product.productId}`} candidate={c} />)
        : null}

      {unavailable.length > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {unavailable.join('')}
        </ThemedText>
      ) : null}

      {response.searches.rakuten === 'ok' ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Supported by Rakuten Developers"
          onPress={() => void Linking.openURL(RAKUTEN_CREDIT_URL)}
          hitSlop={8}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.credit}>
            Supported by Rakuten Developers
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

function Candidate({ candidate }: { candidate: IdentifyCandidate }) {
  const theme = useTheme();
  const { product, matched, unconfirmed } = candidate;
  const price = product.price;
  const priceLabel = PRICE_LABEL[product.source];
  const asOf = price ? formatAsOf(price.fetchedAt) : '';
  const priceNote = [priceLabel, asOf].filter(Boolean).join(' ・ ');

  const linkLabel =
    product.source === 'google_shopping'
      ? `Google ショッピングで見る${product.seller ? `(販売元: ${product.seller})` : ''}`
      : product.source === 'rakuten'
        ? '楽天市場で見る'
        : null;

  return (
    <View style={[styles.candidate, { borderColor: theme.border }]}>
      {product.imageUrl ? (
        <Image
          source={{ uri: product.imageUrl }}
          style={[styles.thumb, { backgroundColor: theme.backgroundElement }]}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <View style={styles.body}>
        <ThemedText type="default" style={styles.productName}>
          {product.name}
        </ThemedText>
        {price ? (
          <View>
            <ThemedText type="subtitle">{formatPrice(price.amount, price.currency)}</ThemedText>
            {priceNote ? (
              <ThemedText type="small" themeColor="textSecondary">
                {priceNote}
              </ThemedText>
            ) : null}
          </View>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            価格は取得できませんでした
          </ThemedText>
        )}
        {product.seller ? (
          <ThemedText type="small" themeColor="textSecondary">
            {product.seller}
          </ThemedText>
        ) : null}
        {matched.length > 0 ? <ThemedText type="small">{`一致した点: ${matched.join('、')}`}</ThemedText> : null}
        {unconfirmed.length > 0 ? (
          <ThemedText type="small" themeColor="textSecondary">{`確認できていない点: ${unconfirmed.join('、')}`}</ThemedText>
        ) : null}
        {product.pageUrl && linkLabel ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={linkLabel}
            onPress={() => void Linking.openURL(product.pageUrl as string)}
            hitSlop={8}
            style={styles.link}>
            <ThemedText type="smallBold" style={[styles.linkText, { borderBottomColor: theme.text }]}>
              {linkLabel}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two, paddingTop: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth * 2 },
  candidate: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
  },
  thumb: { width: 72, height: 72, borderRadius: 8 },
  body: { flex: 1, gap: Spacing.one },
  productName: { fontSize: 14, lineHeight: 22 },
  link: { alignSelf: 'flex-start', paddingTop: Spacing.one },
  linkText: { borderBottomWidth: StyleSheet.hairlineWidth * 2 },
  credit: { fontSize: 11, lineHeight: 16, letterSpacing: 0.6 },
});
