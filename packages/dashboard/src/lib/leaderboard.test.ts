import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  groupRankModelsByVendor,
  uniqueRankModelOptions,
  isRankRange,
} from './leaderboard.ts';

describe('isRankRange', () => {
  it('accepts the four leaderboard ranges', () => {
    assert.equal(isRankRange('today'), true);
    assert.equal(isRankRange('week'), true);
    assert.equal(isRankRange('month'), true);
    assert.equal(isRankRange('all'), true);
  });

  it('rejects unknown values', () => {
    assert.equal(isRankRange('last-7-days'), false);
    assert.equal(isRankRange(''), false);
    assert.equal(isRankRange(1), false);
  });
});

describe('uniqueRankModelOptions', () => {
  const options = [
    { tool: 'cursor', model: 'claude-sonnet-4-6' },
    { tool: 'cursor', model: 'gpt-5' },
    { tool: 'claude-code', model: 'claude-sonnet-4-6' },
    { tool: 'claude-code', model: 'claude-opus-4' },
  ];

  it('deduplicates models when all tools are selected', () => {
    assert.deepEqual(uniqueRankModelOptions(options), [
      { tool: 'cursor', model: 'claude-sonnet-4-6' },
      { tool: 'cursor', model: 'gpt-5' },
      { tool: 'claude-code', model: 'claude-opus-4' },
    ]);
  });

  it('filters by tool before deduplicating', () => {
    assert.deepEqual(uniqueRankModelOptions(options, 'claude-code'), [
      { tool: 'claude-code', model: 'claude-sonnet-4-6' },
      { tool: 'claude-code', model: 'claude-opus-4' },
    ]);
  });

  it('ignores empty model ids', () => {
    assert.deepEqual(
      uniqueRankModelOptions([
        { tool: 'cursor', model: '' },
        { tool: 'cursor', model: 'gpt-5' },
      ]),
      [{ tool: 'cursor', model: 'gpt-5' }],
    );
  });
});

describe('groupRankModelsByVendor', () => {
  const models = [
    'claude-sonnet-4-6',
    'Claude Haiku 4.5',
    'fable-5-thinking-max',
    'openai/gpt-5',
    'gemini-2.5-pro',
    'qwen3-coder',
    'kimi-k2.5',
    'K2.7 Code',
    'k3-256k',
    'grok-4',
    'deepseek-chat',
    'glm-5',
    'zai_auto',
    'local/custom-model',
  ];

  it('groups models in the product-defined vendor order', () => {
    assert.deepEqual(
      groupRankModelsByVendor(models).map(({ key, models: groupedModels }) => ({
        key,
        models: groupedModels,
      })),
      [
        {
          key: 'anthropic',
          models: ['Claude Haiku 4.5', 'claude-sonnet-4-6', 'fable-5-thinking-max'],
        },
        { key: 'openai', models: ['openai/gpt-5'] },
        { key: 'google', models: ['gemini-2.5-pro'] },
        { key: 'alibaba', models: ['qwen3-coder'] },
        { key: 'moonshot', models: ['K2.7 Code', 'k3-256k', 'kimi-k2.5'] },
        { key: 'xai', models: ['grok-4'] },
        { key: 'deepseek', models: ['deepseek-chat'] },
        { key: 'zhipu', models: ['glm-5', 'zai_auto'] },
        { key: 'other', models: ['local/custom-model'] },
      ],
    );
  });

  it('matches a vendor name and keeps all models in that vendor', () => {
    assert.deepEqual(
      groupRankModelsByVendor(models, 'Anthro').map((group) => group.models),
      [['Claude Haiku 4.5', 'claude-sonnet-4-6', 'fable-5-thinking-max']],
    );
  });

  it('matches model names case-insensitively together with their vendor', () => {
    assert.deepEqual(
      groupRankModelsByVendor(models, 'GPT').map((group) => group.models),
      [['openai/gpt-5']],
    );
  });

  it('deduplicates repeated model names', () => {
    assert.deepEqual(
      groupRankModelsByVendor(['gpt-5', 'gpt-5'])[0]?.models,
      ['gpt-5'],
    );
  });
});
