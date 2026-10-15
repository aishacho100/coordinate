import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import type { Photo } from './reducer';

/** 取り込み時の長辺の上限(px)。端末のメモリと処理時間を抑えつつ、投稿画像として十分な解像度を保つ。 */
export const MAX_PHOTO_SIDE = 3000;

/**
 * OS標準の写真ピッカーで1枚選ぶ。ピッカーは権限を要求しない。
 * キャンセル時は null。
 */
export async function pickPhoto(): Promise<Photo | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    allowsEditing: false,
    quality: 1,
    exif: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  return normalizePhoto(asset.uri);
}

/**
 * 向き(EXIF)を画素に反映して再エンコードし、位置情報などのメタデータを取り除く。
 * 長辺が上限を超える場合は縮小する。
 */
export async function normalizePhoto(uri: string): Promise<Photo> {
  const source = await ImageManipulator.manipulate(uri).renderAsync();
  const longSide = Math.max(source.width, source.height);
  let image = source;
  if (longSide > MAX_PHOTO_SIDE) {
    const scale = MAX_PHOTO_SIDE / longSide;
    const size =
      source.width >= source.height
        ? { width: Math.round(source.width * scale) }
        : { height: Math.round(source.height * scale) };
    image = await ImageManipulator.manipulate(source).resize(size).renderAsync();
  }
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

/** 時計回りに90度回転した新しい写真を作る。 */
export async function rotatePhoto90(photo: Photo): Promise<Photo> {
  const rotated = await ImageManipulator.manipulate(photo.uri).rotate(90).renderAsync();
  const saved = await rotated.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}
