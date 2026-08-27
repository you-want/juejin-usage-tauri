import openAIIcon from '@lobehub/icons-static-svg/icons/openai.svg';
import { Link } from '@heroui/react';
import { JUEJIN_PRIVACY_POLICY_URL } from '@/components/JuejinLoginConsentModal';
import { ProviderIcon } from '@/components/ProviderIcon';
import {
  APP_DISPLAY_NAME,
  SUPPORTED_TOOLS,
  appVersion,
  formatSupportedTool,
} from '@/lib/about';

const FEEDBACK_URL = 'http://github.com/juejin-cn/juejin-usage/issues/new';

const COLOR_BADGE_CLASSES: Record<string, string> = {
  cline: 'bg-red-500',
  cursor: 'bg-black',
  droid: 'bg-blue-500',
  'every-code': 'bg-emerald-600',
  goose: 'bg-amber-500',
  grok: 'bg-violet-600',
  hermes: 'bg-amber-500',
  kimi: 'bg-black',
  'kilo-cli': 'bg-violet-500',
  kilocode: 'bg-violet-500',
  mimo: 'bg-rose-400',
  omp: 'bg-violet-500',
  opencode: 'bg-blue-600',
  pi: 'bg-orange-500',
  roocode: 'bg-green-500',
  zcode: 'bg-indigo-500',
  zed: 'bg-orange-500',
};

/** Shared about body — version + supported tools. */
export function AboutContent() {
  const version = appVersion();

  return (
    <div className="space-y-5">
      <section className="space-y-1.5">
        <h3 className="text-sm font-medium text-foreground">版本信息</h3>
        <p className="text-sm text-foreground/70">
          {APP_DISPLAY_NAME}{' '}
          <span className="font-mono text-foreground/90">v{version}</span>
        </p>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-sm font-medium text-foreground">隐私与协议</h3>
        <Link
          className="w-fit text-sm text-accent"
          href={JUEJIN_PRIVACY_POLICY_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          查看用户隐私协议
          <Link.Icon />
        </Link>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-sm font-medium text-foreground">问题反馈</h3>
        <Link
          className="w-fit text-sm text-accent"
          href={FEEDBACK_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          提交问题反馈
          <Link.Icon />
        </Link>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">支持的工具</h3>
        <p className="text-xs text-foreground/55">
          同一系列的多端形态用括号标出。
        </p>
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {SUPPORTED_TOOLS.map((tool) => (
            <li
              key={tool.source}
              className="flex items-center gap-2 rounded-lg bg-black/3 px-2.5 py-1.5 text-sm text-foreground/80 dark:bg-white/5"
            >
              <SupportedToolIcon source={tool.source} />
              <span className="min-w-0 leading-snug">
                {formatSupportedTool(tool)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function SupportedToolIcon({ source }: { source: string }) {
  if (source === 'codex') {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-emerald-600">
        <img
          alt=""
          aria-hidden
          className="size-[15px] invert"
          src={openAIIcon}
        />
      </span>
    );
  }

  const badgeClass = COLOR_BADGE_CLASSES[source];

  if (badgeClass) {
    return (
      <span
        className={`flex size-6 shrink-0 items-center justify-center rounded-md ${badgeClass}`}
      >
        <ProviderIcon
          color="#fff"
          isSelected
          provider={source}
          size={15}
        />
      </span>
    );
  }

  return <ProviderIcon provider={source} size={18} />;
}
