import { Button } from '@heroui/react';

/** Local (or remote) card preview by inline SVG markup and/or image URL. */
export function EmbedCardPreview({
  svg,
  url,
  enabled,
  label,
}: {
  /** Preferred: inline SVG so remote avatar <image href> can paint in-preview. */
  svg?: string | null;
  url?: string | null;
  enabled: boolean;
  label?: string;
}) {
  return (
    <section aria-label={label ?? '用量卡片预览'} className="min-w-0 space-y-3">
      <div className="flex min-h-40 w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-surface p-3">
        {svg ? (
          <div
            className="flex h-auto max-h-64 w-full items-center justify-center [&_svg]:h-auto [&_svg]:max-h-64 [&_svg]:w-full [&_svg]:max-w-full"
            // Markup comes from our catalog templates + escaped session fields only.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : url ? (
          <img
            src={url}
            alt={enabled ? '用量卡片预览' : '停用后的用量卡片预览'}
            className="h-auto max-h-64 w-full object-contain"
            referrerPolicy="no-referrer"
          />
        ) : null}
      </div>
      {!enabled && (
        <p className="text-center text-xs text-muted">已停用 · 公开链接暂不展示用量</p>
      )}
    </section>
  );
}

/** Empty state when local template cannot be rendered. */
export function EmbedCardPreviewEmpty({
  onRetry,
  message,
}: {
  onRetry?: () => void;
  /** Override the default “无法生成本地预览” copy. */
  message?: string;
}) {
  return (
    <section aria-label="用量卡片预览" className="min-w-0 space-y-3">
      <div className="flex min-h-40 w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-surface p-3">
        <div role="status" className="space-y-2 text-center text-sm text-muted">
          <p>{message || '无法生成本地预览'}</p>
          {onRetry ? (
            <Button size="sm" variant="tertiary" onPress={onRetry}>重试预览</Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** @deprecated kept as alias for older imports */
export function EmbedUsageCarousel(props: {
  apiBase?: string;
  publicKey?: string;
  style?: string;
  enabled: boolean;
  url?: string;
  svg?: string;
  onStyleChange?: (style: string) => void;
}) {
  if (!props.svg && !props.url) return null;
  return <EmbedCardPreview svg={props.svg} url={props.url} enabled={props.enabled} />;
}
