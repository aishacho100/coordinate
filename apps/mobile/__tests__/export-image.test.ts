import { Asset, requestPermissionsAsync } from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

import {
  ExportError,
  exportSize,
  mimeOf,
  renderToFile,
  saveToDevice,
  shareImage,
} from '@/features/export/export-image';

jest.mock('expo-media-library', () => ({ Asset: { create: jest.fn() }, requestPermissionsAsync: jest.fn() }));
const mockNative = jest.fn();
jest.mock('expo', () => ({ requireOptionalNativeModule: (name: string) => mockNative(name) }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn(), releaseCapture: jest.fn() }));

const permission = requestPermissionsAsync as jest.Mock;
const assetCreate = Asset.create as jest.Mock;
const isAvailable = Sharing.isAvailableAsync as jest.Mock;
const shareAsync = Sharing.shareAsync as jest.Mock;
const capture = captureRef as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockNative.mockReturnValue({}); // 既定ではネイティブモジュールがある環境
});

describe('exportSize / mimeOf', () => {
  it('幅 1080 を基準に比率から高さを決める', () => {
    expect(exportSize(4 / 5)).toEqual({ width: 1080, height: 1350 });
    expect(exportSize(1)).toEqual({ width: 1080, height: 1080 });
    expect(exportSize(9 / 16)).toEqual({ width: 1080, height: 1920 });
  });
  it('不正な比率は例外', () => {
    expect(() => exportSize(0)).toThrow();
    expect(() => exportSize(NaN)).toThrow();
  });
  it('MIMEタイプ', () => {
    expect(mimeOf('png')).toBe('image/png');
    expect(mimeOf('jpg')).toBe('image/jpeg');
  });
});

describe('renderToFile', () => {
  it('指定サイズ・形式で一時ファイルに書き出す', async () => {
    capture.mockResolvedValue('file:///tmp/out.png');
    const uri = await renderToFile({ current: null }, 'png', 0.8);
    expect(uri).toBe('file:///tmp/out.png');
    expect(capture).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ format: 'png', width: 1080, height: 1350, result: 'tmpfile' }),
    );
  });
  it('失敗時はユーザー向けメッセージの ExportError にする(内部エラーは漏らさない)', async () => {
    capture.mockRejectedValue(new Error('native: secret path /data/x'));
    const err = await renderToFile({ current: null }, 'jpg', 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExportError);
    expect((err as Error).message).not.toContain('secret');
  });
});

describe('saveToDevice', () => {
  it('書き込み専用の権限だけを要求して保存する', async () => {
    permission.mockResolvedValue({ granted: true });
    assetCreate.mockResolvedValue({});
    await saveToDevice('file:///tmp/out.png');
    expect(permission).toHaveBeenCalledWith(true);
    expect(assetCreate).toHaveBeenCalledWith('file:///tmp/out.png');
  });
  it('ネイティブモジュールが無い環境(Expo Go)ではライブラリを読み込まず共有を案内する', async () => {
    mockNative.mockReturnValue(null);
    await expect(saveToDevice('file:///x')).rejects.toThrow('共有から保存');
    expect(permission).not.toHaveBeenCalled();
    expect(mockNative).toHaveBeenCalledWith('ExpoMediaLibraryNext');
  });
  it('権限が拒否されたら保存せずメッセージを返す', async () => {
    permission.mockResolvedValue({ granted: false });
    await expect(saveToDevice('file:///x')).rejects.toThrow('許可されていません');
    expect(assetCreate).not.toHaveBeenCalled();
  });
  it('権限要求自体が失敗した環境では共有を案内する', async () => {
    permission.mockRejectedValue(new Error('unavailable'));
    await expect(saveToDevice('file:///x')).rejects.toThrow('共有から保存');
  });
  it('保存に失敗したら ExportError', async () => {
    permission.mockResolvedValue({ granted: true });
    assetCreate.mockRejectedValue(new Error('disk full'));
    await expect(saveToDevice('file:///x')).rejects.toBeInstanceOf(ExportError);
  });
});

describe('shareImage', () => {
  it('OS標準の共有シートを MIME 付きで開く', async () => {
    isAvailable.mockResolvedValue(true);
    shareAsync.mockResolvedValue(undefined);
    await shareImage('file:///x.png', 'png');
    expect(shareAsync).toHaveBeenCalledWith('file:///x.png', expect.objectContaining({ mimeType: 'image/png' }));
  });
  it('共有が使えない端末ではメッセージを返す', async () => {
    isAvailable.mockResolvedValue(false);
    await expect(shareImage('file:///x', 'jpg')).rejects.toThrow('共有機能を利用できません');
  });
  it('共有に失敗したら ExportError', async () => {
    isAvailable.mockResolvedValue(true);
    shareAsync.mockRejectedValue(new Error('x'));
    await expect(shareImage('file:///x', 'jpg')).rejects.toBeInstanceOf(ExportError);
  });
});
