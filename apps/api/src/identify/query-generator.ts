import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { DEFAULT_CATEGORIES, type DetectedItem, type Usage } from '@coordinate/shared';

import type { Effort } from '../config';
import type { MessagesClient } from '../detector/claude-vision-detector';

export class QueryGenerationError extends Error {
  /** 応答を受け取ったあとの失敗では、取得済みの使用量(課金済み)を持つ。 */
  constructor(
    detail: string,
    readonly usage?: Usage,
  ) {
    super(`QueryGenerationError: ${detail}`);
    this.name = 'QueryGenerationError';
  }
}

const Output = z.object({ queries: z.array(z.string()) });
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['queries'],
  properties: { queries: { type: 'array', items: { type: 'string' } } },
} as const;

const SYSTEM = `You write web shopping search queries (in Japanese, optionally with English brand words) for one clothing or accessory item that was observed in a photo.

Rules:
- Return 1 to 3 queries, from the most specific to the most general.
- Use only the facts given. Include a brand only if the "brand" field is present. Never guess a brand, model name, or model number.
- Include the item type, the main color, and any legible text or distinctive design words that were given.
- Each query is at most 8 words. No quotes, no operators.`;

const categoryName = (id: string) => DEFAULT_CATEGORIES.find((c) => c.id === id)?.labelJa ?? id;

export class QueryGenerator {
  constructor(
    private readonly client: MessagesClient,
    private readonly model: string,
    private readonly effort: Effort,
  ) {}

  async generate(item: DetectedItem): Promise<{ queries: string[]; usage: Usage }> {
    const facts = {
      category: categoryName(item.categoryId),
      colors: item.appearance.colors,
      pattern: item.appearance.pattern ?? null,
      material: item.appearance.material ?? null,
      legible_text: item.appearance.visibleText,
      brand: item.brandCandidates[0]?.name ?? null,
      notes: item.appearance.notes ?? null,
    };
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 512,
      system: SYSTEM,
      output_config: { effort: this.effort, format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(facts) }] }],
    });
    const usage: Usage = { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
    if (res.stop_reason === 'refusal') throw new QueryGenerationError('refusal', usage);
    if (res.stop_reason === 'max_tokens') throw new QueryGenerationError('truncated', usage);
    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
    let json: unknown;
    try {
      json = JSON.parse(text ?? '');
    } catch {
      throw new QueryGenerationError('not json', usage);
    }
    const parsed = Output.safeParse(json);
    if (!parsed.success) throw new QueryGenerationError('schema', usage);

    const seen = new Set<string>();
    const queries: string[] = [];
    for (const q of parsed.data.queries) {
      const t = q.trim();
      if (t === '' || t.length > 80 || seen.has(t)) continue;
      seen.add(t);
      queries.push(t);
      if (queries.length === 3) break;
    }
    if (queries.length === 0) throw new QueryGenerationError('empty', usage);
    return { queries, usage };
  }
}
