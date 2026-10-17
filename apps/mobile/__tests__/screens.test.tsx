import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import AnalyzingScreen from '@/app/analyzing';
import EditorScreen from '@/app/editor';
import ExportScreen from '@/app/export';
import HomeScreen from '@/app/index';
import ResultScreen from '@/app/result';
import SettingsScreen from '@/app/settings';
import { AnalysisProvider } from '@/features/analysis/analysis-context';
import { EditorProvider } from '@/features/editor/editor-context';
import { editorReducer, initialEditorState } from '@/features/editor/reducer';
import { AnalyzeError } from '@/lib/analyze-api';

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

const mockAnalyzePhoto = jest.fn();
jest.mock('@/lib/analyze-api', () => {
  const actual = jest.requireActual('@/lib/analyze-api');
  return { ...actual, analyzePhoto: (...args: unknown[]) => mockAnalyzePhoto(...args) };
});

const withProvider = (ui: ReactElement) => (
  <EditorProvider>
    <AnalysisProvider>{ui}</AnalysisProvider>
  </EditorProvider>
);

const loadedEditor = editorReducer(initialEditorState, {
  type: 'loadPhoto',
  photo: { uri: 'file:///a.jpg', width: 3000, height: 4000 },
});
const withPhoto = (ui: ReactElement) => (
  <EditorProvider initialState={loadedEditor}>
    <AnalysisProvider>{ui}</AnalysisProvider>
  </EditorProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ホーム', () => {
  it('写真を選ぶボタンがあり、未実装の注意書きは出さない', () => {
    render(withProvider(<HomeScreen />));
    expect(screen.getByText(/1枚選ぶだけ/)).toBeTruthy();
    expect(screen.getByLabelText('写真を選ぶ')).toBeTruthy();
    expect(screen.queryByText(/未実装/)).toBeNull();
    expect(screen.queryByLabelText('編集を続ける')).toBeNull();
  });

  it('写真を選ぶと AI 解析画面へ遷移する', async () => {
    mockPickPhoto.mockResolvedValue({ uri: 'file:///a.jpg', width: 3000, height: 4000 });
    render(withProvider(<HomeScreen />));
    fireEvent.press(screen.getByLabelText('写真を選ぶ'));
    await screen.findByLabelText('編集を続ける');
    expect(mockPush).toHaveBeenCalledWith('/analyzing');
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

describe('認識結果画面(骨組み)', () => {
  // Task 12 で置き換える
  it('未実装であることを明示する', () => {
    render(<ResultScreen />);
    expect(screen.getByText('未実装(Phase 3 で実装予定)')).toBeTruthy();
  });
});

describe('AI解析画面', () => {
  const response = {
    quality: { ok: true, issues: [] },
    items: [],
    model: 'claude-sonnet-5-5',
    usage: { inputTokens: 1, outputTokens: 1 },
    timings: { quality: 5, detect: 10, total: 16 },
  };

  it('表示と同時に解析を始め、成功したら結果画面へ進む', async () => {
    mockAnalyzePhoto.mockResolvedValue(response);
    render(withPhoto(<AnalyzingScreen />));
    expect(screen.getByText('解析しています')).toBeTruthy();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/result'));
    expect(mockAnalyzePhoto).toHaveBeenCalledWith('file:///a.jpg');
  });

  it('失敗したら利用者向けの文言と再試行・手動編集の導線を出す', async () => {
    mockAnalyzePhoto.mockRejectedValueOnce(new AnalyzeError('not_configured'));
    render(withPhoto(<AnalyzingScreen />));
    expect(await screen.findByText('解析サーバーが未設定です。')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();

    mockAnalyzePhoto.mockResolvedValueOnce(response);
    fireEvent.press(screen.getByLabelText('もう一度試す'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/result'));
  });

  it('解析せずに手動で編集へ進める', async () => {
    mockAnalyzePhoto.mockRejectedValue(new AnalyzeError('network'));
    render(withPhoto(<AnalyzingScreen />));
    await screen.findByLabelText('手動で編集する');
    fireEvent.press(screen.getByLabelText('手動で編集する'));
    expect(mockReplace).toHaveBeenCalledWith('/editor');
  });

  it('写真が無ければホームへ戻る導線を出す', () => {
    render(withProvider(<AnalyzingScreen />));
    expect(screen.getByText('解析する写真がありません。')).toBeTruthy();
    expect(mockAnalyzePhoto).not.toHaveBeenCalled();
  });
});

describe('設定', () => {
  it('AIサービスへの画像送信の説明がある', () => {
    render(<SettingsScreen />);
    expect(screen.getByText('AIサービスへの画像送信について')).toBeTruthy();
  });
});
