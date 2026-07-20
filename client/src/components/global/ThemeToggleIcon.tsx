import { AnimatePresence, motion } from 'motion/react';

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  strokeWidth: 1.5,
};

const settle = { duration: 0.72, ease: [0.22, 0.61, 0.36, 1] as const };

/** 主题按钮单独触发的日/月交接动画。 */
export function ThemeToggleIcon({
  theme,
  reducedMotion = false,
}: {
  theme: 'daylight' | 'midnight';
  reducedMotion?: boolean;
}) {
  const isDaylight = theme === 'daylight';

  return (
    <AnimatePresence initial={false} mode="wait">
      {isDaylight ? (
        <motion.svg
          key="sun"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          aria-hidden="true"
          {...stroke}
          initial={reducedMotion ? false : { opacity: 0, rotate: -24, scale: 0.8 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={reducedMotion ? undefined : { opacity: 0, rotate: 24, scale: 0.8 }}
          whileHover={reducedMotion ? undefined : { rotate: 20, transition: settle }}
          transition={settle}
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </motion.svg>
      ) : (
        <motion.svg
          key="moon"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          aria-hidden="true"
          {...stroke}
          initial={reducedMotion ? false : { opacity: 0, x: -3, scale: 0.8 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={reducedMotion ? undefined : { opacity: 0, x: 3, scale: 0.8 }}
          whileHover={reducedMotion ? undefined : { x: -1, transition: settle }}
          transition={settle}
        >
          <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
        </motion.svg>
      )}
    </AnimatePresence>
  );
}
