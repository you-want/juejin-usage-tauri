import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { useTheme as useHeroUITheme } from '@heroui/react';
import type { Theme } from '@/lib/theme';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const {
    theme: heroUITheme,
    setTheme: setHeroUITheme,
  } = useHeroUITheme('light');
  const theme: Theme = heroUITheme === 'dark' ? 'dark' : 'light';

  const setTheme = useCallback((next: Theme) => {
    setHeroUITheme(next);
  }, [setHeroUITheme]);

  const toggleTheme = useCallback(() => {
    setHeroUITheme(theme === 'light' ? 'dark' : 'light');
  }, [setHeroUITheme, theme]);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
