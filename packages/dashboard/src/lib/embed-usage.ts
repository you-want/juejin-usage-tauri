export const EMBED_STYLE_OPTIONS = [
  { id: 'classic-light', label: 'Classic Light', description: '浅色经典卡片' },
  { id: 'classic-dark', label: 'Classic Dark', description: '深色经典卡片' },
  { id: 'compact', label: 'Compact', description: '紧凑横向卡片' },
  { id: 'tokens-only', label: 'Tokens-only', description: '仅展示 Token' },
  { id: 'stats-row', label: 'Stats Row', description: '输入与输出分列' },
  { id: 'badge', label: 'Minimal badge', description: '三枚徽章组合' },
] as const;
export type EmbedStyle = typeof EMBED_STYLE_OPTIONS[number]['id'];
const target = 'https://juejin.cn/aiusage/?from=embed';
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function buildEmbedSnippets(publicApiBase: string, key: string, style: EmbedStyle) {
  if (!EMBED_STYLE_OPTIONS.some(option => option.id === style)) throw new Error('INVALID_EMBED_STYLE');
  const base = new URL(publicApiBase);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password) throw new Error('INVALID_EMBED_API_BASE');
  base.search = ''; base.hash = '';
  const url = `${base.toString().replace(/\/$/, '')}/embed/v1/${encodeURIComponent(key)}/${style}.svg`;
  return {
    url,
    markdown: `[![Juejin AI Usage](${url})](${target})`,
    html: `<a href="${escapeAttribute(target)}"><img src="${escapeAttribute(url)}" alt="Juejin AI Usage" /></a>`,
  };
}
