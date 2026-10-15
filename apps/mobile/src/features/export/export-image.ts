import { requireOptionalNativeModule } from 'expo';
import * as Sharing from 'expo-sharing';
import type { RefObject } from 'react';
import type { View } from 'react-native';
import { captureRef, releaseCapture } from 'react-native-view-shot';

export type ExportFormat = 'png' | 'jpg';

export const EXPORT_WIDTH = 1080;

export function exportSize(ratio: number, width = EXPORT_WIDTH): { width: number; height: number } {
  if (!(ratio > 0)) throw new Error('画像の比率が不正です');
  return { width, height: Math.round(width / ratio) };
}

export function mimeOf(format: ExportFormat): string {
  return format === 'png' ? 'image/png' : 'image/jpeg';
}

export class ExportError extends Error {}

let lastCapture: string | null = null;

/** 画面に表示している合成結果(プレビュー)を、そのまま高解像度の画像として書き出す。 */
export async function renderToFile(
  ref: RefObject<View | null>,
  format: ExportFormat,
  ratio: number,
): Promise<string> {
  if (lastCapture) {
    try {
      releaseCapture(lastCapture);
    } catch {
      // 解放に失敗しても書き出しは続行する。
    }
    lastCapture = null;
  }
  const { width, height } = exportSize(ratio);
  try {
    const uri = await captureRef(ref, { format, quality: 0.95, width, height, result: 'tmpfile' });
    lastCapture = uri;
    return uri;
  } catch {
    throw new ExportError('画像の生成に失敗しました。もう一度お試しください。');
  }
}

/**
 * 端末の写真ライブラリへ保存する。書き込み専用の権限だけを要求する。
 * expo-media-library は読み込み時にネイティブモジュールを要求するため、保存時に遅延読み込みする。
 * (Expo Go など、ネイティブ部分を含まない環境でもアプリ全体が落ちないようにするため)
 */
export async function saveToDevice(uri: string): Promise<void> {
  let MediaLibrary: typeof import('expo-media-library');
  let granted = false;
  // ネイティブ部分が無い環境(Expo Go など)では require 自体がエラー報告を起こすため、先に有無を確認する。
  if (!requireOptionalNativeModule('ExpoMediaLibraryNext')) {
    throw new ExportError('写真ライブラリへの保存が、この環境では利用できません。共有から保存してください。');
  }
  try {
    // 遅延読み込み(上記の理由)。import() は jest-expo で変換されないため require を使う。
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    MediaLibrary = require('expo-media-library') as typeof import('expo-media-library');
    const permission = await MediaLibrary.requestPermissionsAsync(true);
    granted = permission.granted;
  } catch {
    throw new ExportError('写真ライブラリへの保存が、この環境では利用できません。共有から保存してください。');
  }
  if (!granted) {
    throw new ExportError('写真への保存が許可されていません。端末の設定で許可するか、共有から保存してください。');
  }
  try {
    await MediaLibrary.Asset.create(uri);
  } catch {
    throw new ExportError('端末への保存に失敗しました。空き容量を確認して、もう一度お試しください。');
  }
}

/** OS標準の共有シートを開く。 */
export async function shareImage(uri: string, format: ExportFormat): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new ExportError('この端末では共有機能を利用できません。');
  }
  try {
    await Sharing.shareAsync(uri, {
      mimeType: mimeOf(format),
      dialogTitle: 'コーデ画像を共有',
      UTI: format === 'png' ? 'public.png' : 'public.jpeg',
    });
  } catch {
    throw new ExportError('共有に失敗しました。もう一度お試しください。');
  }
}
