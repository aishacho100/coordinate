import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import AnalyzingScreen from '@/app/analyzing';
import EditorScreen from '@/app/editor';
import ExportScreen from '@/app/export';
import HomeScreen from '@/app/index';
import ResultScreen from '@/app/result';
import SettingsScreen from '@/app/settings';
import { AnalysisProvider } from '@/features/analysis/analysis-context';
import type { AnalysisState } from '@/features/analysis/analysis-reducer';
import { EditorProvider, useEditor } from '@/features/editor/editor-context';
import { editorReducer, initialEditorState } from '@/features/editor/reducer';
import { AnalyzeError } from '@/lib/analyze-api';
import type { DetectedItem, IdentifyResponse } from '@coordinate/shared';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockNavDispatch = jest.fn();
const mockNavigation = { dispatch: (...args: unknown[]) => mockNavDispatch(...args) };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useNavigation: () => mockNavigation,
}));

// 戻る操作の阻止は実機の navigator が無いと動かないので、引数(阻止するか・阻止したときの処理)だけ取り出して確かめる。
let mockPrevent: { prevent: boolean; onPrevented: (o: { data: { action: unknown } }) => void } | null = null;
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (prevent: boolean, onPrevented: (o: { data: { action: unknown } }) => void) => {
    mockPrevent = { prevent, onPrevented };
  },
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

const mockCropItem = jest.fn();
jest.mock('@/features/analysis/crop-item', () => ({
  cropItem: (...args: unknown[]) => mockCropItem(...args),
}));

const mockIdentifyItem = jest.fn();
jest.mock('@/lib/identify-api', () => ({
  identifyItem: (...args: unknown[]) => mockIdentifyItem(...args),
}));

let mockConsent: 'granted' | 'declined' | 'unset' = 'declined';
let mockClearFails = false;
jest.mock('@/lib/image-search-consent', () => ({
  getImageSearchConsent: async () => mockConsent,
  setImageSearchConsent: async (v: 'granted' | 'declined') => {
    mockConsent = v;
  },
  clearImageSearchConsent: async () => {
    if (mockClearFails) throw new Error('clear');
    mockConsent = 'unset';
  },
}));

const safeMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const withProvider = (ui: ReactElement) => (
  <SafeAreaProvider initialMetrics={safeMetrics}>
    <EditorProvider>
      <AnalysisProvider>{ui}</AnalysisProvider>
    </EditorProvider>
  </SafeAreaProvider>
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
  mockConsent = 'declined';
});

