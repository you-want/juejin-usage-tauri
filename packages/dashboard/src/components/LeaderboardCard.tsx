import { useState } from 'react';
import { Medal, Persons } from '@gravity-ui/icons';
import {
  Button,
  Card,
  Chip,
  Skeleton,
  Table,
  Tabs,
} from '@heroui/react';
import { ProviderIcon } from '@/components/ProviderIcon';
import { StatusBanner } from '@/components/StatusBanner';
import type {
  LeaderboardMetric,
  LeaderboardRow,
  ToolLeaderboard,
} from '@/lib/api';
import { formatTokens, formatTokensExact, formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';
import './LeaderboardCard.css';

const TOOL_METRICS = ['cost', 'tokens'] as const;

export function LeaderboardCard({
  configured,
  error,
  loading,
  onConfigure,
  onRetry,
  tools,
}: {
  configured: boolean | null;
  error: string | null;
  loading: boolean;
  onConfigure: () => void;
  onRetry: () => void;
  tools: ToolLeaderboard[];
}) {
  const isUnconfigured = configured === false;
  const visibleTools = tools.filter(
    (tool) => tool.boards.tokens.totalUsers > 0,
  );

  return (
    <section aria-label="工具排行榜">
      <div className="mb-4">
        <h2 className="text-xl">工具排行榜</h2>
        <p className="mt-2 text-sm text-muted">
          按工具查看匿名用户的预估消费与 Token 排名
        </p>
      </div>

      {error ? (
        <Card className="rounded-2xl">
          <Card.Content className="space-y-2">
            <StatusBanner
              description={errorDescription(error)}
              title="排行榜加载失败"
              tone="error"
            />
            <Button onPress={onRetry} variant="secondary">
              重新加载
            </Button>
          </Card.Content>
        </Card>
      ) : loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ToolLeaderboardSkeleton label="Cursor 排行榜加载中" />
          <ToolLeaderboardSkeleton label="Claude Code 排行榜加载中" />
        </div>
      ) : isUnconfigured ? (
        <UnconfiguredState onConfigure={onConfigure} />
      ) : visibleTools.length === 0 ? (
        <EmptyToolState />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {visibleTools.map((tool) => (
            <ToolLeaderboardCard key={tool.tool} tool={tool} />
          ))}
        </div>
      )}
    </section>
  );
}

function ToolLeaderboardCard({ tool }: { tool: ToolLeaderboard }) {
  const [metric, setMetric] = useState<LeaderboardMetric>(
    tool.costSupported ? 'cost' : 'tokens',
  );
  const response = tool.boards[metric];

  return (
    <Card className="min-w-0 overflow-hidden rounded-2xl">
      <Card.Header className="flex-row flex-wrap items-start justify-between gap-3 pb-0">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-black/10 bg-white text-black shadow-xs">
            <ProviderIcon provider={tool.tool} size={22} onLightBackground />
          </span>
          <div className="min-w-0">
            <Card.Title className="truncate">{tool.displayName}</Card.Title>
            <Card.Description className="mt-1">
              当前共 {response.totalUsers.toLocaleString('zh-CN')} 位用户参与
            </Card.Description>
          </div>
        </div>

        <ToolMetricTabs
          metric={metric}
          onChange={setMetric}
          toolName={tool.displayName}
          costSupported={tool.costSupported}
        />
      </Card.Header>

      <Card.Content className="min-w-0 pt-3">
        <LeaderboardTable
          metric={metric}
          rows={response.rows}
          toolKey={tool.tool}
          toolName={tool.displayName}
        />
      </Card.Content>
    </Card>
  );
}

