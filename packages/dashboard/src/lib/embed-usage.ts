import {
  USAGE_CARD_CATALOG,
  USAGE_CARD_TEMPLATES,
  type UsageCardStyle,
} from '@juejin-opensource/jusage-core/usage-cards';

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

const LOGO_PATH = 'm12 14.316 7.454-5.88-2.022-1.625L12 11.1l-.004.003-5.432-4.288-2.02 1.624 7.452 5.88Zm0-7.247 2.89-2.298L12 2.453l-.004-.005-2.884 2.318 2.884 2.3Zm0 11.266-.005.002-9.975-7.87L0 12.088l.194.156 11.803 9.308 7.463-5.885L24 12.085l-2.023-1.624Z';

/** Demo numbers for local modal preview (not live usage). */
const PREVIEW_DEMO = {
  name: '掘金开发者',
  total: '12.4M',
  cost: '$42.80',
  today: '186K',
  input: '8.1M',
  output: '4.3M',
  since: 'since 2025-03',
  subtitle: 'Juejin AI Usage',
  inputPct: '65%',
  outputPct: '35%',
  totalPct: '100%',
} as const;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function brandAvatar(x: number, y: number, size: number): string {
  if (!size) return '';
  return `<g transform="translate(${x} ${y}) scale(${size / 24})"><rect width="24" height="24" rx="6" fill="#087ffa"/><path d="${LOGO_PATH}" fill="#fff" transform="translate(2.4 2.4) scale(.8)"/></g>`;
}

/** Apply {{#if key}}...{{/if}}; iterate so nested blocks resolve. */
export function applyEmbedConditionals(template: string, enabled: ReadonlySet<string>): string {
  const pattern = /\{\{\s*#if\s+(\w+)\s*\}\}([\s\S]*?)\{\{\s*\/if\s*\}\}/;
  let previous = '';
  let current = template;
  while (current !== previous) {
    previous = current;
    current = current.replace(pattern, (_match, key: string, inner: string) => (
      enabled.has(key) ? inner : ''
    ));
  }
  return current;
}

export function applyEmbedPlaceholders(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? '');
}

/**
 * Client-side SVG preview from catalog templates + draft field selection.
 * Uses demo values so the modal never needs the public /embed/...svg URL.
 */
export function renderLocalEmbedPreviewSvg(
  templateId: string,
  showFields: readonly string[],
): string | null {
  const catalog = USAGE_CARD_CATALOG.find(c => c.id === templateId);
  const template = USAGE_CARD_TEMPLATES[templateId as UsageCardStyle];
  if (!catalog || !template) return null;

  const enabled = new Set(showFields);
  for (const field of catalog.fields) {
    if (field.required) enabled.add(field.key);
  }

  const values: Record<string, string> = {
    ...PREVIEW_DEMO,
    name: escapeXml(PREVIEW_DEMO.name),
    since: escapeXml(PREVIEW_DEMO.since),
    subtitle: escapeXml(PREVIEW_DEMO.subtitle),
    avatar: brandAvatar(catalog.avatar.x, catalog.avatar.y, catalog.avatar.size),
  };

  let content = applyEmbedConditionals(template, enabled);
  content = applyEmbedPlaceholders(content, values);
  return content;
}

export function localEmbedPreviewDataUrl(
  templateId: string,
  showFields: readonly string[],
): string | null {
  const svg = renderLocalEmbedPreviewSvg(templateId, showFields);
  if (!svg) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

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

export function sameFieldSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}
