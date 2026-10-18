import { File, Paths } from 'expo-file-system';

let cached: string | null = null;

function randomId(): string {
  const hex = () => Math.random().toString(16).slice(2, 10).padEnd(8, '0');
  return `${hex()}-${hex()}-${hex()}-${hex()}`;
}

/**
 * このインストールを区別する匿名の ID。利用回数の上限のために使う。個人情報ではなく、認証でもない。
 * 保存できなくても動作は続ける(その起動中だけの ID になる)。
 */
export async function getInstallId(): Promise<string> {
  if (cached) return cached;
  try {
    const file = new File(Paths.document, 'install-id.txt');
    if (file.exists) {
      const text = (await file.text()).trim();
      if (/^[A-Za-z0-9-]{16,64}$/.test(text)) return (cached = text);
    }
    const id = randomId();
    file.create({ overwrite: true });
    file.write(id);
    return (cached = id);
  } catch {
    return (cached = randomId());
  }
}
