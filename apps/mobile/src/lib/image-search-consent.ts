import { File, Paths } from 'expo-file-system';

export type ImageSearchConsent = 'granted' | 'declined' | 'unset';

const FILE_NAME = 'image-search-consent.txt';

/** 保存できなかったときも、その起動中は選択を覚えておくためのメモリ上の値。 */
let cached: ImageSearchConsent | null = null;

const file = () => new File(Paths.document, FILE_NAME);

/**
 * 画像検索(切り抜き画像を SerpApi・Google へ送る)への同意。端末に保存する。
 * 読み書きに失敗してもアプリは動く(読めなければ 'unset'、書けなければその起動中だけ保持する)。
 */
export async function getImageSearchConsent(): Promise<ImageSearchConsent> {
  if (cached) return cached;
  try {
    const f = file();
    if (f.exists) {
      const text = (await f.text()).trim();
      if (text === 'granted' || text === 'declined') return (cached = text);
    }
    return (cached = 'unset');
  } catch {
    return 'unset';
  }
}

export async function setImageSearchConsent(value: 'granted' | 'declined'): Promise<void> {
  cached = value;
  try {
    const f = file();
    f.create({ overwrite: true });
    f.write(value);
  } catch {
    // 保存できなくても、この起動中は cached の値で動く。
  }
}

/** 同意(または「送らない」の選択)を消し、未設定に戻す。 */
export async function clearImageSearchConsent(): Promise<void> {
  cached = 'unset';
  try {
    const f = file();
    if (f.exists) f.delete();
  } catch {
    // 消せなかった場合も、この起動中は未設定として扱う。
  }
}
