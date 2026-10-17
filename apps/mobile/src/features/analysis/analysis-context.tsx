import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from 'react';

import { analysisReducer, initialAnalysisState, type AnalysisAction, type AnalysisState } from './analysis-reducer';

type AnalysisContextValue = { state: AnalysisState; dispatch: Dispatch<AnalysisAction> };

const AnalysisContext = createContext<AnalysisContextValue | null>(null);

export function AnalysisProvider({
  children,
  initialState = initialAnalysisState,
}: {
  children: ReactNode;
  /** テスト用。 */
  initialState?: AnalysisState;
}) {
  const [state, dispatch] = useReducer(analysisReducer, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}

export function useAnalysis(): AnalysisContextValue {
  const ctx = useContext(AnalysisContext);
  if (!ctx) throw new Error('useAnalysis は AnalysisProvider の内側で使用してください');
  return ctx;
}

/** 手動追加する項目の ID。 */
export function newItemId(): string {
  return `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
