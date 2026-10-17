import {
  addLabel,
  canRedo,
  canUndo,
  computeCrop,
  createDocument,
  createHistory,
  panCrop,
  pushHistory,
  redo,
  removeLabel,
  replacePresent,
  resetLabelStyles,
  resetLayout,
  rotateLabels90,
  setAspect,
  setShowPrices,
  setTemplate,
  undo,
  updateLabel,
  type CropRect,
  type History,
  type LabelPatch,
  type NewLabelInput,
} from '@coordinate/layout';
import type { EditDocument } from '@coordinate/shared';

export type Photo = { uri: string; width: number; height: number };

/** 履歴1件分。編集データ(doc)は写真(photo)と分離した JSON として保持する。 */
export type Snapshot = { photo: Photo; doc: EditDocument };

export type EditorState = {
  history: History<Snapshot> | null;
  selectedId: string | null;
};

export const initialEditorState: EditorState = { history: null, selectedId: null };

export type EditorAction =
  | { type: 'loadPhoto'; photo: Photo }
  | { type: 'setTemplate'; templateId: string }
  | { type: 'setAspect'; aspect: EditDocument['aspect'] }
  | { type: 'setShowPrices'; showPrices: boolean }
  | { type: 'addLabel'; input: NewLabelInput }
  /** 複数ラベルを 1 回の履歴で追加する(AI の検出結果の引き継ぎ用)。 */
  | { type: 'addLabels'; inputs: NewLabelInput[] }
  | { type: 'removeLabel'; id: string }
  | { type: 'resetLayout' }
  | { type: 'resetStyles' }
  /** 連続操作(ドラッグ・文字入力)の開始。ここで1回だけ履歴に積む。 */
  | { type: 'begin' }
  /** 連続操作中の更新。履歴は増やさない。 */
  | { type: 'patchLabel'; id: string; patch: LabelPatch }
  /** ドラッグの差分(正規化座標)を現在値に加算する。位置は 0〜1 に丸められる。 */
  | { type: 'moveLabel'; id: string; target: 'position' | 'anchor'; dx: number; dy: number }
  | { type: 'panCrop'; dx: number; dy: number }
  /** 1回きりの変更(スタイルのボタン操作など)。履歴に積む。 */
  | { type: 'commitLabel'; id: string; patch: LabelPatch }
  | { type: 'replacePhoto'; photo: Photo; rotated90: boolean }
  | { type: 'select'; id: string | null }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'clear' };

export function currentCrop(s: Snapshot): CropRect {
  return s.doc.crop ?? computeCrop(s.photo.width, s.photo.height, s.doc.aspect);
}

function cropCenter(c: CropRect) {
  return { cx: c.x + c.w / 2, cy: c.y + c.h / 2 };
}

function withDoc(s: Snapshot, doc: EditDocument): Snapshot {
  return doc === s.doc ? s : { ...s, doc };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  if (action.type === 'loadPhoto') {
    const doc = createDocument();
    const crop = computeCrop(action.photo.width, action.photo.height, doc.aspect);
    return { history: createHistory({ photo: action.photo, doc: { ...doc, crop } }), selectedId: null };
  }
  if (action.type === 'clear') return initialEditorState;
  if (action.type === 'select') return { ...state, selectedId: action.id };

  const h = state.history;
  if (!h) return state;
  const cur = h.present;
  const push = (next: Snapshot): EditorState => ({ ...state, history: pushHistory(h, next) });

  switch (action.type) {
    case 'undo':
      return { ...state, history: undo(h) };
    case 'redo':
      return { ...state, history: redo(h) };
    case 'begin':
      // 新しい参照を積むことで、ドラッグ全体を1回の「元に戻す」にまとめる。
      return { ...state, history: pushHistory(h, { ...cur }) };
    case 'setTemplate':
      return push(withDoc(cur, setTemplate(cur.doc, action.templateId)));
    case 'setShowPrices':
      return push(withDoc(cur, setShowPrices(cur.doc, action.showPrices)));
    case 'setAspect': {
      if (cur.doc.aspect === action.aspect) return state;
      const crop = computeCrop(cur.photo.width, cur.photo.height, action.aspect, cropCenter(currentCrop(cur)));
      return push(withDoc(cur, { ...setAspect(cur.doc, action.aspect), crop }));
    }
    case 'addLabel': {
      const doc = addLabel(cur.doc, action.input);
      return { history: pushHistory(h, withDoc(cur, doc)), selectedId: action.input.id };
    }
    case 'addLabels': {
      if (action.inputs.length === 0) return state;
      const doc = action.inputs.reduce(addLabel, cur.doc);
      return { ...state, history: pushHistory(h, withDoc(cur, doc)) };
    }
    case 'removeLabel': {
      const doc = removeLabel(cur.doc, action.id);
      return {
        history: pushHistory(h, withDoc(cur, doc)),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
      };
    }
    case 'resetLayout':
      return push(withDoc(cur, resetLayout(cur.doc)));
    case 'resetStyles':
      return push(withDoc(cur, resetLabelStyles(cur.doc)));
    case 'commitLabel':
      return push(withDoc(cur, updateLabel(cur.doc, action.id, action.patch)));
    case 'patchLabel': {
      const next = withDoc(cur, updateLabel(cur.doc, action.id, action.patch));
      return next === cur ? state : { ...state, history: replacePresent(h, next) };
    }
    case 'moveLabel': {
      const label = cur.doc.labels.find((l) => l.id === action.id);
      if (!label) return state;
      const from = label[action.target];
      const patch: LabelPatch = { [action.target]: { x: from.x + action.dx, y: from.y + action.dy } };
      const next = withDoc(cur, updateLabel(cur.doc, action.id, patch));
      return next === cur ? state : { ...state, history: replacePresent(h, next) };
    }
    case 'panCrop': {
      const crop = panCrop(currentCrop(cur), action.dx, action.dy);
      return { ...state, history: replacePresent(h, withDoc(cur, { ...cur.doc, crop })) };
    }
    case 'replacePhoto': {
      const base = action.rotated90 ? rotateLabels90(cur.doc) : cur.doc;
      const crop = computeCrop(action.photo.width, action.photo.height, base.aspect);
      return push({ photo: action.photo, doc: { ...base, crop } });
    }
  }
}

export function selectUndoRedo(state: EditorState) {
  const h = state.history;
  return { canUndo: h ? canUndo(h) : false, canRedo: h ? canRedo(h) : false };
}
