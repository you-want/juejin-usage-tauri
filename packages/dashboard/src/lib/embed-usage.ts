import { USAGE_CARD_CATALOG, type UsageCardStyle } from '@juejin-opensource/jusage-core/usage-cards';

export const EMBED_STYLE_OPTIONS = USAGE_CARD_CATALOG;
export type EmbedStyle = UsageCardStyle;

export type EmbedCopyFormat =
  | 'markdown-page'
  | 'markdown-image'
  | 'markdown-modal'
  | 'markdown-from-share'
  | 'html-page'
  | 'url';

const USAGE_PAGE = 'https://juejin.cn/aiusage/?from=embed';

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildEmbedCardUrl(publicApiBase: string, shareId: string): string {
  const base = new URL(publicApiBase);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('INVALID_EMBED_API_BASE');
  }
  base.search = '';
  base.hash = '';
  return `${base.toString().replace(/\/$/, '')}/embed/v1/cards/${encodeURIComponent(shareId)}.svg`;
}

function panelLink(opts: {
  openEmbed?: boolean;
  templateId?: string;
  fromShare?: string;
}): string {
  const url = new URL(USAGE_PAGE);
  if (opts.openEmbed) url.searchParams.set('openEmbed', '1');
  if (opts.templateId) url.searchParams.set('embedTemplate', opts.templateId);
  if (opts.fromShare) url.searchParams.set('fromShare', opts.fromShare);
  return url.toString();
}

export function buildEmbedSnippets(
  publicApiBase: string,
  shareId: string,
  templateId: EmbedStyle | string,
  dims?: { width: number; height: number },
) {
  const url = buildEmbedCardUrl(publicApiBase, shareId);
  const page = USAGE_PAGE;
  const modal = panelLink({ openEmbed: true, templateId });
  const fromShare = panelLink({ openEmbed: true, templateId, fromShare: shareId });
  const w = dims?.width;
  const h = dims?.height;
  const sizeAttrs = w && h ? ` width="${w}" height="${h}"` : '';
  return {
    url,
    formats: [
      {
        id: 'markdown-page' as const,
        label: '链到用量页（推荐）',
        value: `[![Juejin AI Usage](${url})](${page})`,
      },
      {
        id: 'markdown-image' as const,
        label: '纯图片',
        value: `![Juejin AI Usage](${url})`,
      },
      {
        id: 'markdown-modal' as const,
        label: '打开弹窗预选模板',
        value: `[![Juejin AI Usage](${url})](${modal})`,
      },
      {
        id: 'markdown-from-share' as const,
        label: '参照此卡创建',
        value: `[![Juejin AI Usage](${url})](${fromShare})`,
      },
      {
        id: 'html-page' as const,
        label: 'HTML',
        value: `<a href="${escapeAttribute(page)}" target="_blank" rel="noopener noreferrer">\n  <img src="${escapeAttribute(url)}" alt="Juejin AI Usage"${sizeAttrs} />\n</a>`,
      },
      {
        id: 'url' as const,
        label: '图片链接',
        value: url,
      },
    ],
  };
}

export function defaultShowFieldsForTemplate(templateId: string): string[] {
  const card = EMBED_STYLE_OPTIONS.find(c => c.id === templateId);
  if (!card) return [];
  return card.fields
    .filter(f => f.required || Boolean(f.defaultOn))
    .map(f => f.key);
}

export function fieldLabel(key: string): string {
  const labels: Record<string, string> = {
    avatar: '头像',
    name: '昵称',
    total: '总 Token',
    cost: '累计费用',
    today: '今日 Token',
    input: '输入 Token',
    output: '输出 Token',
    since: '首次使用',
    subtitle: '副标题',
    inputPct: '输入占比',
    outputPct: '输出占比',
    totalPct: '总量占比',
  };
  return labels[key] ?? key;
}
