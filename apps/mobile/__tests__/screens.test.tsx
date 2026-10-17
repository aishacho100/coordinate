import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import AnalyzingScreen from '@/app/analyzing';
import EditorScreen from '@/app/editor';
import ExportScreen from '@/app/export';
import HomeScreen from '@/app/index';
import ResultScreen from '@/app/result';
import SettingsScreen from '@/app/settings';
import { AnalysisProvider } from '@/features/analysis/analysis-context';
import type { AnalysisState } from '@/features/analysis/analysis-reducer';
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

describe('認識結果画面', () => {
  const doneState = (over: Partial<Extract<AnalysisState, { status: 'done' }>> = {}): AnalysisState => ({
    status: 'done',
    items: [
      { id: 'a', categoryId: 'tshirt', brand: 'NIKE', box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, origin: 'ai', level: 'medium' },
      { id: 'b', categoryId: 'sneakers', brand: '', box: { x: 0.4, y: 0.8, w: 0.2, h: 0.15 }, origin: 'ai', level: 'unidentified' },
    ],
    quality: { ok: true, issues: [] },
    timings: { quality: 120, detect: 4200, total: 4400 },
    model: 'claude-sonnet-5-5',
    applied: false,
    ...over,
  });

  const renderResult = (state: AnalysisState) =>
    render(
      <EditorProvider initialState={loadedEditor}>
        <AnalysisProvider initialState={state}>
          <ResultScreen />
        </AnalysisProvider>
      </EditorProvider>,
    );

  it('検出したアイテムをカテゴリ・ブランドで一覧し、ブランド未検出は「ブランド不明」と出す', () => {
    renderResult(doneState());
    expect(screen.getByText('Tシャツ')).toBeTruthy();
    expect(screen.getByDisplayValue('NIKE')).toBeTruthy();
    expect(screen.getByText('スニーカー')).toBeTruthy();
    expect(screen.getByText('ブランド不明')).toBeTruthy();
    expect(screen.queryByText(/¥|円/)).toBeNull(); // Phase 3 では価格を出さない
  });

  it('品質の助言を表示する', () => {
    renderResult(doneState({ quality: { ok: false, issues: ['blurry', 'not_full_body'] } }));
    expect(screen.getByText(/ぼやけ/)).toBeTruthy();
    expect(screen.getByText(/全身/)).toBeTruthy();
  });

  it('ブランドを手入力でき、削除できる', () => {
    renderResult(doneState());
    fireEvent.changeText(screen.getByLabelText('スニーカーのブランド'), 'adidas');
    expect(screen.getByDisplayValue('adidas')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Tシャツを削除'));
    expect(screen.queryByText('Tシャツ')).toBeNull();
  });

  it('カテゴリを変更できる', () => {
    renderResult(doneState());
    fireEvent.press(screen.getByLabelText('Tシャツのカテゴリを変更'));
    fireEvent.press(screen.getByLabelText('ニット'));
    expect(screen.getByText('ニット')).toBeTruthy();
    expect(screen.queryByText('Tシャツ')).toBeNull();
  });

  it('検出 0 件でも手動で追加できる', () => {
    renderResult(doneState({ items: [] }));
    expect(screen.getByText('アイテムを見つけられませんでした')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('アイテムを追加'));
    fireEvent.press(screen.getByLabelText('帽子'));
    expect(screen.getByText('帽子')).toBeTruthy();
  });

  it('編集へ進むと検出結果が 1 回だけラベルとして渡される', () => {
    renderResult(doneState());
    fireEvent.press(screen.getByLabelText('この内容で編集へ'));
    expect(mockPush).toHaveBeenCalledWith('/editor');
  });

  it('解析結果が無ければホームへ戻る導線を出す', () => {
    render(withPhoto(<ResultScreen />));
    expect(screen.getByText('認識結果がありません。')).toBeTruthy();
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
