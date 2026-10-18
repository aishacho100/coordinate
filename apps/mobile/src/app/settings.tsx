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

  const [revokeFailed, setRevokeFailed] = useState(false);

  const revoke = async () => {
    try {
      await clearImageSearchConsent();
      setRevokeFailed(false);
      setConsent('unset');
    } catch {
      setRevokeFailed(true);
    }
  };

  return (
    <Screen>
      <View style={[styles.section, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <ThemedText type="smallBold">AIサービスへの画像送信について</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          解析を実行すると、写真を当社サーバー経由でAIサービスへ送ります。商品を探すときは、切り抜いた画像を外部の画像検索(SerpApi・Google)にも送ります。画像検索への同意は、下から取り消せます。
        </ThemedText>
      </View>

      <View style={[styles.section, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
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
        {revokeFailed ? (
          <ThemedText type="small" themeColor="error" accessibilityRole="alert">
            同意を取り消せませんでした。もう一度お試しください。
          </ThemedText>
        ) : null}
      </View>

      <NotImplemented phase={5} description="改善データ利用の同意管理、保存データの削除、プライバシーポリシー・利用規約の表示は Phase 5〜6 で実装します。" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  action: { paddingTop: Spacing.two },
});
