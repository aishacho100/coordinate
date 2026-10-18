import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { NotImplemented } from '@/components/not-implemented';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  clearImageSearchConsent,
  getImageSearchConsent,
  type ImageSearchConsent,
} from '@/lib/image-search-consent';

const CONSENT_LABEL: Record<ImageSearchConsent, string> = {
  granted: '同意済み',
  declined: '画像は送らない',
  unset: '未設定',
};

export default function SettingsScreen() {
  const theme = useTheme();
  const [consent, setConsent] = useState<ImageSearchConsent | null>(null);

  useEffect(() => {
    let alive = true;
    void getImageSearchConsent().then((v) => alive && setConsent(v));
    return () => {
      alive = false;
    };
  }, []);

  const revoke = async () => {
    await clearImageSearchConsent();
    setConsent('unset');
  };

  return (
    <Screen>
      <ThemedText type="smallBold">AIサービスへの画像送信について</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        AI解析を実行した場合のみ、写真を当社サーバー経由でAIサービスへ送信します。現在は解析機能が未実装のため、写真は送信されません。
      </ThemedText>

      <View style={[styles.section, { borderColor: theme.border }]}>
        <ThemedText type="smallBold">画像検索の同意</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          商品を探すとき、切り抜いた画像を外部の画像検索(SerpApi・Google)に送ることへの同意です。
        </ThemedText>
        {consent ? (
          <ThemedText type="small" accessibilityLabel={`現在の状態: ${CONSENT_LABEL[consent]}`}>
            {`現在の状態: ${CONSENT_LABEL[consent]}`}
          </ThemedText>
        ) : null}
        {consent === 'granted' || consent === 'declined' ? (
          <View style={styles.action}>
            <AppButton label="同意を取り消す" variant="secondary" onPress={() => void revoke()} />
          </View>
        ) : null}
      </View>

      <NotImplemented phase={5} description="改善データ利用の同意管理、保存データの削除、プライバシーポリシー・利用規約の表示は Phase 5〜6 で実装します。" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two, paddingTop: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth * 2 },
  action: { paddingTop: Spacing.two },
});
