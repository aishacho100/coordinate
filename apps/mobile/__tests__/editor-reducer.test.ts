import { cropAspectRatio } from '@coordinate/layout';

import {
  currentCrop,
  editorReducer,
  initialEditorState,
  selectUndoRedo,
  type EditorAction,
  type EditorState,
  type Photo,
} from '@/features/editor/reducer';

const photo: Photo = { uri: 'file:///a.jpg', width: 3000, height: 4000 };

function run(actions: EditorAction[], from: EditorState = initialEditorState): EditorState {
  return actions.reduce(editorReducer, from);
}
const doc = (s: EditorState) => s.history!.present.doc;

describe('editorReducer', () => {
  it('写真を読み込むと初期ドキュメントと 4:5 のトリミングができる', () => {
    const s = run([{ type: 'loadPhoto', photo }]);
    expect(doc(s).labels).toHaveLength(0);
    const crop = currentCrop(s.history!.present);
    expect(cropAspectRatio(crop, photo.width, photo.height)).toBeCloseTo(0.8);
    expect(selectUndoRedo(s)).toEqual({ canUndo: false, canRedo: false });
  });

  it('写真が無い状態の編集操作は無視される', () => {
    expect(run([{ type: 'setTemplate', templateId: 'luxury' }])).toBe(initialEditorState);
  });

  it('ラベル追加 → 選択状態になり、元に戻す/やり直しできる', () => {
    let s = run([
      { type: 'loadPhoto', photo },
      { type: 'addLabel', input: { id: 'a', brand: 'B', name: 'N', price: '¥1' } },
    ]);
    expect(doc(s).labels).toHaveLength(1);
    expect(s.selectedId).toBe('a');
    s = run([{ type: 'undo' }], s);
    expect(doc(s).labels).toHaveLength(0);
    s = run([{ type: 'redo' }], s);
    expect(doc(s).labels).toHaveLength(1);
  });

  it('ドラッグは begin + 複数 patch でも1回の undo で開始前に戻る', () => {
    const base = run([
      { type: 'loadPhoto', photo },
      { type: 'addLabel', input: { id: 'a' } },
    ]);
    const start = doc(base).labels[0]!.position;
    let s = run(
      [
        { type: 'begin' },
        { type: 'patchLabel', id: 'a', patch: { position: { x: 0.3, y: 0.3 } } },
        { type: 'patchLabel', id: 'a', patch: { position: { x: 0.6, y: 0.7 } } },
      ],
      base,
    );
    expect(doc(s).labels[0]!.position).toEqual({ x: 0.6, y: 0.7 });
    s = run([{ type: 'undo' }], s);
    expect(doc(s).labels[0]!.position).toEqual(start);
  });

  it('moveLabel は差分を現在値に加算し、0〜1 に丸め、begin と合わせて1回の undo で戻る', () => {
    const base = run([{ type: 'loadPhoto', photo }, { type: 'addLabel', input: { id: 'a' } }]);
    const start = doc(base).labels[0]!.position;
    let s = run(
      [
        { type: 'begin' },
        { type: 'moveLabel', id: 'a', target: 'position', dx: 0.1, dy: 0.05 },
        { type: 'moveLabel', id: 'a', target: 'position', dx: 0.1, dy: 0.05 },
      ],
      base,
    );
    expect(doc(s).labels[0]!.position.x).toBeCloseTo(start.x + 0.2);
    expect(doc(s).labels[0]!.position.y).toBeCloseTo(start.y + 0.1);
    s = run([{ type: 'moveLabel', id: 'a', target: 'position', dx: 5, dy: -5 }], s);
    expect(doc(s).labels[0]!.position).toEqual({ x: 1, y: 0 });
    s = run([{ type: 'undo' }], s);
    expect(doc(s).labels[0]!.position).toEqual(start);
  });

  it('moveLabel は線の指し先(anchor)も動かせる。存在しないIDは無視する', () => {
    const base = run([{ type: 'loadPhoto', photo }, { type: 'addLabel', input: { id: 'a' } }]);
    const a0 = doc(base).labels[0]!.anchor;
    const s = run([{ type: 'moveLabel', id: 'a', target: 'anchor', dx: 0.1, dy: 0 }], base);
    expect(doc(s).labels[0]!.anchor.x).toBeCloseTo(a0.x + 0.1);
    expect(run([{ type: 'moveLabel', id: 'zzz', target: 'anchor', dx: 0.1, dy: 0 }], base)).toBe(base);
  });

  it('ラベル削除で選択が外れる。別ラベルの選択は維持される', () => {
    let s = run([
      { type: 'loadPhoto', photo },
      { type: 'addLabel', input: { id: 'a' } },
      { type: 'addLabel', input: { id: 'b' } },
    ]);
    expect(s.selectedId).toBe('b');
    s = run([{ type: 'removeLabel', id: 'a' }], s);
    expect(s.selectedId).toBe('b');
    s = run([{ type: 'removeLabel', id: 'b' }], s);
    expect(s.selectedId).toBeNull();
  });

  it('比率変更でトリミング比率が変わり、同じ比率の再選択は履歴を増やさない', () => {
    let s = run([{ type: 'loadPhoto', photo }, { type: 'setAspect', aspect: '1:1' }]);
    expect(cropAspectRatio(currentCrop(s.history!.present), photo.width, photo.height)).toBeCloseTo(1);
    const before = s.history!.past.length;
    s = run([{ type: 'setAspect', aspect: '1:1' }], s);
    expect(s.history!.past.length).toBe(before);
  });

  it('トリミングの移動は画像外に出ず、1回の begin で undo できる', () => {
    let s = run([{ type: 'loadPhoto', photo }, { type: 'setAspect', aspect: '1:1' }]);
    const before = currentCrop(s.history!.present);
    s = run([{ type: 'begin' }, { type: 'panCrop', dx: 0, dy: 10 }], s);
    const crop = currentCrop(s.history!.present);
    expect(crop.y + crop.h).toBeLessThanOrEqual(1 + 1e-9);
    s = run([{ type: 'undo' }], s);
    expect(currentCrop(s.history!.present)).toEqual(before);
  });

  it('価格表示とテンプレートの切り替えも履歴に残る', () => {
    let s = run([
      { type: 'loadPhoto', photo },
      { type: 'setShowPrices', showPrices: false },
      { type: 'setTemplate', templateId: 'street' },
    ]);
    expect(doc(s).showPrices).toBe(false);
    expect(doc(s).templateId).toBe('street');
    s = run([{ type: 'undo' }, { type: 'undo' }], s);
    expect(doc(s).showPrices).toBe(true);
    expect(doc(s).templateId).toBe('minimal');
  });

  it('回転で写真が差し替わり、ラベル位置も回り、undo で戻る', () => {
    const rotated: Photo = { uri: 'file:///r.jpg', width: 4000, height: 3000 };
    let s = run([
      { type: 'loadPhoto', photo },
      { type: 'addLabel', input: { id: 'a' } },
      { type: 'commitLabel', id: 'a', patch: { position: { x: 1, y: 0 } } },
      { type: 'replacePhoto', photo: rotated, rotated90: true },
    ]);
    expect(s.history!.present.photo.uri).toBe('file:///r.jpg');
    expect(doc(s).labels[0]!.position).toEqual({ x: 1, y: 1 });
    s = run([{ type: 'undo' }], s);
    expect(s.history!.present.photo.uri).toBe(photo.uri);
    expect(doc(s).labels[0]!.position).toEqual({ x: 1, y: 0 });
  });

  it('自動配置に戻すと位置が既定に戻り、undo で手動配置に戻る', () => {
    let s = run([
      { type: 'loadPhoto', photo },
      { type: 'addLabel', input: { id: 'a' } },
      { type: 'commitLabel', id: 'a', patch: { position: { x: 0.9, y: 0.9 } } },
    ]);
    s = run([{ type: 'resetLayout' }], s);
    expect(doc(s).labels[0]!.position).not.toEqual({ x: 0.9, y: 0.9 });
    s = run([{ type: 'undo' }], s);
    expect(doc(s).labels[0]!.position).toEqual({ x: 0.9, y: 0.9 });
  });

  it('clear で状態が空に戻る', () => {
    expect(run([{ type: 'loadPhoto', photo }, { type: 'clear' }])).toEqual(initialEditorState);
  });
});
