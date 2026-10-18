import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import type { DetectorImage, Product, Usage } from '@coordinate/shared';

import type { Effort } from '../config';
import type { MessagesClient } from '../detector/claude-vision-detector';
import { isAllowedImageUrl } from '../search/image-url';
import type { Judgement } from './verdict';

export class ComparisonError extends Error {
  /** 応答を受け取ったあとの失敗では、取得済みの使用量(課金済み)を持つ。 */
  constructor(
    detail: string,
    readonly usage?: Usage,
  ) {
    super(`ComparisonError: ${detail}`);
    this.name = 'ComparisonError';
  }
}

const Row = z.object({
  index: z.number().int(),
  same_product: z.boolean(),
  name_matches_features: z.boolean(),
  similarity: z.number(),
  matched: z.array(z.string()),
  unconfirmed: z.array(z.string()),
});
const Output = z.object({ results: z.array(Row) });
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'same_product', 'name_matches_features', 'similarity', 'matched', 'unconfirmed'],
        properties: {
          index: { type: 'integer' },
          same_product: { type: 'boolean' },
          name_matches_features: { type: 'boolean' },
          similarity: { type: 'number' },
          matched: { type: 'array', items: { type: 'string' } },
          unconfirmed: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

const SYSTEM = `You compare ONE item cropped from an outfit photo (the first image) with candidate products found by a web search.

For each candidate (identified by its index) return:
- same_product: true ONLY if the candidate image shows the very same product (same design, color, and distinctive details), not just a similar-looking one. If the candidate has no image, it must be false.
- name_matches_features: true only if the candidate's name or model number agrees with text that is legible on the item or with the item's distinctive features.
- similarity: 0 to 1, how visually and descriptively close the candidate is to the item. It is a rough measure, not a probability.
- matched: short Japanese phrases for what matches (for example 色, 形, ロゴ).
- unconfirmed: short Japanese phrases for what could not be confirmed (for example 型番, 素材, サイズ).
Be strict. A product page existing is not evidence of identity. Return one result per candidate.`;

export class Comparer {
  constructor(
    private readonly client: MessagesClient,
    private readonly model: string,
    private readonly effort: Effort,
  ) {}

  async compare(image: DetectorImage, candidates: Product[]): Promise<{ judgements: Judgement[]; usage: Usage }> {
    if (candidates.length === 0) return { judgements: [], usage: { inputTokens: 0, outputTokens: 0 } };

    // Claude に画像として渡した候補の index。渡していない候補は同一商品と判断させない。
    const shown = new Set<number>();
    const content: Anthropic.ContentBlockParam[] = [
      { type: 'text', text: 'Item cropped from the photo:' },
      {
        type: 'image',
        source: { type: 'base64', media_type: image.mediaType, data: Buffer.from(image.data).toString('base64') },
      },
    ];
    candidates.forEach((c, i) => {
      const lines = [`Candidate ${i}: ${c.name}`, c.seller ? `seller: ${c.seller}` : '', c.price ? `price: ${c.price.amount} ${c.price.currency}` : ''];
      content.push({ type: 'text', text: lines.filter(Boolean).join('\n') });
      if (c.imageUrl && isAllowedImageUrl(c.imageUrl)) {
        shown.add(i);
        // 検証した URL をそのまま渡す(正規化済みの href)。
        content.push({ type: 'image', source: { type: 'url', url: new URL(c.imageUrl).href } });
      } else {
        content.push({ type: 'text', text: '(no image for this candidate)' });
      }
    });

    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: SYSTEM,
      output_config: { effort: this.effort, format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content }],
    });
    const usage: Usage = { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
    if (res.stop_reason === 'refusal') throw new ComparisonError('refusal', usage);
    if (res.stop_reason === 'max_tokens') throw new ComparisonError('truncated', usage);
    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
    let json: unknown;
    try {
      json = JSON.parse(text ?? '');
    } catch {
      throw new ComparisonError('not json', usage);
    }
    const parsed = Output.safeParse(json);
    if (!parsed.success) throw new ComparisonError('schema', usage);

    const seen = new Set<number>();
    const judgements: Judgement[] = [];
    for (const r of parsed.data.results) {
      const cand = candidates[r.index];
      if (!cand || seen.has(r.index)) continue;
      if (!Number.isFinite(r.similarity) || r.similarity < 0 || r.similarity > 1) continue;
      seen.add(r.index);
      judgements.push({
        index: r.index,
        // 画像を見せていない候補は、同一商品とは判断できない。
        sameProduct: shown.has(r.index) ? r.same_product : false,
        nameMatchesFeatures: r.name_matches_features,
        similarity: r.similarity,
        matched: r.matched.slice(0, 5),
        unconfirmed: r.unconfirmed.slice(0, 5),
      });
    }
    return { judgements, usage };
  }
}
