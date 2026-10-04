export type AppTheme = 'default' | 'black';

const THEME_STORAGE_KEY = 'kh_theme';

export function getAppTheme(userId?: string | null): AppTheme {
  if (typeof window === 'undefined') return 'default';
  try {
    if (userId) {
      const userSaved = localStorage.getItem(`kh_theme_${userId}`);
      if (userSaved === 'black' || userSaved === 'default') {
        return userSaved as AppTheme;
      }
    }
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'black' || saved === 'default') {
      return saved as AppTheme;
    }
  } catch (e) {
    console.warn('Error reading theme from localStorage:', e);
  }
  return 'default';
}

export function setAppTheme(theme: AppTheme, userId?: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    if (userId) {
      localStorage.setItem(`kh_theme_${userId}`, theme);
    }
  } catch (e) {
    console.warn('Error writing theme to localStorage:', e);
  }
  
  if (document.documentElement) {
    document.documentElement.setAttribute('data-theme', theme);
  }
  
  // Dispatch a custom event so reactive components update instantly
  window.dispatchEvent(new CustomEvent('kh-theme-changed', { detail: { theme, userId } }));
}

// React hook for components needing reactive theme state
import { useState, useEffect } from 'react';

export function useAppTheme(): [AppTheme, (newTheme: AppTheme, userId?: string | null) => void] {
  const [theme, setThemeState] = useState<AppTheme>(() => getAppTheme());

  useEffect(() => {
    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ theme: AppTheme }>;
      if (customEvent.detail && customEvent.detail.theme) {
        setThemeState(customEvent.detail.theme);
      } else {
        setThemeState(getAppTheme());
      }
    };

    window.addEventListener('kh-theme-changed', handleThemeChange);
    window.addEventListener('storage', handleThemeChange);

    // Ensure DOM is in sync on mount
    const current = getAppTheme();
    if (document.documentElement.getAttribute('data-theme') !== current) {
      document.documentElement.setAttribute('data-theme', current);
    }

    return () => {
      window.removeEventListener('kh-theme-changed', handleThemeChange);
      window.removeEventListener('storage', handleThemeChange);
    };
  }, []);

  const changeTheme = (newTheme: AppTheme, userId?: string | null) => {
    setThemeState(newTheme);
    setAppTheme(newTheme, userId);
  };

  return [theme, changeTheme];
}
