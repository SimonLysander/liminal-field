/*
 * Animation definitions adapted from selected @animateicons/react icons
 * (Copyright 2025 Avijit Dey), licensed under MIT.
 * See client/THIRD_PARTY_NOTICES.md for the complete license notice.
 *
 * Selected source icons share the project's Motion runtime and controller
 * for parent-row hover and reduced-motion support, without another runtime.
 */
import type { Variants } from 'motion/react';
import { LazyMotion, domMin, m, useAnimation, useReducedMotion } from 'motion/react';
import { useEffect } from 'react';

type AnimatedIconSlot =
  | 'home'
  | 'notes'
  | 'anthology'
  | 'gallery'
  | 'digest'
  | 'connect'
  | 'search'
  | 'theme';

type AnimateIconsNavIconProps = {
  space: AnimatedIconSlot;
  size?: number;
  duration?: number;
  isHovered?: boolean;
};

export function AnimateIconsNavIcon({
  space,
  size = 16,
  duration = 1.2,
  isHovered,
}: AnimateIconsNavIconProps) {
  const controls = useAnimation();
  const reducedMotion = useReducedMotion();
  const isExternallyControlled = isHovered !== undefined;

  useEffect(() => {
    if (reducedMotion) {
      // A zero-duration transition also cancels animations on descendant paths.
      void controls.start('normal', { duration: 0 });
      return;
    }
    if (!isExternallyControlled) return;

    void controls.start(isHovered ? 'animate' : 'normal');
  }, [controls, isExternallyControlled, isHovered, reducedMotion]);

  const play = () => {
    if (!reducedMotion) void controls.start('animate');
  };

  const reset = () => {
    void controls.start('normal', reducedMotion ? { duration: 0 } : undefined);
  };

  return (
    <LazyMotion features={domMin} strict>
      <m.span
        className="inline-flex items-center justify-center"
        onMouseEnter={isExternallyControlled ? undefined : play}
        onMouseLeave={isExternallyControlled ? undefined : reset}
      >
        {space === 'home' && <HomeIcon controls={controls} duration={duration} size={size} />}
        {space === 'notes' && (
          <NotebookPenIcon controls={controls} duration={duration} size={size} />
        )}
        {space === 'anthology' && (
          <BookOpenTextIcon controls={controls} duration={duration} size={size} />
        )}
        {space === 'gallery' && <ImageIcon controls={controls} duration={duration} size={size} />}
        {space === 'digest' && <MailsIcon controls={controls} duration={duration} size={size} />}
        {space === 'connect' && (
          <FileCodeIcon controls={controls} duration={duration} size={size} />
        )}
        {space === 'search' && <SearchIcon controls={controls} duration={duration} size={size} />}
        {space === 'theme' && <SunMoonIcon controls={controls} duration={duration} size={size} />}
      </m.span>
    </LazyMotion>
  );
}

function FileCodeIcon({
  controls,
  duration,
  size,
}: {
  controls: ReturnType<typeof useAnimation>;
  duration: number;
  size: number;
}) {
  const outlineVariants: Variants = {
    normal: { pathLength: 1, opacity: 1 },
    animate: {
      pathLength: [0, 1],
      opacity: [0, 1],
      transition: { duration: 0.5 * duration, ease: [0.16, 1, 0.3, 1] },
    },
  };
  const bracketVariants: Variants = {
    normal: { x: 0, opacity: 1 },
    animate: (direction: number) => ({
      x: [direction * 6, 0],
      opacity: [0, 1],
      transition: {
        duration: 0.4 * duration,
        delay: 0.22 * duration,
        ease: [0.16, 1, 0.3, 1],
      },
    }),
  };

  return (
    <m.svg
      aria-hidden="true"
      data-icon-name="file-code"
      animate={controls}
      fill="none"
      height={size}
      initial="normal"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      <m.path
        d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"
        variants={outlineVariants}
      />
      <m.path d="M14 2v5a1 1 0 0 0 1 1h5" variants={outlineVariants} />
      <m.path d="M10 12.5 8 15l2 2.5" custom={-1} variants={bracketVariants} />
      <m.path d="m14 12.5 2 2.5-2 2.5" custom={1} variants={bracketVariants} />
    </m.svg>
  );
}

function HomeIcon({
  controls,
  duration,
  size,
}: {
  controls: ReturnType<typeof useAnimation>;
  duration: number;
  size: number;
}) {
  const houseVariants: Variants = {
    normal: { scale: 1 },
    animate: {
      scale: [0.7, 1.06, 0.98, 1],
      transition: { duration: 0.55 * duration, times: [0, 0.55, 0.8, 1], ease: 'easeOut' },
    },
  };
  const doorVariants: Variants = {
    normal: { scaleY: 1, opacity: 1 },
    animate: {
      scaleY: [0, 1],
      opacity: [0, 1],
      transition: { duration: 0.3 * duration, delay: 0.35 * duration, ease: 'easeOut' },
    },
  };

  return (
    <m.svg
      aria-hidden="true"
      data-icon-name="house"
      animate={controls}
      fill="none"
      height={size}
      initial="normal"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      <m.g
        variants={houseVariants}
        style={{ transformBox: 'view-box', originX: '12px', originY: '21px' }}
      >
        <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10" />
        <path d="M21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9" />
        <m.path
          d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"
          variants={doorVariants}
          style={{ transformBox: 'view-box', originX: '12px', originY: '21px' }}
        />
      </m.g>
    </m.svg>
  );
}

