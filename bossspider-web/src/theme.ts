import { useEffect, useState } from 'react';

export type ThemeMode = 'system' | 'dark' | 'light';

declare global {
  interface Window {
    bossflowDesktop?: {
      platform: string;
      setTheme: (theme: 'dark' | 'light') => void;
    };
  }
}

export const THEME_STORAGE_KEY = 'bossflow-theme-mode';

function getStoredThemeMode(): ThemeMode {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'dark' || saved === 'light' || saved === 'system' ? saved : 'system';
  } catch {
    return 'system';
  }
}

function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  return mode === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;
}

export function applyTheme(mode: ThemeMode) {
  const resolved = resolveTheme(mode);
  const root = document.documentElement;
  root.dataset.themeMode = mode;
  root.dataset.theme = resolved;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
  window.bossflowDesktop?.setTheme(resolved);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Theme selection should still work when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent('bossflow:theme-change', { detail: { mode, resolved } }));
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => getStoredThemeMode());
  const [resolved, setResolved] = useState<'dark' | 'light'>(() => resolveTheme(getStoredThemeMode()));

  useEffect(() => {
    applyTheme(mode);
    setResolved(resolveTheme(mode));
  }, [mode]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      if (mode !== 'system') return;
      applyTheme('system');
      setResolved(resolveTheme('system'));
    };
    media.addEventListener('change', onSystemChange);
    return () => media.removeEventListener('change', onSystemChange);
  }, [mode]);

  useEffect(() => {
    const sync = (event: Event) => {
      const next = (event as CustomEvent<{ mode?: ThemeMode; resolved?: 'dark' | 'light' }>).detail;
      if (next?.mode) setMode(next.mode);
      if (next?.resolved) setResolved(next.resolved);
    };
    window.addEventListener('bossflow:theme-change', sync);
    return () => window.removeEventListener('bossflow:theme-change', sync);
  }, []);

  return { mode, resolved, setMode };
}
