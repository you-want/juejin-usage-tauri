import {
  USAGE_CARD_CATALOG,
  USAGE_CARD_TEMPLATES,
  type UsageCardStyle,
} from '@juejin-opensource/jusage-core/usage-cards';

/** Catalog entry used by the embed settings panel (local and/or server). */
export type EmbedStyleOption = {
  id: string;
  label: string;
  description: string;
  order: number;
  width: number;
  height: number;
  avatar: { x: number; y: number; size: number };
  fields: ReadonlyArray<{ key: string; required: boolean; defaultOn?: boolean }>;
  /** True when local SVG artwork exists for client-side preview. */
  hasLocalTemplate?: boolean;
};

/** Local-built catalog (cards:build). Fallback before/without server merge. */
export const EMBED_STYLE_OPTIONS: readonly EmbedStyleOption[] = USAGE_CARD_CATALOG.map((card) => ({
  ...card,
  hasLocalTemplate: true,
}));

export type EmbedStyle = UsageCardStyle;

/**
 * Merge server catalog API with local USAGE_CARD_CATALOG.
 * Start from server (or empty), then overlay local by id — **local wins** on clash.
 * Local-only and server-only ids both appear; preview needs local SVG.
 */
export function mergeEmbedCatalog(
  server: ReadonlyArray<EmbedStyleOption> | null | undefined,
): EmbedStyleOption[] {
  const byId = new Map<string, EmbedStyleOption>();
  for (const card of server ?? []) {
    if (!card?.id) continue;
    const hasLocalTemplate = Object.prototype.hasOwnProperty.call(USAGE_CARD_TEMPLATES, card.id);
    byId.set(card.id, { ...card, hasLocalTemplate });
  }
  for (const card of USAGE_CARD_CATALOG) {
    byId.set(card.id, { ...card, hasLocalTemplate: true });
  }
  return [...byId.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function hasLocalEmbedTemplate(templateId: string): boolean {
  return Object.prototype.hasOwnProperty.call(USAGE_CARD_TEMPLATES, templateId);
}

export type EmbedCopyFormat =
  | 'markdown-page'
  | 'markdown-image'
  | 'markdown-modal'
  | 'markdown-from-share'
  | 'html-page'
  | 'url';

export type EmbedPreviewProfile = {
  userName?: string;
  /** https CDN URL from session; used in inline-SVG preview. */
  avatarUrl?: string;
};

const USAGE_PAGE = 'https://juejin.cn/aiusage/?from=embed';

const LOGO_PATH = 'm12 14.316 7.454-5.88-2.022-1.625L12 11.1l-.004.003-5.432-4.288-2.02 1.624 7.452 5.88Zm0-7.247 2.89-2.298L12 2.453l-.004-.005-2.884 2.318 2.884 2.3Zm0 11.266-.005.002-9.975-7.87L0 12.088l.194.156 11.803 9.308 7.463-5.885L24 12.085l-2.023-1.624Z';

/** Demo numbers for local modal preview (not live usage). */
const PREVIEW_DEMO = {
  total: '12.4M',
  cost: '$42.80',
  today: '186K',
  input: '8.1M',
  output: '4.3M',
  since: 'since 2025-03',
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

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function brandAvatar(x: number, y: number, size: number): string {
  if (!size) return '';
  return `<g transform="translate(${x} ${y}) scale(${size / 24})"><rect width="24" height="24" rx="6" fill="#087ffa"/><path d="${LOGO_PATH}" fill="#fff" transform="translate(2.4 2.4) scale(.8)"/></g>`;
}

function isSafeHttpsAvatarUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (url.port && url.port !== '443') return false;
    // Same CDN families the server allowlists (display-only; not fetched here).
    const host = url.hostname.toLowerCase();
    return (
      /^p\d+-passport\.byteacctimg\.com$/.test(host)
      || /^p\d+-passport\.byteimg\.com$/.test(host)
      || /^p\d+-(jj|juejin)\.byteimg\.com$/.test(host)
    );
  } catch {
    return false;
  }
}

function avatarMarkup(
  x: number,
  y: number,
  size: number,
  showAvatar: boolean,
  avatarUrl?: string,
): string {
  if (!showAvatar || !size) return '';
  if (avatarUrl && isSafeHttpsAvatarUrl(avatarUrl)) {
    return `<defs><clipPath id="avatar-clip"><circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2}"/></clipPath></defs><image x="${x}" y="${y}" width="${size}" height="${size}" href="${escapeAttribute(avatarUrl)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatar-clip)"/>`;
  }
  return brandAvatar(x, y, size);
}

/**
 * Pack optional columns left so hidden fields do not leave blank holes.
 * Keep in sync with ai-usage apps/server/src/embed/templates.ts.
 */
export function computeEmbedLayoutPositions(
  templateId: string,
  avatar: { x: number; y: number; size: number },
  enabled: ReadonlySet<string>,
): Record<string, string> {
  const showAvatar = enabled.has('avatar') && avatar.size > 0;
  const namePad = templateId === 'compact' || templateId === 'stats-row' ? 20 : 28;
  const nameX = showAvatar ? avatar.x + avatar.size + 8 : namePad;

  const hasIdentity = enabled.has('name') || showAvatar;
  // Compact keeps a since line in the header band; don't collide with metrics.
  const hasTopBand = hasIdentity || (templateId === 'compact' && enabled.has('since'));
  let yMetrics = '0';
  if (!hasTopBand) {
    if (templateId === 'compact' || templateId === 'stats-row') yMetrics = '-32';
    else if (templateId !== 'badge') yMetrics = '-36';
  }

  // Single-line identity (no subtitle): vertically center name with avatar.
  // Compact keeps a top-aligned two-line header when since is on.
  const twoLineHeader =
    (templateId === 'compact' && enabled.has('since'))
    || templateId === 'stats-row';
  let nameY = templateId === 'compact' || templateId === 'stats-row' ? 28 : 32;
  if (showAvatar && !twoLineHeader) {
    nameY = avatar.y + avatar.size / 2;
  } else if (!showAvatar && !twoLineHeader) {
    nameY = templateId === 'compact' ? 32 : 36;
  } else if (showAvatar && templateId === 'compact' && enabled.has('since')) {
    // Keep first-line optical position near previous y=28 baseline.
    nameY = avatar.y + Math.round(avatar.size * 0.35);
  }

  const out: Record<string, string> = {
    x_name: String(nameX),
    y_name: String(nameY),
    x_total: '0',
    x_cost: '0',
    x_today: '0',
    x_input: '0',
    x_output: '0',
    y_metrics: yMetrics,
  };

  const assignPacked = (keys: string[], slots: number[]) => {
    const visible = keys.filter(key => enabled.has(key));
    visible.forEach((key, index) => {
      out[`x_${key}`] = String(slots[Math.min(index, slots.length - 1)]!);
    });
  };

  switch (templateId) {
    case 'badge': {
      // Widths match cards/badge/template.svg shields segments; 4px gap.
      const badges: { key: string; width: number }[] = [
        { key: 'total', width: 98 },
        { key: 'cost', width: 90 },
        { key: 'today', width: 88 },
      ];
      let x = 0;
      for (const badge of badges) {
        if (!enabled.has(badge.key)) continue;
        out[`x_${badge.key}`] = String(x);
        x += badge.width + 4;
      }
      break;
    }
    case 'classic-light':
    case 'classic-dark':
      assignPacked(['total', 'cost', 'today'], [28, 168, 308]);
      break;
    case 'compact':
      assignPacked(['total', 'cost', 'today'], [20, 150, 280]);
      break;
    case 'stats-row':
      assignPacked(['total', 'input', 'output'], [20, 150, 280]);
      break;
    case 'tokens-only':
      assignPacked(['total', 'today'], [28, 220]);
      break;
    default:
      assignPacked(['total', 'cost', 'today'], [28, 168, 308]);
      break;
  }

  return out;
}

/** Apply {{#if key}}...{{/if}}; peel leaf blocks so nested ifs resolve inside-out. */
export function applyEmbedConditionals(template: string, enabled: ReadonlySet<string>): string {
  const pattern = /\{\{\s*#if\s+(\w+)\s*\}\}((?:(?!\{\{\s*#if)[\s\S])*?)\{\{\s*\/if\s*\}\}/;
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
 * Uses demo metrics + the signed-in user's name/avatar when available.
 */
export function renderLocalEmbedPreviewSvg(
  templateId: string,
  showFields: readonly string[],
  profile?: EmbedPreviewProfile,
): string | null {
  const catalog = USAGE_CARD_CATALOG.find(c => c.id === templateId);
  const template = USAGE_CARD_TEMPLATES[templateId as UsageCardStyle];
  if (!catalog || !template) return null;

  const enabled = new Set(showFields);
  for (const field of catalog.fields) {
    if (field.required) enabled.add(field.key);
  }

  const displayName = (profile?.userName?.trim() || '掘金开发者').slice(0, 16);
  const layout = computeEmbedLayoutPositions(templateId, catalog.avatar, enabled);
  const values: Record<string, string> = {
    ...PREVIEW_DEMO,
    ...layout,
    name: escapeXml(displayName),
    since: escapeXml(PREVIEW_DEMO.since),
    avatar: avatarMarkup(
      catalog.avatar.x,
      catalog.avatar.y,
      catalog.avatar.size,
      enabled.has('avatar'),
      profile?.avatarUrl,
    ),
  };

  let content = applyEmbedConditionals(template, enabled);
  content = applyEmbedPlaceholders(content, values);
  return content;
}

export function localEmbedPreviewDataUrl(
  templateId: string,
  showFields: readonly string[],
  profile?: EmbedPreviewProfile,
): string | null {
  const svg = renderLocalEmbedPreviewSvg(templateId, showFields, profile);
  if (!svg) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
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

export function defaultShowFieldsForTemplate(
  templateId: string,
  catalog: readonly EmbedStyleOption[] = EMBED_STYLE_OPTIONS,
): string[] {
  const card = catalog.find(c => c.id === templateId);
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
