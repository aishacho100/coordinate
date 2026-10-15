import type { LabelStyle } from '@coordinate/shared';

/** フォントの論理名。実フォントへの対応はアプリ側で行う(デザイン定義をフォント実装から分離)。 */
export type FontKey = 'mincho' | 'gothic' | 'gothicBold' | 'latin' | 'hand';

export const FONT_KEYS: readonly FontKey[] = ['mincho', 'gothic', 'gothicBold', 'latin', 'hand'];

export type LabelBox = {
  radius: number;
  paddingX: number;
  paddingY: number;
  borderWidth: number;
  borderColor: string;
  /** 背景が無い/薄い場合に文字を読みやすくするための影。 */
  textShadow: boolean;
};

/** テンプレート定義。ユーザーが編集した個別の配置情報(EditDocument)とは分離している。 */
export type TemplateDefinition = {
  id: string;
  nameJa: string;
  description: string;
  style: Omit<LabelStyle, 'fontFamily'> & { fontFamily: FontKey };
  box: LabelBox;
  /** 価格行の文字サイズ倍率 */
  priceScale: number;
};

export const TEMPLATES: readonly TemplateDefinition[] = [
  {
    id: 'minimal',
    nameJa: 'ミニマル',
    description: '細い線と小さな文字。写真を主役に。',
    style: {
      fontFamily: 'gothic',
      fontSize: 11,
      textColor: '#1B1A19',
      backgroundColor: '#FFFFFF',
      opacity: 0.88,
      lineColor: '#FFFFFF',
      lineWidth: 1,
      arrow: 'dot',
    },
    box: { radius: 2, paddingX: 8, paddingY: 5, borderWidth: 0, borderColor: 'transparent', textShadow: false },
    priceScale: 1,
  },
  {
    id: 'magazine',
    nameJa: '雑誌風',
    description: '明朝体と細罫線。ファッション誌の欄外注のように。',
    style: {
      fontFamily: 'mincho',
      fontSize: 12,
      textColor: '#111111',
      backgroundColor: '#F7F3EC',
      opacity: 0.94,
      lineColor: '#111111',
      lineWidth: 0.8,
      arrow: 'none',
    },
    box: { radius: 0, paddingX: 9, paddingY: 6, borderWidth: 0.6, borderColor: '#111111', textShadow: false },
    priceScale: 0.92,
  },
  {
    id: 'handwritten',
    nameJa: '手書き風',
    description: '手書きの文字とゆるい曲線の矢印。',
    style: {
      fontFamily: 'hand',
      fontSize: 15,
      textColor: '#FFFFFF',
      backgroundColor: '#000000',
      opacity: 0,
      lineColor: '#FFFFFF',
      lineWidth: 1.6,
      arrow: 'curved',
    },
    box: { radius: 0, paddingX: 4, paddingY: 2, borderWidth: 0, borderColor: 'transparent', textShadow: true },
    priceScale: 1,
  },
  {
    id: 'luxury',
    nameJa: 'ラグジュアリー',
    description: '黒地に金。静かで格調のある雰囲気。',
    style: {
      fontFamily: 'latin',
      fontSize: 12,
      textColor: '#E9DBB8',
      backgroundColor: '#14110F',
      opacity: 0.82,
      lineColor: '#D9C48F',
      lineWidth: 0.8,
      arrow: 'dot',
    },
    box: { radius: 0, paddingX: 10, paddingY: 7, borderWidth: 0.6, borderColor: '#D9C48F', textShadow: false },
    priceScale: 0.9,
  },
  {
    id: 'street',
    nameJa: 'ストリート',
    description: '太いゴシックと蛍光イエロー。',
    style: {
      fontFamily: 'gothicBold',
      fontSize: 12,
      textColor: '#000000',
      backgroundColor: '#FFE600',
      opacity: 1,
      lineColor: '#FFE600',
      lineWidth: 2.2,
      arrow: 'simple',
    },
    box: { radius: 0, paddingX: 8, paddingY: 5, borderWidth: 1.5, borderColor: '#000000', textShadow: false },
    priceScale: 1.1,
  },
  {
    id: 'product',
    nameJa: '商品解説風',
    description: '白いカードに情報を整理。ECの商品紹介のように。',
    style: {
      fontFamily: 'gothic',
      fontSize: 11,
      textColor: '#222222',
      backgroundColor: '#FFFFFF',
      opacity: 0.96,
      lineColor: '#FFFFFF',
      lineWidth: 1.2,
      arrow: 'dot',
    },
    box: { radius: 10, paddingX: 10, paddingY: 8, borderWidth: 0, borderColor: 'transparent', textShadow: false },
    priceScale: 1.15,
  },
];

export const DEFAULT_TEMPLATE_ID = 'minimal';

export function getTemplate(id: string): TemplateDefinition {
  return TEMPLATES.find((t) => t.id === id) ?? (TEMPLATES[0] as TemplateDefinition);
}
