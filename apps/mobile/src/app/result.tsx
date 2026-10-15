import { useRouter } from 'expo-router';

import { AppButton } from '@/components/app-button';
import { NotImplemented } from '@/components/not-implemented';
import { Screen } from '@/components/screen';

export default function ResultScreen() {
  const router = useRouter();
  return (
    <Screen>
      <NotImplemented phase={3} description="アイテムカード、確度別表示、候補選択・手動修正は Phase 3〜5 で実装します。" />
      <AppButton label="編集へ" onPress={() => router.push('/editor')} />
    </Screen>
  );
}
