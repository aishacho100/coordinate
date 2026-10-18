import type { IdentifyCandidate, IdentifyResponse, IdentifyVerdict, SearchStatus } from '@coordinate/shared';
import { Image } from 'expo-image';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { formatAsOf, formatPrice } from '@/lib/format-price';
import { useTheme } from '@/hooks/use-theme';

const HEADING: Record<IdentifyVerdict, string> = {
  identified: '特定できました',
  candidates: '候補が見つかりました',
  unidentified: '特定できませんでした',
};

const SUBTEXT: Partial<Record<IdentifyVerdict, string>> = {
  candidates: '似ている商品です。同じ商品と断定はできません。',
  unidentified: '手がかりが足りず、商品名やブランドを決められませんでした。',
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
  const unavailable = (['lens', 'serpapi', 'rakuten'] as const)
    .filter((k) => response.searches[k] !== 'ok')
    .map((k) => {
      const status = response.searches[k] as Exclude<SearchStatus, 'ok'>;
      if (k === 'lens' && status === 'not_consented') return '画像検索は使っていません(同意が必要です)。';
      return `${SEARCH_SUBJECT[k]}${SEARCH_REASON[status]}。`;
    });
  const subtext = SUBTEXT[response.verdict];
  // 楽天の結果を表示しているときだけ出す(Lens だけで足りて楽天を使っていないときは出さない)。
  const showRakutenCredit =
    response.verdict !== 'unidentified' && response.candidates.some((c) => c.product.source === 'rakuten');

  return (
    <View style={styles.wrap}>
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

      {response.verdict !== 'unidentified' && response.candidates.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {response.candidates.map((c) => (
            <Candidate key={`${c.product.source}:${c.product.productId}`} candidate={c} />
          ))}
        </ScrollView>
      ) : null}

      {unavailable.length > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {unavailable.join('')}
        </ThemedText>
      ) : null}

      {showRakutenCredit ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Supported by Rakuten Developers"
          onPress={() => void Linking.openURL(RAKUTEN_CREDIT_URL)}
          hitSlop={12}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.credit}>
            Supported by Rakuten Developers
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

function hostnameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

function Candidate({ candidate }: { candidate: IdentifyCandidate }) {
  const theme = useTheme();
  const { product, matched, unconfirmed } = candidate;
  const price = product.price;
  const priceLabel = PRICE_LABEL[product.source];
  const asOf = price ? formatAsOf(price.fetchedAt) : '';
  // Lens の販売元は外部の文字列で遷移先を偽れるため、リンク文言には実際の遷移先のホスト名を使う。
  const lensHost = product.source === 'google_lens' ? hostnameOf(product.pageUrl) : null;

  const linkLabel =
    product.source === 'google_shopping'
      ? 'Google ショッピングで見る'
      : product.source === 'rakuten'
        ? '楽天市場で見る'
        : product.source === 'google_lens'
          ? lensHost
            ? `${lensHost}で見る`
            : '商品ページを見る'
          : null;

  const same = candidate.matchType === 'identical';

  return (
    <View style={[styles.candidate, { backgroundColor: theme.backgroundElement }]}>
      <View style={[styles.imageBox, { backgroundColor: theme.backgroundSelected }]}>
        {product.imageUrl ? (
          <Image
            source={{ uri: product.imageUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            accessibilityIgnoresInvertColors
          />
        ) : null}
      </View>
      <View style={styles.body}>
        <ThemedText type="small" style={styles.productName} numberOfLines={2} ellipsizeMode="tail">
          {product.name}
        </ThemedText>
        <View style={styles.priceRow}>
          {price ? (
            <ThemedText type="subtitle" style={styles.price}>
              {formatPrice(price.amount, price.currency)}
            </ThemedText>
          ) : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.noPrice}>
              価格は取得できませんでした
            </ThemedText>
          )}
          <View accessible accessibilityLabel={same ? '写真と同じ' : '似ている'} style={styles.mark}>
            <Icon name={same ? 'check' : 'similar'} size={18} color={same ? Colors.accent : Colors.textSecondary} />
          </View>
        </View>
        {price && priceLabel ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.fine}>
            {priceLabel}
          </ThemedText>
        ) : null}
        {price && asOf ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.fine} numberOfLines={1}>
            {asOf}
          </ThemedText>
        ) : null}
        {product.seller ? (
          <ThemedText
            type="small"
            themeColor="textSecondary"
            style={styles.fine}
            numberOfLines={1}
            ellipsizeMode="tail">
            {product.seller}
          </ThemedText>
        ) : null}
        {matched.length > 0 ? (
          <ThemedText type="small" style={styles.fine}>{`一致した点: ${matched.join('、')}`}</ThemedText>
        ) : null}
        {unconfirmed.length > 0 ? (
          <ThemedText
            type="small"
            themeColor="textSecondary"
            style={styles.fine}>{`確認できていない点: ${unconfirmed.join('、')}`}</ThemedText>
        ) : null}
        {product.pageUrl && linkLabel ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={linkLabel}
            onPress={() => void Linking.openURL(product.pageUrl as string)}
            hitSlop={12}
            style={styles.link}>
            <ThemedText
              type="smallBold"
              numberOfLines={1}
              style={[styles.fine, styles.linkText, { borderBottomColor: theme.text }]}>
              {linkLabel}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const CARD_W = 176;

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  row: { gap: Spacing.two, paddingVertical: Spacing.one },
  candidate: { width: CARD_W, borderRadius: 14, padding: Spacing.two, gap: Spacing.two },
  imageBox: { width: '100%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden' },
  body: { gap: Spacing.half },
  productName: { fontSize: 13, lineHeight: 19 },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.one },
  price: { fontSize: 17, lineHeight: 26, flexShrink: 1 },
  noPrice: { flexShrink: 1, fontSize: 12 },
  mark: { minWidth: 24, minHeight: 24, alignItems: 'center', justifyContent: 'center' },
  fine: { fontSize: 11, lineHeight: 17, letterSpacing: 0.2 },
  link: { alignSelf: 'flex-start', paddingTop: Spacing.one },
  linkText: { borderBottomWidth: StyleSheet.hairlineWidth * 2 },
  credit: { fontSize: 11, lineHeight: 16, letterSpacing: 0.6 },
});