function ToolMetricTabs({
  costSupported,
  metric,
  onChange,
  toolName,
}: {
  costSupported: boolean;
  metric: LeaderboardMetric;
  onChange: (metric: LeaderboardMetric) => void;
  toolName: string;
}) {
  const labels: Record<LeaderboardMetric, string> = {
    cost: '预估消费',
    tokens: 'Token',
  };

  return (
    <Tabs
      className="w-fit shrink-0 text-center"
      selectedKey={metric}
      onSelectionChange={(key) => onChange(key as LeaderboardMetric)}
    >
      <Tabs.ListContainer>
        <Tabs.List
          aria-label={`${toolName}排行指标`}
          className="w-fit *:h-6 *:w-fit *:px-3 *:text-sm *:font-normal *:data-[selected=true]:text-accent-foreground"
        >
          {TOOL_METRICS.filter(
            (key) => key !== 'cost' || costSupported,
          ).map((key) => (
            <Tabs.Tab id={key} key={key}>
              <span className="text-xs font-normal">{labels[key]}</span>
              <Tabs.Indicator className="bg-accent" />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
    </Tabs>
  );
}

function LeaderboardTable({
  metric,
  rows,
  toolKey,
  toolName,
}: {
  metric: LeaderboardMetric;
  rows: LeaderboardRow[];
  toolKey: string;
  toolName: string;
}) {
  return (
    <Table variant="secondary" className="rounded-xl">
      <Table.ScrollContainer>
        <Table.Content
          aria-label={`${toolName}${metric === 'cost' ? '预估消费' : 'Token'}排行榜`}
          className="w-full"
        >
          <Table.Header>
            <Table.Column className="w-16 min-w-16 max-w-16 text-center">#</Table.Column>
            <Table.Column className="min-w-0" isRowHeader>用户</Table.Column>
            <Table.Column className="w-28 min-w-28 max-w-28 text-right">
              {metric === 'cost' ? '预估费用' : 'Token'}
            </Table.Column>
          </Table.Header>
          <Table.Body
            renderEmptyState={() => (
              <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center">
                <Persons className="size-6 text-muted" />
                <p className="text-sm font-medium">当前范围暂无排行数据</p>
                <p className="text-xs text-muted">产生用量后再回来看看</p>
              </div>
            )}
          >
            {rows.map((row) => (
              <Table.Row
                className="leaderboard-table-row"
                id={`${toolKey}-${metric}-${row.userHash}`}
                key={`${toolKey}-${metric}-${row.userHash}`}
              >
                <Table.Cell className="text-center">
                  <RankCell rank={row.rank} />
                </Table.Cell>
                <Table.Cell className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{row.displayName}</span>
                    {row.isCurrentUser && (
                      <Chip color="success" size="sm" variant="soft">
                        <Chip.Label>我</Chip.Label>
                      </Chip>
                    )}
                  </span>
                </Table.Cell>
                {metric === 'cost' ? <CostCell row={row} /> : <TokenCell row={row} />}
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

function TokenCell({ row }: { row: LeaderboardRow }) {
  return (
    <Table.Cell className="text-right text-success tabular-nums">
      <span
        aria-label={`${formatTokensExact(row.tokens)} Token`}
        title={`${formatTokensExact(row.tokens)} Token`}
      >
        {formatTokens(row.tokens)}
      </span>
    </Table.Cell>
  );
}

function CostCell({ row }: { row: LeaderboardRow }) {
  return (
    <Table.Cell className="text-right text-success tabular-nums">
      {formatUsd(row.costUsd)}
    </Table.Cell>
  );
}

function RankCell({ rank }: { rank: number }) {
  if (rank <= 3) {
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums">
        <Medal
          className={cn(
            'size-4',
            rank === 1 && 'text-amber-500',
            rank === 2 && 'text-slate-400',
            rank === 3 && 'text-orange-500',
          )}
        />
        #{rank}
      </span>
    );
  }
  return <span className="tabular-nums text-muted">#{rank}</span>;
}

function ToolLeaderboardSkeleton({ label }: { label: string }) {
  return (
    <Card aria-label={label} className="rounded-2xl">
      <Card.Header className="flex-row items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-28 rounded-md" />
          <Skeleton className="h-4 w-44 rounded-md" />
        </div>
        <Skeleton className="h-8 w-44 rounded-xl" />
      </Card.Header>
      <Card.Content className="space-y-3 pt-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            className="grid grid-cols-[3rem_1fr_5rem_5rem] items-center gap-4"
            key={index}
          >
            <Skeleton className="h-5 w-8 rounded-md" />
            <Skeleton className="h-5 w-32 rounded-md" />
            <Skeleton className="h-5 w-16 justify-self-end rounded-md" />
            <Skeleton className="h-5 w-16 justify-self-end rounded-md" />
          </div>
        ))}
      </Card.Content>
    </Card>
  );
}

function EmptyToolState() {
  return (
    <Card className="rounded-2xl">
      <Card.Content className="flex min-h-56 flex-col items-center justify-center gap-2 text-center">
        <Persons className="size-6 text-muted" />
        <p className="font-medium">当前范围暂无工具排行</p>
        <p className="text-sm text-muted">产生工具用量后再回来看看</p>
      </Card.Content>
    </Card>
  );
}

function UnconfiguredState({ onConfigure }: { onConfigure: () => void }) {
  return (
    <Card className="rounded-2xl">
      <Card.Content className="flex min-h-56 flex-col items-center justify-center gap-3 px-4 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent-soft-foreground">
          <Persons className="size-6" />
        </span>
        <div>
          <p className="font-medium">配置云端同步后查看工具排行榜</p>
          <p className="mt-1 max-w-md text-sm leading-6 text-muted">
            排行榜仅展示匿名用户的 Token 用量和预估消费。
          </p>
        </div>
        <Button onPress={onConfigure} variant="secondary">
          前往用量页设置
        </Button>
      </Card.Content>
    </Card>
  );
}

function errorDescription(error: string): string {
  const descriptions: Record<string, string> = {
    LEADERBOARD_UNAUTHENTICATED: '云端鉴权已失效，请更新设置中的 Token。',
    LEADERBOARD_RATE_LIMITED: '请求过于频繁，请稍后再试。',
    LEADERBOARD_UNAVAILABLE: '暂时无法连接排行榜服务，请检查网络后重试。',
    LEADERBOARD_UPSTREAM_ERROR: '排行榜服务暂时不可用，请稍后重试。',
  };
  return descriptions[error] ?? error;
}