describe('ホーム', () => {
  it('写真を選ぶボタンがあり、未実装の注意書きは出さない', () => {
    render(withProvider(<HomeScreen />));
    expect(screen.queryByText(/1枚選ぶだけ/)).toBeNull();
    expect(screen.getByLabelText('設定')).toBeTruthy();
    expect(screen.getByLabelText('写真を選ぶ')).toBeTruthy();
    expect(screen.queryByText(/未実装/)).toBeNull();
    expect(screen.queryByLabelText('編集を続ける')).toBeNull();
  });

  it('設定アイコンから設定画面へ進む', () => {
    render(withProvider(<HomeScreen />));
    fireEvent.press(screen.getByLabelText('設定'));
    expect(mockPush).toHaveBeenCalledWith('/settings');
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
      { id: 'a', categoryId: 'tshirt', brand: 'NIKE', box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, origin: 'ai', level: 'medium', detected: null, identify: { status: 'idle' } },
      { id: 'b', categoryId: 'sneakers', brand: '', box: { x: 0.4, y: 0.8, w: 0.2, h: 0.15 }, origin: 'ai', level: 'unidentified', detected: null, identify: { status: 'idle' } },
    ],
    quality: { ok: true, issues: [] },
    timings: { quality: 120, detect: 4200, total: 4400 },
    model: 'claude-sonnet-5-5',
    applied: false,
    dirty: false,
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
    // 先頭のアイテムが選ばれていて、下にカテゴリとブランドを出す。ブランドは写真の上のタグにも出る。
    expect(screen.getByText('Tシャツ')).toBeTruthy();
    expect(screen.getAllByText('NIKE').length).toBeGreaterThan(0);
    expect(screen.queryByText('ブランド不明')).toBeNull();
    // 切り抜きのサムネイルで選び直す。
    fireEvent.press(screen.getByLabelText('スニーカーを選ぶ'));
    expect(screen.getByText('スニーカー')).toBeTruthy();
    expect(screen.getByText('ブランド不明')).toBeTruthy();
    expect(screen.getByLabelText('スニーカーを選ぶ').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.queryByText(/¥|円/)).toBeNull(); // Phase 3 では価格を出さない
  });

  it('写真は画面高の約 4 割までに収め、アスペクトを保ち、点は写真の表示サイズの割合で置く', () => {
    const spy = jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({ width: 411, height: 914, scale: 2.625, fontScale: 1 });
    try {
      renderResult(doneState());
      const style = StyleSheet.flatten(screen.getByTestId('result-photo').props.style);
      expect(style.height).toBeLessThanOrEqual(914 * 0.45);
      expect(style.width / style.height).toBeCloseTo(3000 / 4000);
      expect(style.width).toBeLessThanOrEqual(411);
      // アイテム a(中心 0.35, 0.35)の点は、写真の枠の 35% の位置。
      const tree = JSON.stringify(screen.toJSON());
      expect(tree).toContain('"left":"35%"');
      expect(tree).toContain('"top":"35%"');
    } finally {
      spy.mockRestore();
    }
  });

  it('品質の助言を表示する', () => {
    renderResult(doneState({ quality: { ok: false, issues: ['blurry', 'not_full_body'] } }));
    expect(screen.getByText(/ぼやけ/)).toBeTruthy();
    expect(screen.getByText(/全身/)).toBeTruthy();
  });

  it('ブランドを手入力でき、削除できる', () => {
    renderResult(doneState());
    fireEvent.press(screen.getByLabelText('スニーカーを選ぶ'));
    fireEvent.press(screen.getByLabelText('スニーカーを編集'));
    fireEvent.changeText(screen.getByLabelText('スニーカーのブランド'), 'adidas');
    expect(screen.getByDisplayValue('adidas')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('スニーカーを削除'));
    expect(screen.queryByLabelText('スニーカーを選ぶ')).toBeNull();
    // 削除すると先頭のアイテムが選ばれる。
    expect(screen.getByText('Tシャツ')).toBeTruthy();
  });

  it('カテゴリを変更できる', () => {
    renderResult(doneState());
    fireEvent.press(screen.getByLabelText('Tシャツを編集'));
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

  it('編集へ進むと検出結果が 1 回だけラベルとして渡される(戻って再度押しても増えない)', () => {
    let labels: { itemId: string | null; brand: string; name: string }[] = [];
    function Probe() {
      labels = useEditor().snapshot?.doc.labels ?? [];
      return null;
    }
    render(
      <EditorProvider initialState={loadedEditor}>
        <AnalysisProvider initialState={doneState()}>
          <ResultScreen />
          <Probe />
        </AnalysisProvider>
      </EditorProvider>,
    );
    fireEvent.press(screen.getByLabelText('この内容で編集へ'));
    expect(mockPush).toHaveBeenCalledWith('/editor');
    expect(labels.map((l) => [l.itemId, l.brand, l.name])).toEqual([
      ['a', 'NIKE', 'Tシャツ'],
      ['b', '', 'スニーカー'],
    ]);
    fireEvent.press(screen.getByLabelText('この内容で編集へ'));
    expect(labels).toHaveLength(2);
  });

  describe('商品を探す', () => {
    const detected: DetectedItem = {
      id: 'a',
      categoryId: 'tshirt',
      box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
      appearance: { colors: ['white'], visibleText: ['NIKE'] },
      brandCandidates: [{ name: 'NIKE', score: 0.8 }],
      candidates: [],
      confidence: { detection: 0.9, category: 0.9, brand: 0.8, model: null, variant: null, price: null },
      level: 'medium',
      reviewState: 'auto',
      rationale: '',
      modelVersion: 'm',
    };
    const identified: IdentifyResponse = {
      itemId: 'a',
      verdict: 'candidates',
      level: 'low',
      rationale: '',
      candidates: [
        {
          product: {
            source: 'rakuten',
            productId: 'r1',
            brand: '',
            name: '無地Tシャツ',
            pageUrl: 'https://item.rakuten.co.jp/shop/t1/',
            price: { amount: 7590, currency: 'JPY', kind: 'list', fetchedAt: '2026-10-18T00:00:00.000Z' },
            fetchedAt: '2026-10-18T00:00:00.000Z',
          },
          matchScore: 0.5,
          matchType: 'similar',
          matched: ['色'],
          unconfirmed: [],
        },
      ],
      searches: { serpapi: 'not_configured', rakuten: 'ok', lens: 'ok' },
      comparison: 'done',
      queries: ['q'],
      usage: { claude: { inputTokens: 1, outputTokens: 1 }, serpapiSearches: 0, rakutenCalls: 1, lensSearches: 1 },
      estimatedCostUsd: 0.01,
      fetchedAt: '2026-10-18T00:00:00.000Z',
      timings: { total: 100 },
    };
    const aiState = (): AnalysisState => ({
      status: 'done',
      items: [
        { id: 'a', categoryId: 'tshirt', brand: 'NIKE', box: detected.box, origin: 'ai', level: 'medium', detected, identify: { status: 'idle' } },
        { id: 'm', categoryId: 'hat', brand: '', box: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, origin: 'manual', level: 'unidentified', detected: null, identify: { status: 'idle' } },
      ],
      quality: { ok: true, issues: [] },
      timings: { quality: 120, detect: 4200, total: 4400 },
      model: 'claude-sonnet-5-5',
      applied: false,
      dirty: false,
    });

    beforeEach(() => {
      mockCropItem.mockResolvedValue('file:///crop.jpg');
    });

    it('AI の項目にだけ「商品を探す」がある(手動追加には無い)', () => {
      renderResult(aiState());
      expect(screen.getByLabelText('Tシャツの商品を探す')).toBeTruthy();
      expect(screen.queryByLabelText('帽子の商品を探す')).toBeNull();
    });

    it('押すと切り抜いて identifyItem を呼び、読み込み表示のあと候補が出る', async () => {
      let resolve!: (r: IdentifyResponse) => void;
      mockIdentifyItem.mockReturnValue(new Promise<IdentifyResponse>((r) => (resolve = r)));
      renderResult(aiState());
      fireEvent.press(screen.getByLabelText('Tシャツの商品を探す'));
      expect(await screen.findByText('探しています')).toBeTruthy();
      expect(mockCropItem).toHaveBeenCalledWith({ uri: 'file:///a.jpg', width: 3000, height: 4000 }, detected.box);
      await waitFor(() => expect(mockIdentifyItem).toHaveBeenCalledWith('file:///crop.jpg', detected, { imageSearchConsent: false }));
      resolve(identified);
      expect(await screen.findByText('候補が見つかりました')).toBeTruthy();
      expect(screen.getByText('¥7,590')).toBeTruthy();
      expect(screen.getByLabelText('もう一度探す')).toBeTruthy();
    });

    it('カテゴリを変えたあとは、変更後のカテゴリで探す', async () => {
      mockIdentifyItem.mockResolvedValue(identified);
      renderResult(aiState());
      fireEvent.press(screen.getByLabelText('Tシャツを編集'));
      fireEvent.press(screen.getByLabelText('ニット'));
      fireEvent.press(screen.getByLabelText('ニットの商品を探す'));
      await waitFor(() => expect(mockIdentifyItem).toHaveBeenCalled());
      expect(mockIdentifyItem.mock.calls[0]?.[1]).toMatchObject({ id: 'a', categoryId: 'knit' });
    });

    it('失敗すると日本語のエラーを出し、「もう一度探す」で再実行できる', async () => {
      mockIdentifyItem.mockRejectedValueOnce(new AnalyzeError('network'));
      renderResult(aiState());
      fireEvent.press(screen.getByLabelText('Tシャツの商品を探す'));
      expect(await screen.findByText('通信できませんでした。ネットワークを確認して、もう一度お試しください。')).toBeTruthy();
      expect(screen.getByRole('alert')).toBeTruthy();

      mockIdentifyItem.mockResolvedValueOnce(identified);
      fireEvent.press(screen.getByLabelText('もう一度探す'));
      expect(await screen.findByText('候補が見つかりました')).toBeTruthy();
      expect(mockIdentifyItem).toHaveBeenCalledTimes(2);
    });

    it('切り抜きに失敗しても、識別失敗として扱う', async () => {
      mockCropItem.mockRejectedValueOnce(new Error('crop'));
      renderResult(aiState());
      fireEvent.press(screen.getByLabelText('Tシャツの商品を探す'));
      expect(await screen.findByText('商品を特定できませんでした。もう一度お試しください。')).toBeTruthy();
      expect(mockIdentifyItem).not.toHaveBeenCalled();
    });

    it('上限超過の文言を出す', async () => {
      mockIdentifyItem.mockRejectedValue(new AnalyzeError('quota_exceeded'));
      renderResult(aiState());
      fireEvent.press(screen.getByLabelText('Tシャツの商品を探す'));
      expect(await screen.findByText('本日の商品検索の上限に達しました。明日またお試しください。')).toBeTruthy();
    });

    it('読み込み中の二度押しで identifyItem は二重に呼ばれない', async () => {
      mockIdentifyItem.mockReturnValue(new Promise(() => {}));
      renderResult(aiState());
      const button = screen.getByLabelText('Tシャツの商品を探す');
      fireEvent.press(button);
      fireEvent.press(button);
      await screen.findByText('探しています');
      fireEvent.press(screen.getByLabelText('探しています'));
      await waitFor(() => expect(mockIdentifyItem).toHaveBeenCalledTimes(1));
      expect(mockCropItem).toHaveBeenCalledTimes(1);
    });

    describe('画像検索の同意', () => {
      const twoAiState = (): AnalysisState => {
        const base = aiState();
        const second = { ...detected, id: 'h', categoryId: 'hat' };
        return {
          ...(base as Extract<AnalysisState, { status: 'done' }>),
          items: [
            base.status === 'done' ? base.items[0]! : (undefined as never),
            { id: 'h', categoryId: 'hat', brand: '', box: second.box, origin: 'ai', level: 'medium', detected: second, identify: { status: 'idle' } },
          ],
        };
      };

      it('未設定なら検索せず、そのアイテムのカードに同意の説明を出す(他のアイテムは変えない)', async () => {
        mockConsent = 'unset';
        renderResult(twoAiState());
        fireEvent.press(screen.getByLabelText('Tシャツの商品を探す'));
        expect(await screen.findByText(/切り抜いた画像を外部の画像検索\(SerpApi・Google\)に送ります/)).toBeTruthy();
        expect(screen.getByLabelText('同意して探す')).toBeTruthy();
        expect(screen.getByText(/SerpApi が送った画像を保持する期間は公表されていません。/)).toBeTruthy();
        expect(screen.getByLabelText('画像を送らずに探す')).toBeTruthy();
        expect(screen.queryByLabelText('Tシャツの商品を探す')).toBeNull();
        fireEvent.press(screen.getByLabelText('帽子を選ぶ'));
        expect(screen.getByLabelText('帽子の商品を探す')).toBeTruthy();
        expect(mockIdentifyItem).not.toHaveBeenCalled();
        expect(mockCropItem).not.toHaveBeenCalled();
      });

      it('「同意して探す」で granted を保存し、consent ありで検索する', async () => {
        mockConsent = 'unset';
        mockIdentifyItem.mockResolvedValue(identified);
        renderResult(aiState());
        fireEvent.press(screen.getByLabelText('Tシャツの商品を探す'));
        fireEvent.press(await screen.findByLabelText('同意して探す'));
        expect(await screen.findByText('候補が見つかりました')).toBeTruthy();
        expect(mockIdentifyItem).toHaveBeenCalledWith('file:///crop.jpg', detected, { imageSearchConsent: true });
        expect(mockConsent).toBe('granted');
      });

      it('「画像を送らずに探す」で declined を保存し、consent なしで検索する', async () => {
        mockConsent = 'unset';
        mockIdentifyItem.mockResolvedValue(identified);
        renderResult(aiState());
        fireEvent.press(screen.getByLabelText('Tシャツの商品を探す'));
        fireEvent.press(await screen.findByLabelText('画像を送らずに探す'));
        expect(await screen.findByText('候補が見つかりました')).toBeTruthy();
        expect(mockIdentifyItem).toHaveBeenCalledWith('file:///crop.jpg', detected, { imageSearchConsent: false });
        expect(mockConsent).toBe('declined');
      });

      it('保存済みならカードを出さず、その設定で即検索する', async () => {
        mockConsent = 'granted';
        mockIdentifyItem.mockResolvedValue(identified);
        renderResult(aiState());
        fireEvent.press(screen.getByLabelText('Tシャツの商品を探す'));
        await waitFor(() =>
          expect(mockIdentifyItem).toHaveBeenCalledWith('file:///crop.jpg', detected, { imageSearchConsent: true }),
        );
        expect(screen.queryByLabelText('同意して探す')).toBeNull();
      });

      it('別のアイテムにも同じカードが出て、どれかで選ぶと全アイテムに反映される', async () => {
        mockConsent = 'unset';
        mockIdentifyItem.mockResolvedValue(identified);
        renderResult(twoAiState());
        fireEvent.press(screen.getByLabelText('Tシャツの商品を探す'));
        await screen.findByLabelText('同意して探す');
        fireEvent.press(screen.getByLabelText('帽子を選ぶ'));
        fireEvent.press(screen.getByLabelText('帽子の商品を探す'));
        await screen.findByLabelText('同意して探す');

        fireEvent.press(screen.getByLabelText('同意して探す'));
        await screen.findByText('候補が見つかりました');
        // 選ぶと、もう一方のアイテムの同意のカードも閉じて「商品を探す」に戻り、押せば同意ありで即検索する。
        fireEvent.press(screen.getByLabelText('Tシャツを選ぶ'));
        expect(screen.queryByLabelText('同意して探す')).toBeNull();
        fireEvent.press(screen.getByLabelText('Tシャツの商品を探す'));
        await waitFor(() => expect(mockIdentifyItem).toHaveBeenCalledTimes(2));
        expect(mockIdentifyItem.mock.calls[1]?.[2]).toEqual({ imageSearchConsent: true });
      });
    });

    it('探したあとも「この内容で編集へ」は変わらず動く', async () => {
      mockIdentifyItem.mockResolvedValue(identified);
      renderResult(aiState());
      fireEvent.press(screen.getByLabelText('Tシャツの商品を探す'));
      await screen.findByText('候補が見つかりました');
      fireEvent.press(screen.getByLabelText('この内容で編集へ'));
      expect(mockPush).toHaveBeenCalledWith('/editor');
    });
  });

  describe('戻る操作の確認', () => {
    const POP = { type: 'POP' };
    const goBack = () => act(() => mockPrevent!.onPrevented({ data: { action: POP } }));

    beforeEach(() => {
      mockPrevent = null;
      mockNavDispatch.mockClear();
    });

    it('何も編集していなければ、戻る操作を止めない', () => {
      renderResult(doneState());
      expect(mockPrevent?.prevent).toBe(false);
    });

    it.each([
      [
        'ブランドの入力',
        () => {
          fireEvent.press(screen.getByLabelText('スニーカーを選ぶ'));
          fireEvent.press(screen.getByLabelText('スニーカーを編集'));
          fireEvent.changeText(screen.getByLabelText('スニーカーのブランド'), 'adidas');
        },
      ],
      ['削除', () => fireEvent.press(screen.getByLabelText('Tシャツを削除'))],
      [
        'カテゴリの変更',
        () => {
          fireEvent.press(screen.getByLabelText('Tシャツを編集'));
          fireEvent.press(screen.getByLabelText('ニット'));
        },
      ],
      [
        '手動追加',
        () => {
          fireEvent.press(screen.getByLabelText('アイテムを追加'));
          fireEvent.press(screen.getByLabelText('帽子'));
        },
      ],
    ])('%sのあとは、戻る操作を止める', (_name, edit) => {
      renderResult(doneState());
      edit();
      expect(mockPrevent?.prevent).toBe(true);
    });

    it('止めたときは確認を出し、キャンセルでは離れない', () => {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      renderResult(doneState({ dirty: true }));
      expect(mockPrevent?.prevent).toBe(true);
      goBack();
      expect(alert).toHaveBeenCalledWith(
        '編集内容が失われます',
        '戻ると、この画面での変更と探した商品の結果が失われます。',
        expect.any(Array),
      );
      const buttons = alert.mock.calls[0]![2]!;
      expect(buttons.map((b) => [b.text, b.style])).toEqual([
        ['キャンセル', 'cancel'],
        ['戻る', 'destructive'],
      ]);
      buttons[0]!.onPress?.();
      expect(mockNavDispatch).not.toHaveBeenCalled();
      alert.mockRestore();
    });

    it('「戻る」を選ぶと、止めていた操作をそのまま実行して離れる', () => {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      renderResult(doneState({ dirty: true }));
      goBack();
      alert.mock.calls[0]![2]![1]!.onPress?.();
      expect(mockNavDispatch).toHaveBeenCalledWith(POP);
      alert.mockRestore();
    });

    it('「この内容で編集へ」では確認を出さずに進む', () => {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      renderResult(doneState({ dirty: true }));
      fireEvent.press(screen.getByLabelText('この内容で編集へ'));
      expect(mockPush).toHaveBeenCalledWith('/editor');
      expect(alert).not.toHaveBeenCalled();
      alert.mockRestore();
    });
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
    expect(screen.getByLabelText('解析しています')).toBeTruthy();
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

describe('編集画面(アイコンのタブ)', () => {
  it('操作はアイコンのタブで切り替え、文字ラベルは出さない。書き出しへは丸ボタンで進む', () => {
    render(withPhoto(<EditorScreen />));
    for (const name of ['写真', 'テンプレート', 'ラベル', '色', '線', '元に戻す', 'やり直す']) {
      expect(screen.getByLabelText(name)).toBeTruthy();
    }
    expect(screen.queryByText('ラベル')).toBeNull();
    expect(screen.getByLabelText('写真').props.accessibilityState).toMatchObject({ selected: true });
    fireEvent.press(screen.getByLabelText('テンプレート'));
    expect(screen.getByLabelText('テンプレート').props.accessibilityState).toMatchObject({ selected: true });
    fireEvent.press(screen.getByLabelText('書き出しへ'));
    expect(mockPush).toHaveBeenCalledWith('/export');
  });

  it('ラベルを足すと、ラベル・色・線のタブで中身を編集できる', () => {
    render(withPhoto(<EditorScreen />));
    fireEvent.press(screen.getByLabelText('ラベル'));
    fireEvent.press(screen.getByLabelText('ラベルを追加'));
    expect(screen.getByLabelText('ブランド名')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('色'));
    expect(screen.getByLabelText('文字色 #FFFFFF')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('線'));
    expect(screen.getByLabelText('線の色 #FFFFFF')).toBeTruthy();
  });
});

describe('書き出し画面(アイコンボタン)', () => {
  it('保存と共有は読み上げ名つきのアイコンボタンで、文字は出さない', () => {
    render(withPhoto(<ExportScreen />));
    expect(screen.getByLabelText('共有する(Instagramなど)')).toBeTruthy();
    expect(screen.getByLabelText('端末に保存')).toBeTruthy();
    expect(screen.queryByText('端末に保存')).toBeNull();
  });
});

describe('設定', () => {
  it('画像検索の同意の状態を出し、同意済みなら取り消せる。取り消すと未設定になる', async () => {
    mockConsent = 'granted';
    render(<SettingsScreen />);
    expect(screen.getByText('画像検索の同意')).toBeTruthy();
    expect(await screen.findByText('現在の状態: 同意済み')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('同意を取り消す'));
    expect(await screen.findByText('現在の状態: 未設定')).toBeTruthy();
    expect(mockConsent).toBe('unset');
    expect(screen.queryByLabelText('同意を取り消す')).toBeNull();
  });

  it('「画像は送らない」のときも取り消せ、未設定では取り消しボタンを出さない', async () => {
    mockConsent = 'declined';
    const { unmount } = render(<SettingsScreen />);
    expect(await screen.findByText('現在の状態: 画像は送らない')).toBeTruthy();
    expect(screen.getByLabelText('同意を取り消す')).toBeTruthy();
    unmount();
    mockConsent = 'unset';
    render(<SettingsScreen />);
    expect(await screen.findByText('現在の状態: 未設定')).toBeTruthy();
    expect(screen.queryByLabelText('同意を取り消す')).toBeNull();
  });

  it('取り消しに失敗したらエラーを出し、状態は同意済みのまま', async () => {
    mockConsent = 'granted';
    mockClearFails = true;
    render(<SettingsScreen />);
    await screen.findByText('現在の状態: 同意済み');
    fireEvent.press(screen.getByLabelText('同意を取り消す'));
    expect(await screen.findByText('同意を取り消せませんでした。もう一度お試しください。')).toBeTruthy();
    expect(screen.getByText('現在の状態: 同意済み')).toBeTruthy();
    mockClearFails = false;
  });

  it('AIサービスへの画像送信の説明がある。古い「未実装」の文は出さない', () => {
    render(<SettingsScreen />);
    expect(screen.getByText('AIサービスへの画像送信について')).toBeTruthy();
    expect(screen.queryByText(/写真は送信されません/)).toBeNull();
    expect(screen.getByText(/切り抜いた画像を外部の画像検索\(SerpApi・Google\)にも送ります/)).toBeTruthy();
  });
});
