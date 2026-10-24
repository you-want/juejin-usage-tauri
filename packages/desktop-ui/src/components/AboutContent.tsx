import { useEffect, useState } from 'react';
import { Link } from '@heroui/react';
import { JUEJIN_PRIVACY_POLICY_URL } from './JuejinLoginConsentModal';
import { ProviderIcon } from './ProviderIcon';
import {
  APP_DISPLAY_NAME,
  SUPPORTED_TOOLS,
  formatSupportedTool,
} from '../lib/about';
import { tud } from '../lib/tud-bridge';

/** Community (Tauri) edition reports issues on its own fork. */
const FEEDBACK_URL = 'https://github.com/K-H-N-L/juejin-usage/issues/new';

/** Desktop about body — shell version + supported tools. */
export function AboutContent() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void tud()
      ?.version()
      .then((value) => {
        if (!cancelled) setVersion(value);
      })
      .catch(() => {
        if (!cancelled) setVersion(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-5">
      <section className="space-y-1.5">
        <h3 className="text-sm text-medium text-foreground">版本信息</h3>
        <p className="text-sm text-foreground/70">
          {APP_DISPLAY_NAME}（Tauri 社区版）{' '}
          <span className="font-mono text-foreground/90">
            v{version ?? '—'}
          </span>
        </p>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-sm text-medium text-foreground">隐私与协议</h3>
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
        <h3 className="text-sm text-medium text-foreground">问题反馈</h3>
        <Link
          className="w-fit text-sm text-accent"
          href={FEEDBACK_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          提交问题反馈（Tauri 社区版仓库）
          <Link.Icon />
        </Link>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm text-medium text-foreground">支持的工具</h3>
        <p className="text-xs text-foreground/55">
          同一系列的多端形态用括号标出。
        </p>
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {SUPPORTED_TOOLS.map((tool) => (
            <li
              key={tool.source}
              className="flex items-center gap-2 rounded-lg bg-black/3 px-2.5 py-1.5 text-sm text-foreground/80 dark:bg-white/5"
            >
              <ProviderIcon provider={tool.source} size={16} />
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
