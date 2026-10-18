import type { AnalyzeResponse, Box, DetectedItem, IdentificationLevel, IdentifyResponse, Quality } from '@coordinate/shared';

import type { AnalyzeErrorKind } from '@/lib/analyze-api';

/** 認識結果画面で編集する 1 件。Phase 3 では商品・価格は持たない。 */
export type ResultItem = {
  id: string;
  categoryId: string;
  /** 空文字ならブランド不明。 */
  brand: string;
  /** 写真全体に対する正規化座標。 */
  box: Box;
  origin: 'ai' | 'manual';
  level: IdentificationLevel;
  /** 検出時のアイテム(特徴つき)。手動追加は null。 */
  detected: DetectedItem | null;
  identify: IdentifyState;
};

export type IdentifyState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'failed'; kind: AnalyzeErrorKind }
  | { status: 'done'; response: IdentifyResponse };

export type AnalysisState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'failed'; kind: AnalyzeErrorKind }
  | {
      status: 'done';
      items: ResultItem[];
      quality: Quality;
      timings: AnalyzeResponse['timings'];
      model: string;
      /** 編集画面へラベルを渡し済みか(二重に追加しない)。 */
      applied: boolean;
    };

export const initialAnalysisState: AnalysisState = { status: 'idle' };

export type AnalysisAction =
  | { type: 'start' }
  | { type: 'succeeded'; response: AnalyzeResponse }
  | { type: 'failed'; kind: AnalyzeErrorKind }
  | { type: 'setCategory'; id: string; categoryId: string }
  | { type: 'setBrand'; id: string; brand: string }
  | { type: 'remove'; id: string }
  | { type: 'addManual'; id: string; categoryId: string }
  | { type: 'identifyStart'; id: string }
  | { type: 'identifySucceeded'; id: string; response: IdentifyResponse }
  | { type: 'identifyFailed'; id: string; kind: AnalyzeErrorKind }
  | { type: 'applied' }
  | { type: 'reset' };

/** 手動追加した項目の初期枠(写真中央)。 */
export const MANUAL_BOX: Box = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };

export function analysisReducer(state: AnalysisState, action: AnalysisAction): AnalysisState {
  switch (action.type) {
    case 'start':
      return { status: 'loading' };
    case 'failed':
      return { status: 'failed', kind: action.kind };
    case 'reset':
      return initialAnalysisState;
    case 'succeeded':
      return {
        status: 'done',
        items: action.response.items.map((i) => ({
          id: i.id,
          categoryId: i.categoryId,
          brand: i.brandCandidates[0]?.name ?? '',
          box: i.box,
          origin: 'ai' as const,
          level: i.level,
          detected: i,
          identify: { status: 'idle' as const },
        })),
        quality: action.response.quality,
        timings: action.response.timings,
        model: action.response.model,
        applied: false,
      };
  }

  if (state.status !== 'done') return state;
  switch (action.type) {
    case 'setCategory':
      return {
        ...state,
        items: state.items.map((i) => (i.id === action.id ? { ...i, categoryId: action.categoryId, identify: { status: 'idle' } } : i)),
      };
    case 'setBrand':
      return { ...state, items: state.items.map((i) => (i.id === action.id ? { ...i, brand: action.brand } : i)) };
    case 'remove':
      return { ...state, items: state.items.filter((i) => i.id !== action.id) };
    case 'addManual':
      return {
        ...state,
        items: [
          ...state.items,
          { id: action.id, categoryId: action.categoryId, brand: '', box: MANUAL_BOX, origin: 'manual', level: 'unidentified', detected: null, identify: { status: 'idle' } },
        ],
      };
    case 'identifyStart':
      return withIdentify(state, action.id, { status: 'loading' });
    case 'identifySucceeded':
      return withIdentify(state, action.id, { status: 'done', response: action.response });
    case 'identifyFailed':
      return withIdentify(state, action.id, { status: 'failed', kind: action.kind });
    case 'applied':
      return { ...state, applied: true };
  }
}

function withIdentify(state: Extract<AnalysisState, { status: 'done' }>, id: string, identify: IdentifyState): AnalysisState {
  return { ...state, items: state.items.map((i) => (i.id === id ? { ...i, identify } : i)) };
}
