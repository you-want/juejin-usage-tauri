import type { LeaderboardMetric, LeaderboardRange } from '@/lib/api';
import { getModelProvider } from './model-provider.ts';

export type RankRange = LeaderboardRange;

export const RANK_RANGES = ['today', 'week', 'month', 'all'] as const;

export function isRankRange(value: unknown): value is RankRange {
  return (
    typeof value === 'string' &&
    (RANK_RANGES as readonly string[]).includes(value)
  );
}

export interface RankModelOption {
  tool: string;
  model: string;
}

export const RANK_MODEL_VENDORS = [
  { key: 'anthropic', label: 'Anthropic', icon: 'claude' },
  { key: 'openai', label: 'OpenAI', icon: 'openai' },
  { key: 'google', label: 'Google', icon: 'google' },
  { key: 'alibaba', label: '阿里', icon: 'alibaba' },
  { key: 'moonshot', label: 'Moonshot', icon: 'moonshot' },
  { key: 'xai', label: 'xAI', icon: 'grok' },
  { key: 'deepseek', label: 'DeepSeek', icon: 'deepseek' },
  { key: 'zhipu', label: 'Zhipu', icon: 'zhipu' },
  { key: 'other', label: '其他', icon: 'unknown' },
] as const;

export type RankModelVendorKey = (typeof RANK_MODEL_VENDORS)[number]['key'];

export interface RankModelVendorGroup {
  key: RankModelVendorKey;
  label: string;
  icon: string;
  models: string[];
}

const RANK_VENDOR_KEYS: Record<string, RankModelVendorKey> = {
  anthropic: 'anthropic',
  claude: 'anthropic',
  codex: 'openai',
  openai: 'openai',
  gemini: 'google',
  google: 'google',
  alibaba: 'alibaba',
  qwen: 'alibaba',
  kimi: 'moonshot',
  moonshot: 'moonshot',
  grok: 'xai',
  xai: 'xai',
  deepseek: 'deepseek',
  zai: 'zhipu',
  zhipu: 'zhipu',
};

/** 将排行榜模型归入产品约定的固定厂商，并按厂商与模型名支持模糊搜索。 */
export function groupRankModelsByVendor(
  models: readonly string[],
  query = '',
): RankModelVendorGroup[] {
  const buckets = new Map<RankModelVendorKey, string[]>();
  for (const vendor of RANK_MODEL_VENDORS) buckets.set(vendor.key, []);

  for (const model of new Set(models.filter(Boolean))) {
    const provider = getModelProvider(model);
    const vendorKey = RANK_VENDOR_KEYS[provider.key] ?? 'other';
    buckets.get(vendorKey)?.push(model);
  }

  const normalizedQuery = query.trim().toLocaleLowerCase();
  return RANK_MODEL_VENDORS.flatMap((vendor) => {
    const modelsForVendor = buckets.get(vendor.key) ?? [];
    const vendorMatches = vendor.label
      .toLocaleLowerCase()
      .includes(normalizedQuery);
    const filteredModels =
      normalizedQuery && !vendorMatches
        ? modelsForVendor.filter((model) =>
            `${vendor.label} ${model}`
              .toLocaleLowerCase()
              .includes(normalizedQuery),
          )
        : modelsForVendor;

    if (filteredModels.length === 0) return [];
    return [
      { ...vendor, models: filteredModels.sort((a, b) => a.localeCompare(b)) },
    ];
  });
}

/**
 * Return the model options that can be rendered by a single Select collection.
 *
 * The API stores tool/model pairs, so a model used by more than one tool can
 * occur more than once when no tool is selected. HeroUI's ListBox is keyed by
 * the option id (the model name in RankFilter), and duplicate ids corrupt
 * React Aria's collection when the options change asynchronously.
 */
export function uniqueRankModelOptions(
  options: readonly RankModelOption[],
  tool = '',
): RankModelOption[] {
  const seen = new Set<string>();
  const result: RankModelOption[] = [];

  for (const option of options) {
    if (tool && option.tool !== tool) continue;
    if (!option.model || seen.has(option.model)) continue;
    seen.add(option.model);
    result.push(option);
  }

  return result;
}

export function formatRankPosition(rank: number | null | undefined): string {
  if (rank === null || rank === undefined || !Number.isFinite(rank) || rank < 1) {
    return '—';
  }
  return rank > 99 ? '> 99' : String(Math.floor(rank));
}

export function leaderboardMetricLabel(metric: LeaderboardMetric): string {
  return metric === 'cost' ? '按消费' : '按 Token';
}