function BookOpenTextIcon({
  controls,
  duration,
  size,
}: {
  controls: ReturnType<typeof useAnimation>;
  duration: number;
  size: number;
}) {
  const iconVariants: Variants = {
    normal: { rotate: 0, scale: 1 },
    animate: {
      rotate: [0, -2, 2, 0],
      scale: [1, 1.04, 0.98, 1],
      transition: { duration: 1.1 * duration, ease: 'easeInOut' },
    },
  };
  const spineVariants: Variants = {
    normal: { opacity: 1, pathLength: 1 },
    animate: (index: number) => ({
      opacity: [0.7, 1, 1],
      pathLength: [0.9, 1, 1],
      transition: { delay: index * 0.12, duration: 0.9 * duration, ease: 'easeInOut' },
    }),
  };
  const lineVariants: Variants = {
    normal: { opacity: 1, scaleX: 1, y: 0 },
    animate: (index: number) => ({
      opacity: [0.6, 1, 1],
      scaleX: [0.9, 1.05, 1],
      y: [1.5, -1, 0],
      transition: { delay: 0.2 + index * 0.1, duration: 0.9 * duration, ease: 'easeInOut' },
    }),
  };

  return (
    <m.svg
      aria-hidden="true"
      data-icon-name="book-open-text"
      animate={controls}
      fill="none"
      height={size}
      initial="normal"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      variants={iconVariants}
      viewBox="0 0 24 24"
      width={size}
    >
      <m.path
        d="M12 7v14"
        animate={controls}
        custom={0}
        initial="normal"
        variants={spineVariants}
      />
      <m.path d="M16 12h2" animate={controls} custom={0} initial="normal" variants={lineVariants} />
      <m.path d="M16 8h2" animate={controls} custom={1} initial="normal" variants={lineVariants} />
      <m.path
        d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"
        animate={controls}
        custom={1}
        initial="normal"
        variants={spineVariants}
      />
      <m.path d="M6 12h2" animate={controls} custom={2} initial="normal" variants={lineVariants} />
      <m.path d="M6 8h2" animate={controls} custom={3} initial="normal" variants={lineVariants} />
    </m.svg>
  );
}

function ImageIcon({
  controls,
  duration,
  size,
}: {
  controls: ReturnType<typeof useAnimation>;
  duration: number;
  size: number;
}) {
  const peakVariants: Variants = {
    normal: { pathLength: 1, opacity: 1 },
    animate: {
      pathLength: [0, 1],
      opacity: [0, 1],
      transition: { duration: 0.9 * duration, ease: [0.16, 1, 0.3, 1] },
    },
  };
  const sunVariants: Variants = {
    normal: { scale: 1, opacity: 1 },
    animate: {
      scale: [0, 1.25, 1],
      opacity: [0, 1, 1],
      transition: { duration: 0.8 * duration, delay: 0.3 * duration, ease: [0.34, 1.4, 0.64, 1] },
    },
  };

  return (
    <m.svg
      aria-hidden="true"
      data-icon-name="image"
      animate={controls}
      fill="none"
      height={size}
      initial="normal"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <m.circle
        cx="9"
        cy="9"
        r="2"
        variants={sunVariants}
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
      />
      <m.path
        d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"
        variants={peakVariants}
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
      />
    </m.svg>
  );
}

function NotebookPenIcon({
  controls,
  duration,
  size,
}: {
  controls: ReturnType<typeof useAnimation>;
  duration: number;
  size: number;
}) {
  const penVariants: Variants = {
    normal: { x: 0, y: 0, rotate: 0 },
    animate: {
      x: [0, -1.5, 1, -1, 0],
      y: [0, 1, -0.5, 0.8, 0],
      rotate: [0, -8, 4, -4, 0],
      transition: { duration: 0.8 * duration, ease: 'easeInOut' },
    },
  };
  const ringVariants: Variants = {
    normal: { scaleX: 1 },
    animate: (index: number) => ({
      scaleX: [1, 0.3, 1],
      transition: { duration: 0.3 * duration, delay: index * 0.08 * duration, ease: 'easeInOut' },
    }),
  };

  return (
    <m.svg
      aria-hidden="true"
      data-icon-name="notebook-pen"
      animate={controls}
      fill="none"
      height={size}
      initial="normal"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      <path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4" />
      {[6, 10, 14, 18].map((y, index) => (
        <m.path
          key={y}
          d={`M2 ${y}h4`}
          custom={index}
          variants={ringVariants}
          style={{ transformBox: 'view-box', originX: '4px', originY: `${y}px` }}
        />
      ))}
      <m.path
        d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"
        variants={penVariants}
        style={{ transformBox: 'view-box', originX: '13px', originY: '11px' }}
      />
    </m.svg>
  );
}

