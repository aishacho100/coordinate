/** 元に戻す/やり直しの履歴。状態そのもののスナップショットを保持する(状態は不変として扱う)。 */
export type History<T> = {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
};

const MAX_HISTORY = 100;

export function createHistory<T>(initial: T): History<T> {
  return { past: [], present: initial, future: [] };
}

/** 新しい状態を積む。同一参照なら何もしない。やり直し履歴は破棄する。 */
export function pushHistory<T>(h: History<T>, next: T): History<T> {
  if (Object.is(h.present, next)) return h;
  const past = [...h.past, h.present].slice(-MAX_HISTORY);
  return { past, present: next, future: [] };
}

/**
 * ドラッグ中など、連続操作を1回の履歴にまとめるために現在値だけ置き換える。
 * 操作の開始時に pushHistory、途中は replacePresent、で使う。
 */
export function replacePresent<T>(h: History<T>, next: T): History<T> {
  return { ...h, present: next };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

export function undo<T>(h: History<T>): History<T> {
  const previous = h.past[h.past.length - 1];
  if (previous === undefined) return h;
  return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  const next = h.future[0];
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
}
