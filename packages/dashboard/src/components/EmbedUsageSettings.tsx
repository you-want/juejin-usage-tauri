import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Modal, Surface, Toast, ToastQueue } from '@heroui/react';
import {
  enableEmbedKey, fetchEmbedKey, getApiBearer, getEmbedApiBase,
  rotateEmbedKey, setEmbedKeyEnabled, type EmbedKeyView,
} from '@/lib/api';
import { buildEmbedSnippets, EMBED_STYLE_OPTIONS, type EmbedStyle } from '@/lib/embed-usage';
import { JUEJIN_HOME } from '@/lib/juejin-client-link';
import { JUEJIN_LINK_CHANGED_EVENT } from '@/lib/shell-events';

const message = (error: unknown) => error instanceof Error ? error.message : '请求失败，请稍后重试';
// Derive an accessible primary fill from the existing HeroUI accent.
const primaryTone = 'bg-[color-mix(in_srgb,var(--accent)_80%,black)] text-accent-foreground';

export function EmbedUsageSettings() {
  const [identity, setIdentity] = useState(getApiBearer);
  const [record, setRecord] = useState<EmbedKeyView | null>(null);
  const [style, setStyle] = useState<EmbedStyle>('classic-light');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [queue] = useState(() => new ToastQueue({ maxVisibleToasts: 1 }));
  const requestVersion = useRef(0);
  const writing = useRef(false);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    const user = getApiBearer();
    setIdentity(user); setRecord(null); setError(null); setRotateOpen(false);
    setLoading(Boolean(user)); setBusy(false); writing.current = false;
    if (!user) return;
    try {
      const result = await fetchEmbedKey();
      if (version === requestVersion.current && user === getApiBearer()) setRecord(result);
    } catch (cause) {
      if (version === requestVersion.current && user === getApiBearer()) {
        const detail = message(cause);
        if (/UNAUTHENTICATED|unauthorized|401/i.test(detail)) setIdentity(null);
        setError(detail);
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const changed = () => { void refresh(); };
    window.addEventListener('tud:api-identity-changed', changed);
    window.addEventListener(JUEJIN_LINK_CHANGED_EVENT, changed);
    const onStorage = (event: StorageEvent) => { if (event.key === 'tud.apiBearer' || event.key === null) changed(); };
    window.addEventListener('storage', onStorage);
    return () => {
      requestVersion.current++;
      window.removeEventListener('tud:api-identity-changed', changed);
      window.removeEventListener(JUEJIN_LINK_CHANGED_EVENT, changed);
      window.removeEventListener('storage', onStorage);
    };
  }, [refresh]);

  const mutate = async (action: () => Promise<EmbedKeyView>, title: string) => {
    if (writing.current) return;
    writing.current = true;
    const version = ++requestVersion.current;
    const user = getApiBearer();
    setBusy(true); setError(null);
    try {
      const result = await action();
      if (version !== requestVersion.current || user !== getApiBearer()) return;
      setRecord(result); setRevision(value => value + 1); setRotateOpen(false);
      queue.add({ title, variant: 'success' });
    } catch (cause) {
      if (version === requestVersion.current && user === getApiBearer()) setError(message(cause));
    } finally {
      if (version === requestVersion.current) { setBusy(false); writing.current = false; }
    }
  };

  const snippets = record?.key ? buildEmbedSnippets(getEmbedApiBase(), record.key, style) : null;
  useEffect(() => { setPreviewError(false); }, [snippets?.url, revision]);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      queue.add({ title: '已复制', variant: 'success' });
    } catch {
      queue.add({ title: '复制失败', description: '请选中下方文本手动复制。', variant: 'danger' });
    }
  };

  return <section className="space-y-5 font-sans text-sm text-foreground">
    <Toast.Provider placement="top end" queue={queue} />
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-base font-semibold">把你的 AI 用量带到任何地方</h3>
      {record?.key && <span className={`rounded-full px-2.5 py-1 text-xs ${record.enabled ? 'bg-success/10 text-[color-mix(in_srgb,var(--success)_55%,black)] dark:text-success' : 'bg-default text-foreground/75'}`}>{record.enabled ? '已启用' : '已停用'}</span>}
    </div>
    <p className="text-xs leading-relaxed text-muted">选择样式，复制到博客或 GitHub README。图片读取云端已同步用量，汇总全部设备，今日按北京时间统计。</p>
    {error && <div role="alert" className="rounded-xl bg-danger/10 p-3 text-xs text-danger">{error}{!record && <Button size="sm" variant="ghost" onPress={() => void refresh()}>重试</Button>}</div>}
    {!identity ? <Surface className="space-y-3 rounded-xl p-4">
      <p>登录掘金后即可生成用量卡片。</p>
      <Button className={primaryTone} size="sm" onPress={() => window.location.assign(JUEJIN_HOME)}>登录掘金</Button>
    </Surface> : loading ? <p role="status" className="py-10 text-center text-muted">正在读取展示设置…</p> : record && !record.key ? <Surface className="space-y-4 rounded-xl p-5">
      <h4 className="font-medium">让用量成为你的名片</h4>
      <p className="text-xs leading-relaxed text-muted">启用后，持有链接的人可以查看你的昵称、头像、累计和今日 Token、输入输出及费用。Tokens-only 仅改变排版，持有同一标识的人仍可选择其他样式查看费用。</p>
      <Button className={primaryTone} size="sm" isDisabled={busy} isPending={busy} onPress={() => void mutate(enableEmbedKey, '已启用公开展示')}>启用并生成链接</Button>
    </Surface> : snippets && record ? <div className="grid gap-5 md:grid-cols-2">
      <div className="min-w-0 space-y-4">
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="卡片样式">
          {EMBED_STYLE_OPTIONS.map(option => <Button key={option.id} size="sm" aria-pressed={style === option.id} variant={style === option.id ? 'primary' : 'secondary'} onPress={() => setStyle(option.id)} className={`h-auto min-h-10 flex-col items-start gap-0.5 px-3 py-2 text-left ${style === option.id ? primaryTone : ''}`}>
            <span className="text-xs">{option.label}</span><span className="text-[10px] opacity-70">{option.description}</span>
          </Button>)}
        </div>
        <Surface className="flex min-h-36 items-center justify-center rounded-xl p-3" variant="secondary">
          {previewError ? <div role="status" className="space-y-2 text-center text-xs text-muted"><p>暂时无法加载预览</p><Button size="sm" variant="tertiary" onPress={() => { setPreviewError(false); setRevision(value => value + 1); }}>重试预览</Button></div>
            : <img key={`${snippets.url}:${revision}`} src={`${snippets.url}?v=${revision}`} onError={() => setPreviewError(true)} alt={record.enabled ? '用量卡片实时预览' : '停用后的掘金导流卡预览'} className="h-auto max-w-full" referrerPolicy="no-referrer" />}
        </Surface>
        <p className="text-center text-[11px] text-muted">{record.enabled ? '云端用量自动更新；外部网站缓存可能延迟刷新。' : '当前链接展示掘金介绍卡，重新启用可恢复。'}</p>
        <div className="space-y-2"><h4 className="text-xs font-medium">公开展示标识</h4><code className="block select-all break-all rounded-lg bg-default/50 p-3 font-mono text-xs">{record.key}</code></div>
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => void mutate(() => setEmbedKeyEnabled(!record.enabled), record.enabled ? '已停用展示' : '已重新启用')}>{record.enabled ? '停用展示' : '重新启用'}</Button>
          <Button size="sm" variant="danger-soft" isDisabled={busy} onPress={() => setRotateOpen(true)}>重新生成标识</Button>
        </div>
        <p className="text-[11px] leading-relaxed text-muted">所有样式共用此标识。停用或重新生成后，旧链接在源站展示掘金介绍卡；已被外部网站缓存的图片可能延迟更新。</p>
      </div>
      <Surface className="min-w-0 space-y-5 rounded-xl p-4" variant="secondary">
        <h4 className="font-medium">复制并嵌入</h4>
        {([['图片链接', snippets.url, '复制链接'], ['Markdown · GitHub / 博客', snippets.markdown, '复制 Markdown'], ['HTML · 个人网站', snippets.html, '复制 HTML']] as const).map(([label, text, action]) => <div key={label} className="space-y-2">
          <h5 className="text-xs font-medium">{label}</h5><pre role="region" tabIndex={0} aria-label={label} className="whitespace-pre-wrap break-all select-all rounded-lg border border-border bg-surface p-3 font-mono text-[11px] leading-relaxed">{text}</pre><Button className={action === '复制 Markdown' ? primaryTone : undefined} size="sm" variant={action === '复制 Markdown' ? 'primary' : 'tertiary'} onPress={() => void copy(text)}>{action}</Button>
        </div>)}
        <p className="text-[11px] leading-relaxed text-foreground/70">适用于支持外链 SVG 的平台，无需为不同网站单独创建卡片。</p>
      </Surface>
    </div> : null}
    <Modal.Backdrop isOpen={rotateOpen} onOpenChange={open => { if (!busy) setRotateOpen(open); }}>
      <Modal.Container size="sm"><Modal.Dialog aria-label="重新生成展示标识">
        <Modal.Header><Modal.Heading>重新生成标识？</Modal.Heading></Modal.Header>
        <Modal.Body><p className="text-sm text-muted">所有样式的旧链接都会失效。请在生成后重新复制链接，并更新已嵌入的页面。</p></Modal.Body>
        <Modal.Footer><Button variant="tertiary" isDisabled={busy} onPress={() => setRotateOpen(false)}>取消</Button><Button variant="danger" isPending={busy} isDisabled={busy} onPress={() => void mutate(rotateEmbedKey, '已生成新标识，请更新嵌入链接')}>重新生成</Button></Modal.Footer>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>
  </section>;
}
