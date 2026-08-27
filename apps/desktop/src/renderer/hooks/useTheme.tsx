import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { useTheme as useHeroUITheme } from '@heroui/react';
import type { Theme } from '@/lib/theme';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function shouldAnimateThemeChange(): boolean {
  return typeof document !== 'undefined'
    && typeof document.startViewTransition === 'function'
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const {
    theme: heroUITheme,
    setTheme: setHeroUITheme,
  } = useHeroUITheme('light');
  const theme: Theme = heroUITheme === 'dark' ? 'dark' : 'light';
  const themeRef = useRef<Theme>(theme);

  const applyTheme = useCallback((next: Theme): boolean => {
    if (next === themeRef.current) return false;
    themeRef.current = next;

    if (!shouldAnimateThemeChange()) {
      setHeroUITheme(next);
      return true;
    }

    document.startViewTransition(() => {
      flushSync(() => {
        setHeroUITheme(next);
      });
    });
    return true;
  }, [setHeroUITheme]);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    let disposed = false;
    const syncInitialTheme = async () => {
      const next = await window.tud?.getTheme?.();
      if (!disposed && (next === 'light' || next === 'dark')) {
        applyTheme(next);
      }
    };

    void syncInitialTheme();
    const unsubscribe = window.tud?.onThemeChanged?.((next) => applyTheme(next));
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [applyTheme]);

  const setTheme = useCallback((next: Theme) => {
    if (!applyTheme(next)) return;
    window.tud?.setTheme?.(next);
  }, [applyTheme]);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  }, [setTheme, theme]);

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
