import type Anthropic from '@anthropic-ai/sdk';

import type { Detector, DetectorImage, DetectorResult } from '@coordinate/shared';

import type { Effort } from '../config';
import { normalizeDetection } from './normalize';
import { SYSTEM_PROMPT, USER_PROMPT } from './prompt';
import { OUTPUT_JSON_SCHEMA, RawOutputSchema } from './schema';

/** テストで差し替えられるよう、必要な部分だけを型にする。 */
export type MessagesClient = {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
};

export type DetectionErrorCode = 'refusal' | 'truncated' | 'invalid_output';

export class DetectionError extends Error {
  constructor(
    readonly code: DetectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DetectionError';
  }
}

export class ClaudeVisionDetector implements Detector {
  constructor(
    private readonly client: MessagesClient,
    private readonly model: string,
    private readonly effort: Effort,
  ) {}

  async detect(image: DetectorImage): Promise<DetectorResult> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      // Sonnet 5.5 は tool_choice の強制が使えないため、構造化出力で JSON を得る。
      output_config: { effort: this.effort, format: { type: 'json_schema', schema: OUTPUT_JSON_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: image.mediaType,
                data: Buffer.from(image.data).toString('base64'),
              },
            },
            { type: 'text', text: USER_PROMPT },
          ],
        },
      ],
    });

    if (res.stop_reason === 'refusal') throw new DetectionError('refusal', 'モデルが応答を拒否しました');
    if (res.stop_reason === 'max_tokens') throw new DetectionError('truncated', '出力が途中で打ち切られました');

    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
    let json: unknown;
    try {
      json = JSON.parse(text ?? '');
    } catch {
      throw new DetectionError('invalid_output', '出力が JSON ではありません');
    }
    const parsed = RawOutputSchema.safeParse(json);
    if (!parsed.success) throw new DetectionError('invalid_output', '出力がスキーマに合いません');

    const { items } = normalizeDetection(parsed.data, res.model);
    return {
      items,
      fullBody: parsed.data.full_body,
      model: res.model,
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
    };
  }
}
