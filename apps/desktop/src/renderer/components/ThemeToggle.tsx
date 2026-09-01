import { Display, Moon, Sun } from '@gravity-ui/icons';
import { Tabs } from '@heroui/react';
import { THEME_MODES, type ThemeMode } from '@/lib/theme';
import { useTheme } from '@/hooks/useTheme';

/** Compact theme-mode tabs sized to align with the filter tabs. */
export function ThemeToggle() {
  const { themeMode, setThemeMode } = useTheme();

  const changeTheme = (key: string) => {
    const nextMode = key as ThemeMode;
    if (THEME_MODES.includes(nextMode)) {
      setThemeMode(nextMode);
    }
  };

  return (
    <Tabs
      className="w-fit shrink-0 text-center"
      selectedKey={themeMode}
      onSelectionChange={(key) => changeTheme(String(key))}
    >
      <Tabs.ListContainer>
        <Tabs.List
          aria-label="页面主题"
          className="w-fit"
        >
          <Tabs.Tab
            aria-label="跟随系统"
            className="h-6 w-6 px-0 text-xs aria-selected:text-accent-foreground"
            id="system"
          >
            <Display className="size-3.5" />
            <Tabs.Indicator className="bg-accent" />
          </Tabs.Tab>
          <Tabs.Tab
            aria-label="使用亮色模式"
            className="h-6 w-6 px-0 text-xs aria-selected:text-accent-foreground"
            id="light"
          >
            <Sun className="size-3.5" />
            <Tabs.Indicator className="bg-accent" />
          </Tabs.Tab>
          <Tabs.Tab
            aria-label="使用暗色模式"
            className="h-6 w-6 px-0 text-xs aria-selected:text-accent-foreground"
            id="dark"
          >
            <Moon className="size-3.5" />
            <Tabs.Indicator className="bg-accent" />
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>
    </Tabs>
  );
}
