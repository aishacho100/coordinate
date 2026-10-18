const group = (n: string) => n.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** 価格の表示。JPY は「¥7,590」、それ以外は「1,234.5 USD」のように通貨コードを後ろに付ける。 */
export function formatPrice(amount: number, currency: string): string {
  if (currency === 'JPY') return `¥${group(String(Math.round(amount)))}`;
  const [int = '0', frac] = String(amount).split('.');
  return `${group(int)}${frac ? `.${frac}` : ''} ${currency}`;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 取得日時を「10月18日時点」にする。端末の時刻設定に左右されないよう日本時間で数える。 */
export function formatAsOf(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t + JST_OFFSET_MS);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日時点`;
}
