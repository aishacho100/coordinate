import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import AnalyzingScreen from '@/app/analyzing';
import EditorScreen from '@/app/editor';
import ExportScreen from '@/app/export';
import HomeScreen from '@/app/index';
import ResultScreen from '@/app/result';
import SettingsScreen from '@/app/settings';
import { EditorProvider } from '@/features/editor/editor-context';

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

const mockPickPhoto = jest.fn();
jest.mock('@/features/editor/photo-io', () => ({
  pickPhoto: (...args: unknown[]) => mockPickPhoto(...args),
  rotatePhoto90: jest.fn(),
}));

const withProvider = (ui: ReactElement) => <EditorProvider>{ui}</EditorProvider>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ホーム', () => {
  it('写真を選ぶボタンがあり、AI機能が準備中であることを明示する', () => {
    render(withProvider(<HomeScreen />));
    expect(screen.getByText(/1枚選ぶだけ/)).toBeTruthy();
    expect(screen.getByLabelText('写真を選ぶ')).toBeTruthy();
    expect(screen.getByText('未実装(Phase 3 で実装予定)')).toBeTruthy();
    expect(screen.queryByLabelText('編集を続ける')).toBeNull();
  });

  it('写真を選ぶと編集画面へ遷移する', async () => {
    mockPickPhoto.mockResolvedValue({ uri: 'file:///a.jpg', width: 3000, height: 4000 });
    render(withProvider(<HomeScreen />));
    fireEvent.press(screen.getByLabelText('写真を選ぶ'));
    await screen.findByLabelText('編集を続ける');
    expect(mockPush).toHaveBeenCalledWith('/editor');
  });

  it('選択をキャンセルしたら遷移しない', async () => {
    mockPickPhoto.mockResolvedValue(null);
    render(withProvider(<HomeScreen />));
    fireEvent.press(screen.getByLabelText('写真を選ぶ'));
    await screen.findByLabelText('写真を選ぶ');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('読み込みに失敗したらエラーを表示する', async () => {
    mockPickPhoto.mockRejectedValue(new Error('boom'));
    render(withProvider(<HomeScreen />));
    fireEvent.press(screen.getByLabelText('写真を選ぶ'));
    expect(await screen.findByText('写真を読み込めませんでした。別の写真でお試しください。')).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('写真が無い状態', () => {
  it('編集画面はホームへ戻る導線を出す', () => {
    render(withProvider(<EditorScreen />));
    expect(screen.getByText('編集する写真がありません。')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('ホームに戻る'));
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('書き出し画面はホームへ戻る導線を出す', () => {
    render(withProvider(<ExportScreen />));
    expect(screen.getByText('書き出す画像がありません。')).toBeTruthy();
  });
});

describe('未実装の画面', () => {
  it.each([
    ['analyzing', AnalyzingScreen, 3],
    ['result', ResultScreen, 3],
  ])('%s は未実装であることを明示する', (_name, Component, phase) => {
    render(<Component />);
    expect(screen.getByText(`未実装(Phase ${phase} で実装予定)`)).toBeTruthy();
  });
});

describe('設定', () => {
  it('AIサービスへの画像送信の説明がある', () => {
    render(<SettingsScreen />);
    expect(screen.getByText('AIサービスへの画像送信について')).toBeTruthy();
  });
});
