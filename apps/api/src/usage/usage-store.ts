import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type MonthlyUsage = { serpapi: number; rakuten: number; claudeInput: number; claudeOutput: number };
export type DailyKind = 'install' | 'ip';

export interface UsageStore {
  monthly(now: Date): MonthlyUsage;
  addMonthly(now: Date, delta: Partial<MonthlyUsage>): void;
  /** 上限内なら 1 回ぶん消費して true。上限に達していれば消費せず false。 */
  tryConsumeDaily(now: Date, kind: DailyKind, id: string, limit: number): boolean;
}

type FileShape = { months: Record<string, MonthlyUsage>; days: Record<string, Record<string, number>> };

export const monthKey = (d: Date) => d.toISOString().slice(0, 7);
export const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const hash = (kind: string, id: string) => createHash('sha256').update(`${kind}:${id}`).digest('hex').slice(0, 16);
const empty = (): MonthlyUsage => ({ serpapi: 0, rakuten: 0, claudeInput: 0, claudeOutput: 0 });

/** 数値の集計だけを保存する。写真・検索結果・生の識別子は入れない。path が null ならメモリのみ。 */
export class FileUsageStore implements UsageStore {
  private data: FileShape = { months: {}, days: {} };

  constructor(private readonly path: string | null) {
    if (path && existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<FileShape>;
        this.data = { months: parsed.months ?? {}, days: parsed.days ?? {} };
      } catch {
        // 壊れていたら空から始める(集計が消えるだけで、動作は続ける)
      }
    }
  }

  monthly(now: Date): MonthlyUsage {
    return { ...empty(), ...this.data.months[monthKey(now)] };
  }

  addMonthly(now: Date, delta: Partial<MonthlyUsage>): void {
    const cur = this.monthly(now);
    this.data.months[monthKey(now)] = {
      serpapi: cur.serpapi + (delta.serpapi ?? 0),
      rakuten: cur.rakuten + (delta.rakuten ?? 0),
      claudeInput: cur.claudeInput + (delta.claudeInput ?? 0),
      claudeOutput: cur.claudeOutput + (delta.claudeOutput ?? 0),
    };
    this.save();
  }

  tryConsumeDaily(now: Date, kind: DailyKind, id: string, limit: number): boolean {
    const today = dayKey(now);
    for (const k of Object.keys(this.data.days)) if (k < today) delete this.data.days[k];
    const day = (this.data.days[today] ??= {});
    const key = hash(kind, id);
    const used = day[key] ?? 0;
    if (used >= limit) return false;
    day[key] = used + 1;
    this.save();
    return true;
  }

  /** テスト用: 保持している日次カウンタの数。 */
  dailyKeyCount(): number {
    return Object.values(this.data.days).reduce((n, day) => n + Object.keys(day).length, 0);
  }

  private save(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.path);
  }
}
