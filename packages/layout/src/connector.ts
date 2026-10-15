import type { LabelStyle } from '@coordinate/shared';

export type Px = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export type Connector = {
  start: Px;
  end: Px;
  /** 曲線の制御点。直線なら null。 */
  control: Px | null;
  /** 矢じり(開いたV字)の3点。無ければ null。 */
  head: [Px, Px, Px] | null;
  /** 終点に丸を描くか。 */
  dot: boolean;
  /** SVG path の d 属性 */
  path: string;
};

const dist = (a: Px, b: Px) => Math.hypot(a.x - b.x, a.y - b.y);

/** ラベル矩形の各辺の中点のうち、対象点に最も近いもの。 */
export function nearestEdgePoint(rect: Rect, target: Px): Px {
  const candidates: Px[] = [
    { x: rect.x, y: rect.y + rect.h / 2 },
    { x: rect.x + rect.w, y: rect.y + rect.h / 2 },
    { x: rect.x + rect.w / 2, y: rect.y },
    { x: rect.x + rect.w / 2, y: rect.y + rect.h },
  ];
  let best = candidates[0] as Px;
  for (const c of candidates) if (dist(c, target) < dist(best, target)) best = c;
  return best;
}

/**
 * ラベルからアイテム(anchor)へ伸ばす線の幾何。座標はすべて px。
 * unit は矢じり・丸の大きさの基準(キャンバス幅/360 など)。
 */
export function computeConnector(
  rect: Rect,
  anchor: Px,
  arrow: LabelStyle['arrow'],
  unit: number,
): Connector {
  const start = nearestEdgePoint(rect, anchor);
  const end = anchor;
  const len = dist(start, end);
  const curved = arrow === 'curved' && len > 1;

  let control: Px | null = null;
  if (curved) {
    const nx = -(end.y - start.y) / len;
    const ny = (end.x - start.x) / len;
    control = {
      x: (start.x + end.x) / 2 + nx * len * 0.2,
      y: (start.y + end.y) / 2 + ny * len * 0.2,
    };
  }

  let head: Connector['head'] = null;
  if ((arrow === 'simple' || arrow === 'curved') && len > 1) {
    const from = control ?? start;
    const tl = dist(from, end) || 1;
    const tx = (end.x - from.x) / tl;
    const ty = (end.y - from.y) / tl;
    const s = 9 * unit;
    const px = -ty;
    const py = tx;
    head = [
      { x: end.x - tx * s + px * s * 0.5, y: end.y - ty * s + py * s * 0.5 },
      end,
      { x: end.x - tx * s - px * s * 0.5, y: end.y - ty * s - py * s * 0.5 },
    ];
  }

  const f = (n: number) => n.toFixed(2);
  const path = control
    ? `M ${f(start.x)} ${f(start.y)} Q ${f(control.x)} ${f(control.y)} ${f(end.x)} ${f(end.y)}`
    : `M ${f(start.x)} ${f(start.y)} L ${f(end.x)} ${f(end.y)}`;

  return { start, end, control, head, dot: arrow === 'dot', path };
}