function SearchIcon({
  controls,
  duration,
  size,
}: {
  controls: ReturnType<typeof useAnimation>;
  duration: number;
  size: number;
}) {
  const lensVariants: Variants = {
    normal: { x: 0, y: 0, rotate: 0, opacity: 1 },
    animate: {
      x: [0, 2, -2, 1, 0],
      y: [0, -1, 2, -1, 0],
      rotate: [0, 6, -6, 4, 0],
      transition: { duration: 1.2 * duration, ease: 'easeInOut' },
    },
  };

  return (
    <m.svg
      aria-hidden="true"
      data-icon-name="search"
      animate={controls}
      fill="none"
      height={size}
      initial="normal"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      <m.g variants={lensVariants}>
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.34-4.34" />
      </m.g>
    </m.svg>
  );
}

function SunMoonIcon({
  controls,
  duration,
  size,
}: {
  controls: ReturnType<typeof useAnimation>;
  duration: number;
  size: number;
}) {
  const moonVariants: Variants = {
    normal: { rotate: 0 },
    animate: {
      rotate: [0, -18, 8, 0],
      transition: { duration: 0.7 * duration, ease: 'easeInOut', times: [0, 0.4, 0.75, 1] },
    },
  };
  const arcVariants: Variants = {
    normal: { pathLength: 1, opacity: 1 },
    animate: {
      pathLength: [0, 1],
      opacity: [0, 1],
      transition: { duration: 0.35 * duration, ease: 'easeOut', delay: 0.15 * duration },
    },
  };
  const rayVariants: Variants = {
    normal: { scale: 1, opacity: 1 },
    animate: (index: number) => ({
      scale: [0, 1.4, 1],
      opacity: [0, 1, 1],
      transition: {
        duration: 0.35 * duration,
        ease: 'easeOut',
        times: [0, 0.6, 1],
        delay: (0.3 + index * 0.1) * duration,
      },
    }),
  };

  return (
    <m.svg
      aria-hidden="true"
      data-icon-name="sun-moon"
      animate={controls}
      fill="none"
      height={size}
      initial="normal"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      <m.path
        d="M12 2v2"
        custom={0}
        variants={rayVariants}
        style={{ transformBox: 'view-box', originX: '12px', originY: '3px' }}
      />
      <m.path
        d="M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715"
        variants={moonVariants}
        style={{ transformBox: 'view-box', originX: '12px', originY: '12px' }}
      />
      <m.path d="M16 12a4 4 0 0 0-4-4" variants={arcVariants} />
      <m.path
        d="m19 5-1.256 1.256"
        custom={1}
        variants={rayVariants}
        style={{ transformBox: 'view-box', originX: '18.4px', originY: '5.6px' }}
      />
      <m.path
        d="M20 12h2"
        custom={2}
        variants={rayVariants}
        style={{ transformBox: 'view-box', originX: '21px', originY: '12px' }}
      />
    </m.svg>
  );
}

function MailsIcon({
  controls,
  duration,
  size,
}: {
  controls: ReturnType<typeof useAnimation>;
  duration: number;
  size: number;
}) {
  const iconVariants: Variants = {
    normal: { scale: 1, y: 0 },
    animate: {
      scale: [1, 1.05, 0.95, 1],
      transition: { duration: 1.6 * duration, ease: [0.42, 0, 0.58, 1] },
      y: [0, -3, 3, -2, 0],
    },
  };
  const flapVariants: Variants = {
    normal: { opacity: 1, rotate: 0 },
    animate: {
      opacity: [1, 0.7, 1],
      rotate: [-4, 4, -3, 0],
      transition: { duration: 1.2 * duration, ease: [0.42, 0, 0.58, 1] },
    },
  };
  const outlineVariants: Variants = {
    normal: { opacity: 1 },
    animate: {
      opacity: [0.7, 1, 0.5, 1],
      transition: { duration: 1.4 * duration, ease: [0.42, 0, 0.58, 1] },
    },
  };

  return (
    <m.svg
      aria-hidden="true"
      data-icon-name="mails"
      animate={controls}
      fill="none"
      height={size}
      initial="normal"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      variants={iconVariants}
      viewBox="0 0 24 24"
      width={size}
    >
      <m.path
        d="M17 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 1-1.732"
        variants={outlineVariants}
      />
      <m.path d="m22 5.5-6.419 4.179a2 2 0 0 1-2.162 0L7 5.5" variants={flapVariants} />
      <m.rect width="15" height="12" x="7" y="3" rx="2" variants={outlineVariants} />
    </m.svg>
  );
}
