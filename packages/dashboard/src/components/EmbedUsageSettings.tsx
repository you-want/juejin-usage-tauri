import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Card, Checkbox, Input, Label, ListBox, Modal, Select, Surface, Tabs, TextField, Toast, ToastQueue,
} from '@heroui/react';
import {
  createEmbedCard,
  deleteEmbedCard,
  fetchEmbedCards,
  getApiBearer,
  getEmbedApiBase,
  updateEmbedCard,
  type EmbedCardView,
} from '@/lib/api';
import {
  buildEmbedSnippets,
  defaultShowFieldsForTemplate,
  EMBED_STYLE_OPTIONS,
  fieldLabel,
  type EmbedStyle,
} from '@/lib/embed-usage';
import { EmbedCardPreview } from '@/components/EmbedUsageCarousel';
import { Copy, Plus, RotateCw, Trash2 } from 'lucide-react';
import { JUEJIN_HOME } from '@/lib/juejin-client-link';
import { JUEJIN_LINK_CHANGED_EVENT } from '@/lib/shell-events';

const message = (error: unknown) => (error instanceof Error ? error.message : '请求失败，请稍后重试');
const MAX_CARDS = 10;

export function EmbedUsageSettings() {
  const [identity, setIdentity] = useState(getApiBearer);
  const [cards, setCards] = useState<EmbedCardView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState('markdown-page');
  const [rotateOpen, setRotateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTemplate, setCreateTemplate] = useState<EmbedStyle>('classic-light');
  const [createLabel, setCreateLabel] = useState('');
  const [revision, setRevision] = useState(0);
  const [queue] = useState(() => new ToastQueue({ maxVisibleToasts: 1 }));
  const requestVersion = useRef(0);
  const writing = useRef(false);

  const selected = useMemo(
    () => cards.find(c => c.shareId === selectedId) ?? cards[0] ?? null,
    [cards, selectedId],
  );

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    const user = getApiBearer();
    setIdentity(user);
    setError(null);
    setRotateOpen(false);
    setDeleteOpen(false);
    setLoading(Boolean(user));
    setBusy(false);
    writing.current = false;
    if (!user) {
      setCards([]);
      setSelectedId(null);
      return;
    }
    try {
      const result = await fetchEmbedCards();
      if (version !== requestVersion.current || user !== getApiBearer()) return;
      setCards(result);
      setSelectedId(prev => {
        if (prev && result.some(c => c.shareId === prev)) return prev;
        return result[0]?.shareId ?? null;
      });
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
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'tud.apiBearer' || event.key === null) changed();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      requestVersion.current++;
      window.removeEventListener('tud:api-identity-changed', changed);
      window.removeEventListener(JUEJIN_LINK_CHANGED_EVENT, changed);
      window.removeEventListener('storage', onStorage);
    };
  }, [refresh]);

  const mutate = async <T,>(action: () => Promise<T>, title: string, after?: (result: T) => void) => {
    if (writing.current) return;
    writing.current = true;
    const version = ++requestVersion.current;
    const user = getApiBearer();
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (version !== requestVersion.current || user !== getApiBearer()) return;
      after?.(result);
      setRevision(v => v + 1);
      setRotateOpen(false);
      setDeleteOpen(false);
      setCreateOpen(false);
      queue.add({ title, variant: 'success' });
      await refresh();
    } catch (cause) {
      if (version === requestVersion.current && user === getApiBearer()) setError(message(cause));
    } finally {
      if (version === requestVersion.current) {
        setBusy(false);
        writing.current = false;
      }
    }
  };

  const templateMeta = selected
    ? EMBED_STYLE_OPTIONS.find(c => c.id === selected.templateId)
    : null;

  const snippets = selected
    ? buildEmbedSnippets(
      getEmbedApiBase(),
      selected.shareId,
      selected.templateId,
      templateMeta ? { width: templateMeta.width, height: templateMeta.height } : undefined,
    )
    : null;

  const previewUrl = snippets
    ? `${snippets.url}?r=${revision}`
    : null;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      queue.add({ title: '已复制', variant: 'success' });
    } catch {
      queue.add({ title: '复制失败', description: '请选中下方文本手动复制。', variant: 'danger' });
    }
  };

  const toggleField = (key: string, checked: boolean) => {
    if (!selected) return;
    const meta = EMBED_STYLE_OPTIONS.find(c => c.id === selected.templateId);
    const field = meta?.fields.find(f => f.key === key);
    if (!field || field.required) return;
    const next = checked
      ? [...new Set([...selected.showFields, key])]
      : selected.showFields.filter(f => f !== key);
    void mutate(
      () => updateEmbedCard(selected.shareId, { showFields: next }),
      '已更新展示字段',
    );
  };

  const changeTemplate = (templateId: string) => {
    if (!selected || templateId === selected.templateId) return;
    const showFields = defaultShowFieldsForTemplate(templateId);
    void mutate(
      () => updateEmbedCard(selected.shareId, { templateId, showFields }),
      '已切换模板',
    );
  };

  return (
    <section className="space-y-5 font-sans text-sm text-foreground">
      <Toast.Provider placement="top end" queue={queue} />
      {error && (
        <div role="alert" className="rounded-xl bg-danger/10 p-3 text-xs text-danger">
          {error}
          <Button size="sm" variant="ghost" className="ml-2" onPress={() => void refresh()}>重试</Button>
        </div>
      )}
      {!identity ? (
        <Surface className="space-y-3 rounded-xl p-5">
          <p>登录掘金后即可生成用量卡片。</p>
          <Button variant="primary" size="sm" onPress={() => window.location.assign(JUEJIN_HOME)}>登录掘金</Button>
        </Surface>
      ) : loading ? (
        <p role="status" className="py-10 text-center text-muted">正在读取卡片…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">
              最多 {MAX_CARDS} 张 · 已创建 {cards.length} 张 · 字段与模板保存在服务端，图片链接只含 shareId
            </p>
            <Button
              size="sm"
              variant="primary"
              isDisabled={busy || cards.length >= MAX_CARDS}
              onPress={() => {
                setCreateTemplate('classic-light');
                setCreateLabel('');
                setCreateOpen(true);
              }}
            >
              <Plus aria-hidden className="size-4" />新建卡片
            </Button>
          </div>

          {cards.length === 0 ? (
            <Card>
              <Card.Header><Card.Title>还没有用量卡片</Card.Title></Card.Header>
              <Card.Content>
                <p className="text-sm leading-relaxed text-muted">
                  新建后可选择模板、勾选字段，并把 Markdown 贴到 README / 博客。默认外链只打开用量页，不会自动弹窗。
                </p>
              </Card.Content>
              <Card.Footer>
                <Button variant="primary" isDisabled={busy} onPress={() => setCreateOpen(true)}>创建第一张</Button>
              </Card.Footer>
            </Card>
          ) : (
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="min-w-0 space-y-3">
                <Card variant="secondary">
                  <Card.Header><Card.Title>我的卡片</Card.Title></Card.Header>
                  <Card.Content className="space-y-2">
                    {cards.map(card => {
                      const meta = EMBED_STYLE_OPTIONS.find(c => c.id === card.templateId);
                      const active = card.shareId === selected?.shareId;
                      return (
                        <button
                          key={card.shareId}
                          type="button"
                          onClick={() => setSelectedId(card.shareId)}
                          className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                            active ? 'border-accent bg-accent/5' : 'border-border bg-surface hover:bg-muted/30'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{card.label || meta?.label || card.templateId}</span>
                            <span className={`text-[10px] ${card.enabled ? 'text-success' : 'text-muted'}`}>
                              {card.enabled ? '展示中' : '已停用'}
                            </span>
                          </div>
                          <code className="mt-1 block truncate font-mono text-[10px] text-muted">{card.shareId}</code>
                        </button>
                      );
                    })}
                  </Card.Content>
                </Card>

                {selected && templateMeta && (
                  <Card variant="secondary">
                    <Card.Header><Card.Title>模板与字段</Card.Title></Card.Header>
                    <Card.Content className="space-y-4">
                      <Select
                        aria-label="卡片模板"
                        fullWidth
                        variant="secondary"
                        value={selected.templateId}
                        onChange={value => changeTemplate(String(value))}
                      >
                        <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {EMBED_STYLE_OPTIONS.map(option => (
                              <ListBox.Item id={option.id} key={option.id} textValue={option.label}>
                                {option.label}<ListBox.ItemIndicator />
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                      <TextField fullWidth name="embed-card-label">
                        <Label>备注名（仅自己可见）</Label>
                        <Input
                          fullWidth
                          value={selected.label ?? ''}
                          onChange={e => {
                            const value = e.target.value;
                            setCards(prev => prev.map(c => (
                              c.shareId === selected.shareId ? { ...c, label: value || null } : c
                            )));
                          }}
                          onBlur={() => {
                            void mutate(
                              () => updateEmbedCard(selected.shareId, { label: selected.label }),
                              '已更新备注',
                            );
                          }}
                        />
                      </TextField>
                      <fieldset className="space-y-2">
                        <legend className="text-xs text-muted">展示字段</legend>
                        <div className="grid grid-cols-2 gap-2">
                          {templateMeta.fields.map(field => {
                            const checked = selected.showFields.includes(field.key);
                            return (
                              <Checkbox
                                key={field.key}
                                isSelected={checked}
                                isDisabled={busy || field.required}
                                onChange={value => toggleField(field.key, value)}
                              >
                                <Checkbox.Content>
                                  <Checkbox.Control>
                                    <Checkbox.Indicator />
                                  </Checkbox.Control>
                                  {fieldLabel(field.key)}
                                  {field.required ? '（必选）' : ''}
                                </Checkbox.Content>
                              </Checkbox>
                            );
                          })}
                        </div>
                      </fieldset>
                    </Card.Content>
                    <Card.Footer className="flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        variant="tertiary"
                        isDisabled={busy}
                        onPress={() => void mutate(
                          () => updateEmbedCard(selected.shareId, { enabled: !selected.enabled }),
                          selected.enabled ? '已停用展示' : '已重新启用',
                        )}
                      >
                        {selected.enabled ? '停用展示' : '重新启用'}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger-soft"
                        isDisabled={busy}
                        onPress={() => setRotateOpen(true)}
                      >
                        <RotateCw aria-hidden className="size-3.5" />重新生成 shareId
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        isDisabled={busy}
                        onPress={() => setDeleteOpen(true)}
                      >
                        <Trash2 aria-hidden className="size-3.5" />删除
                      </Button>
                    </Card.Footer>
                  </Card>
                )}
              </div>

              <div className="min-w-0 space-y-4">
                {selected && previewUrl && (
                  <EmbedCardPreview
                    key={`${selected.shareId}:${revision}:${selected.enabled}:${selected.showFields.join(',')}`}
                    url={previewUrl}
                    enabled={selected.enabled}
                  />
                )}
                {snippets && (
                  <Card variant="secondary">
                    <Card.Content>
                      <Tabs
                        selectedKey={format}
                        onSelectionChange={key => setFormat(String(key))}
                        className="min-w-0 gap-3"
                      >
                        <Tabs.ListContainer>
                          <Tabs.List aria-label="嵌入格式">
                            {snippets.formats.map(item => (
                              <Tabs.Tab id={item.id} key={item.id} className="px-3 text-xs">
                                {item.label}
                                <Tabs.Indicator />
                              </Tabs.Tab>
                            ))}
                          </Tabs.List>
                        </Tabs.ListContainer>
                        {snippets.formats.map(item => (
                          <Tabs.Panel key={item.id} id={item.id} className="space-y-4">
                            <pre
                              role="region"
                              tabIndex={0}
                              aria-label={item.label}
                              className="min-h-40 select-all whitespace-pre-wrap break-all rounded-xl border border-border bg-surface p-4 font-mono text-xs leading-6"
                            >
                              {item.value}
                            </pre>
                            <Button variant="primary" className="w-full" onPress={() => void copy(item.value)}>
                              <Copy aria-hidden className="size-4" />复制
                            </Button>
                          </Tabs.Panel>
                        ))}
                      </Tabs>
                    </Card.Content>
                  </Card>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <Modal.Backdrop isOpen={createOpen} onOpenChange={open => { if (!busy) setCreateOpen(open); }}>
        <Modal.Container size="sm">
          <Modal.Dialog aria-label="新建用量卡片">
            <Modal.Header><Modal.Heading>新建用量卡片</Modal.Heading></Modal.Header>
            <Modal.Body className="space-y-4">
              <Select
                aria-label="选择模板"
                fullWidth
                variant="secondary"
                value={createTemplate}
                onChange={value => setCreateTemplate(String(value) as EmbedStyle)}
              >
                <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {EMBED_STYLE_OPTIONS.map(option => (
                      <ListBox.Item id={option.id} key={option.id} textValue={option.label}>
                        {option.label}<ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              <TextField fullWidth name="embed-create-label">
                <Label>备注名（可选）</Label>
                <Input fullWidth value={createLabel} onChange={e => setCreateLabel(e.target.value)} />
              </TextField>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={() => setCreateOpen(false)}>取消</Button>
              <Button
                variant="primary"
                isPending={busy}
                isDisabled={busy}
                onPress={() => void mutate(
                  () => createEmbedCard({
                    templateId: createTemplate,
                    label: createLabel.trim() || null,
                    showFields: defaultShowFieldsForTemplate(createTemplate),
                  }),
                  '已创建卡片',
                  (card) => setSelectedId(card.shareId),
                )}
              >
                创建
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <Modal.Backdrop isOpen={rotateOpen} onOpenChange={open => { if (!busy) setRotateOpen(open); }}>
        <Modal.Container size="sm">
          <Modal.Dialog aria-label="重新生成 shareId">
            <Modal.Header><Modal.Heading>重新生成 shareId？</Modal.Heading></Modal.Header>
            <Modal.Body>
              <p className="text-sm text-muted">旧链接会立即失效。生成后请重新复制并更新已嵌入的页面。</p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={() => setRotateOpen(false)}>取消</Button>
              <Button
                variant="danger"
                isPending={busy}
                isDisabled={busy || !selected}
                onPress={() => selected && void mutate(
                  () => updateEmbedCard(selected.shareId, { regenerate: true }),
                  '已生成新 shareId',
                  (card) => setSelectedId(card.shareId),
                )}
              >
                重新生成
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <Modal.Backdrop isOpen={deleteOpen} onOpenChange={open => { if (!busy) setDeleteOpen(open); }}>
        <Modal.Container size="sm">
          <Modal.Dialog aria-label="删除用量卡片">
            <Modal.Header><Modal.Heading>删除这张卡片？</Modal.Heading></Modal.Header>
            <Modal.Body>
              <p className="text-sm text-muted">删除后公开链接失效，且不可恢复。</p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={() => setDeleteOpen(false)}>取消</Button>
              <Button
                variant="danger"
                isPending={busy}
                isDisabled={busy || !selected}
                onPress={() => selected && void mutate(
                  () => deleteEmbedCard(selected.shareId),
                  '已删除卡片',
                )}
              >
                删除
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </section>
  );
}
