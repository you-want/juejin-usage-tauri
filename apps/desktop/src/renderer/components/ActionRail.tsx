import {
  Loader2Icon,
  MoonIcon,
  RefreshCwIcon,
  SettingsIcon,
  SunIcon,
  XIcon,
} from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

const glassShell =
  'rounded-[14px] border border-white/50 bg-white/55 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_rgb(0_0_0/0.06)] backdrop-blur-xl dark:border-white/10 dark:bg-black/40';

const fabBtn =
  'flex size-10 items-center justify-center rounded-[10px] text-muted opacity-45 transition-all duration-150 hover:bg-white/60 hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-white/10';

interface ActionRailProps {
  settingsOpen: boolean;
  onToggleSettings: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  refreshLabel: string;
}

/** Vertical glass rail: refresh → theme → settings. */
export function ActionRail({
  settingsOpen,
  onToggleSettings,
  onRefresh,
  refreshing,
  refreshLabel,
}: ActionRailProps) {
  const { theme, toggleTheme } = useTheme();
  const ThemeIcon = theme === 'light' ? MoonIcon : SunIcon;

  return (
    <div className={cn(glassShell, 'flex flex-col gap-0.5 p-1.5')}>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label={refreshLabel}
        title={refreshLabel}
        className={fabBtn}
      >
        {refreshing ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <RefreshCwIcon className="size-4" />
        )}
      </button>

      <button
        type="button"
        onClick={toggleTheme}
        aria-label={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}
        title={theme === 'light' ? '深色' : '浅色'}
        className={fabBtn}
      >
        <ThemeIcon className="size-4" />
      </button>

      <button
        type="button"
        onClick={onToggleSettings}
        aria-label={settingsOpen ? '关闭设置' : '打开设置'}
        title={settingsOpen ? '关闭设置' : '设置'}
        className={cn(fabBtn, settingsOpen && 'bg-white/70 opacity-100 text-foreground dark:bg-white/15')}
      >
        {settingsOpen ? <XIcon className="size-4" /> : <SettingsIcon className="size-4" />}
      </button>
    </div>
  );
}
