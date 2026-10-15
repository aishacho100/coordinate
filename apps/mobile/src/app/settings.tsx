import { NotImplemented } from '@/components/not-implemented';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';

export default function SettingsScreen() {
  return (
    <Screen>
      <ThemedText type="smallBold">AIサービスへの画像送信について</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        AI解析を実行した場合のみ、写真を当社サーバー経由でAIサービスへ送信します。現在は解析機能が未実装のため、写真は送信されません。
      </ThemedText>
      <NotImplemented phase={5} description="改善データ利用の同意管理、保存データの削除、プライバシーポリシー・利用規約の表示は Phase 5〜6 で実装します。" />
    </Screen>
  );
}
