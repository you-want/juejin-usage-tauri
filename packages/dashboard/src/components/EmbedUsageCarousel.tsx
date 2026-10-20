import { useState } from 'react';
import { Button } from '@heroui/react';

/** Live preview of a public card SVG by URL. */
export function EmbedCardPreview({
  url,
  enabled,
  label,
}: {
  url: string;
  enabled: boolean;
  label?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  return (
    <section aria-label={label ?? '用量卡片预览'} className="min-w-0 space-y-3">
      <div className="flex min-h-40 w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-surface p-3">
        {failed ? (
          <div role="status" className="space-y-2 text-center text-sm text-muted">
            <p>暂时无法加载预览</p>
            <Button
              size="sm"
              variant="tertiary"
              onPress={() => {
                setFailed(false);
                setRetry(value => value + 1);
              }}
            >
              重试预览
            </Button>
          </div>
        ) : (
          <img
            key={retry}
            src={`${url}${url.includes('?') ? '&' : '?'}v=${retry}`}
            onError={() => setFailed(true)}
            alt={enabled ? '用量卡片实时预览' : '停用后的掘金导流卡预览'}
            className="h-auto max-h-64 w-full object-contain"
            referrerPolicy="no-referrer"
          />
        )}
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
  onStyleChange?: (style: string) => void;
}) {
  if (!props.url) return null;
  return <EmbedCardPreview url={props.url} enabled={props.enabled} />;
}
