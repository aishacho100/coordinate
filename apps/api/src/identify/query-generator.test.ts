import type { MessagesClient } from '../detector/claude-vision-detector';
import { sampleItem } from '../test-utils';
import { QueryGenerationError, QueryGenerator } from './query-generator';

const reply = (text: string, over: Record<string, unknown> = {}) =>
  ({
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    model: 'm',
    usage: { input_tokens: 80, output_tokens: 20 },
    ...over,
  }) as never;
const client = (r: unknown): MessagesClient & { calls: any[] } => {
  const c = {
    calls: [] as any[],
    messages: {
      create: async (p: unknown) => {
        c.calls.push(p);
        return r as never;
      },
    },
  };
  return c;
};

describe('QueryGenerator', () => {
  it('特徴から検索語を作り、トークン数を返す。画像は送らない', async () => {
    const c = client(reply(JSON.stringify({ queries: ['白 Tシャツ メンズ', '白 無地 Tシャツ'] })));
    const g = new QueryGenerator(c, 'm', 'low');
    const r = await g.generate({ ...sampleItem, appearance: { colors: ['白'], visibleText: ['NIKE'] }, brandCandidates: [{ name: 'Nike', score: 0.9 }] });
    expect(r.queries).toEqual(['白 Tシャツ メンズ', '白 無地 Tシャツ']);
    expect(r.usage).toEqual({ inputTokens: 80, outputTokens: 20 });
    const sent = JSON.stringify(c.calls[0]);
    expect(sent).not.toContain('"type":"image"');
    expect(sent).toContain('Nike');
  });
  it('空・重複・長すぎる検索語を除き、最大 3 個にする', async () => {
    const long = 'あ'.repeat(200);
    const c = client(reply(JSON.stringify({ queries: ['a', 'a', ' ', long, 'b', 'c', 'd'] })));
    const r = await new QueryGenerator(c, 'm', 'low').generate(sampleItem);
    expect(r.queries).toEqual(['a', 'b', 'c']);
  });
  it('検索語が 1 つも得られなければ GenerationError', async () => {
    const c = client(reply(JSON.stringify({ queries: [] })));
    await expect(new QueryGenerator(c, 'm', 'low').generate(sampleItem)).rejects.toThrow('QueryGenerationError');
  });
  it('応答を受け取ったあとの検証失敗では、取得済みの usage を例外に載せる', async () => {
    for (const r of [reply('nope'), reply('{}', { stop_reason: 'refusal' }), reply(JSON.stringify({ queries: [] }))]) {
      const err = await new QueryGenerator(client(r), 'm', 'low').generate(sampleItem).catch((e) => e);
      expect(err).toBeInstanceOf(QueryGenerationError);
      expect(err.usage).toEqual({ inputTokens: 80, outputTokens: 20 });
    }
  });
  it('JSON でない・拒否・打ち切りは GenerationError', async () => {
    for (const r of [reply('nope'), reply('{}', { stop_reason: 'refusal' }), reply('{}', { stop_reason: 'max_tokens' })]) {
      await expect(new QueryGenerator(client(r), 'm', 'low').generate(sampleItem)).rejects.toThrow('QueryGenerationError');
    }
  });
});
