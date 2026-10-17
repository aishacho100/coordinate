import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from 'react';

import {
  editorReducer,
  initialEditorState,
  selectUndoRedo,
  type EditorAction,
  type EditorState,
  type Snapshot,
} from './reducer';

type EditorContextValue = {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  /** 写真が読み込まれていれば現在の編集状態。無ければ null。 */
  snapshot: Snapshot | null;
  canUndo: boolean;
  canRedo: boolean;
};

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorProvider({
  children,
  initialState = initialEditorState,
}: {
  children: ReactNode;
  /** テスト用。 */
  initialState?: EditorState;
}) {
  const [state, dispatch] = useReducer(editorReducer, initialState);
  const value = useMemo<EditorContextValue>(
    () => ({ state, dispatch, snapshot: state.history?.present ?? null, ...selectUndoRedo(state) }),
    [state],
  );
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditor は EditorProvider の内側で使用してください');
  return ctx;
}

/** ラベルIDの生成(衝突しにくいランダム文字列)。 */
export function newLabelId(): string {
  return `l_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
