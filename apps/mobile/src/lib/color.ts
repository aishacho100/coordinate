/** #RGB / #RRGGBB に不透明度を掛けた rgba() を返す。解釈できない色はそのまま返す。 */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.min(Math.max(alpha, 0), 1);
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  let hex = m[1] as string;
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
