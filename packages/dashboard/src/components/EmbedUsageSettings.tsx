import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Chip, Modal, Surface, Tabs, Toast, ToastQueue } from '@heroui/react';
import {
  enableEmbedKey, fetchEmbedKey, getApiBearer, getEmbedApiBase,
  rotateEmbedKey, setEmbedKeyEnabled, type EmbedKeyView,
} from '@/lib/api';
import { buildEmbedSnippets, EMBED_STYLE_OPTIONS, type EmbedStyle } from '@/lib/embed-usage';
import { Check, Copy, RotateCw } from 'lucide-react';
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
  const [format, setFormat] = useState('markdown');
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

  const selectedStyle = EMBED_STYLE_OPTIONS.find(option => option.id === style)!;
  const formats = snippets ? [
    { id: 'markdown', label: 'Markdown', value: snippets.markdown },
    { id: 'html', label: 'HTML', value: snippets.html },
    { id: 'url', label: '图片链接', value: snippets.url },
  ] : [];

  return <section className="space-y-5 font-sans text-sm text-foreground">
    <Toast.Provider placement="top end" queue={queue} />
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-base font-semibold">用量卡片</h3>
      {record?.key && <Chip size="sm" variant="soft" color={record.enabled ? 'success' : 'default'}><Chip.Label>{record.enabled ? '已启用' : '已停用'}</Chip.Label></Chip>}
    </div>
    {error && <div role="alert" className="rounded-xl bg-danger/10 p-3 text-xs text-danger">{error}{!record && <Button size="sm" variant="ghost" onPress={() => void refresh()}>重试</Button>}</div>}
    {!identity ? <Surface className="space-y-3 rounded-xl p-5">
      <p>登录掘金后即可生成用量卡片。</p>
      <Button variant="primary" size="sm" onPress={() => window.location.assign(JUEJIN_HOME)}>登录掘金</Button>
    </Surface> : loading ? <p role="status" className="py-10 text-center text-muted">正在读取展示设置…</p> : record && !record.key ? <Card className="p-5">
      <Card.Header><Card.Title>创建你的用量卡片</Card.Title></Card.Header>
      <Card.Content><p className="text-sm leading-relaxed text-muted">启用后，持有链接的人可以查看你的昵称、头像和用量（含费用）。所有样式共用一个公开标识。</p></Card.Content>
      <Card.Footer><Button variant="primary" isDisabled={busy} isPending={busy} onPress={() => void mutate(enableEmbedKey, '已启用公开展示')}>启用展示</Button></Card.Footer>
    </Card> : snippets && record ? <>
      <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="卡片样式">
            {EMBED_STYLE_OPTIONS.map(option => <Button key={option.id} aria-pressed={style === option.id} variant="secondary" onPress={() => setStyle(option.id)} className={`h-auto min-h-16 w-full justify-between rounded-xl border px-3 py-3 text-left ${style === option.id ? 'border-accent bg-accent/10 text-foreground' : 'border-transparent'}`}>
              <span className="flex min-w-0 flex-col gap-1"><span className="text-xs font-medium">{option.label}</span><span className="text-[11px] font-normal text-muted">{option.description}</span></span>
              {style === option.id && <Check aria-hidden="true" className="size-4 shrink-0 text-accent" />}
            </Button>)}
          </div>
          <Card className="gap-0 overflow-hidden p-0" variant="secondary">
            <Card.Header className="flex-row items-center justify-between px-4 py-3"><Card.Title className="text-xs font-medium">预览</Card.Title><span className="text-xs text-muted">{selectedStyle.label}</span></Card.Header>
            <Card.Content className="flex min-h-52 items-center justify-center border-t border-border bg-default/30 p-4">
              {previewError ? <div role="status" className="space-y-2 text-center text-xs text-muted"><p>暂时无法加载预览</p><Button size="sm" variant="tertiary" onPress={() => { setPreviewError(false); setRevision(value => value + 1); }}>重试预览</Button></div>
                : <img key={`${snippets.url}:${revision}`} src={`${snippets.url}?v=${revision}`} onError={() => setPreviewError(true)} alt={record.enabled ? '用量卡片实时预览' : '停用后的掘金导流卡预览'} className="h-auto w-full max-w-full" referrerPolicy="no-referrer" />}
            </Card.Content>
          </Card>
        </div>
        <Card className="min-w-0 gap-4 p-4" variant="secondary">
          <Card.Header><Card.Title className="text-sm">复制并嵌入</Card.Title></Card.Header>
          <Card.Content>
            <Tabs selectedKey={format} onSelectionChange={key => setFormat(String(key))} className="min-w-0 gap-3">
              <Tabs.ListContainer><Tabs.List aria-label="嵌入格式">
                {formats.map(item => <Tabs.Tab id={item.id} key={item.id} className="px-3 text-xs">{item.label}<Tabs.Indicator /></Tabs.Tab>)}
              </Tabs.List></Tabs.ListContainer>
              {formats.map(item => <Tabs.Panel key={item.id} id={item.id} className="space-y-4">
                <pre role="region" tabIndex={0} aria-label={item.label} className="min-h-52 select-all whitespace-pre-wrap break-all rounded-xl border border-border bg-surface p-4 font-mono text-xs leading-6">{item.value}</pre>
                <Button variant="primary" className={`w-full ${primaryTone}`} onPress={() => void copy(item.value)}><Copy aria-hidden="true" className="size-4" />复制{item.id === 'url' ? '链接' : ` ${item.label}`}</Button>
              </Tabs.Panel>)}
            </Tabs>
          </Card.Content>
        </Card>
      </div>
      <Card className="gap-3 p-4" variant="secondary">
        <Card.Header><Card.Title className="text-xs font-medium">公开展示标识</Card.Title></Card.Header>
        <Card.Content><code className="block select-all break-all rounded-lg bg-surface px-3 py-2.5 font-mono text-xs text-muted">{record.key}</code></Card.Content>
        <Card.Footer className="flex-wrap justify-end gap-2">
          <Button size="sm" variant="tertiary" isDisabled={busy} onPress={() => void mutate(() => setEmbedKeyEnabled(!record.enabled), record.enabled ? '已停用展示' : '已重新启用')}>{record.enabled ? '停用展示' : '重新启用'}</Button>
          <Button size="sm" variant="danger-soft" isDisabled={busy} onPress={() => setRotateOpen(true)}><RotateCw aria-hidden="true" className="size-3.5" />重新生成标识</Button>
        </Card.Footer>
      </Card>
    </> : null}
    <Modal.Backdrop isOpen={rotateOpen} onOpenChange={open => { if (!busy) setRotateOpen(open); }}>
      <Modal.Container size="sm"><Modal.Dialog aria-label="重新生成展示标识">
        <Modal.Header><Modal.Heading>重新生成标识？</Modal.Heading></Modal.Header>
        <Modal.Body><p className="text-sm text-muted">所有样式的旧链接都会失效。请在生成后重新复制链接，并更新已嵌入的页面。</p></Modal.Body>
        <Modal.Footer><Button variant="tertiary" isDisabled={busy} onPress={() => setRotateOpen(false)}>取消</Button><Button variant="danger" isPending={busy} isDisabled={busy} onPress={() => void mutate(rotateEmbedKey, '已生成新标识，请更新嵌入链接')}>重新生成</Button></Modal.Footer>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>
  </section>;
}
