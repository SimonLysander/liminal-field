import { useCallback, useState } from 'react';

type Theme = 'daylight' | 'midnight';

/**
 * Theme switching with smooth global transition.
 *
 * Problem: CSS custom properties aren't animatable by default, so child elements
 * that read `var(--ink)` etc. would snap instantly on theme change.
 *
 * Solution: temporarily inject a `theme-transitioning` class on `<body>` that
 * applies `transition` to ALL elements via `* { ... }`. The class is removed
 * after 600ms so there's zero ongoing performance cost — the transition overhead
 * only exists during the ~0.5s switch window.
 */
const TRANSITION_DURATION = 1000;

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document === 'undefined') return 'daylight';
    try {
      const stored = localStorage.getItem('liminal-theme');
      if (stored === 'daylight' || stored === 'midnight') {
        document.body.setAttribute('data-theme', stored);
        return stored;
      }
    } catch {
      /* ignore */
    }

    return (document.body.getAttribute('data-theme') as Theme) || 'daylight';
  });

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);

    document.body.classList.add('theme-transitioning');
    document.body.setAttribute('data-theme', next);

    setTimeout(() => {
      document.body.classList.remove('theme-transitioning');
    }, TRANSITION_DURATION);

    try {
      localStorage.setItem('liminal-theme', next);
    } catch {
      /* ignore */
    }
  }, []);

  return { theme, setTheme };
}
