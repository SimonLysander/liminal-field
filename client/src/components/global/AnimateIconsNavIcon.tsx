/*
 * Animation definitions adapted from selected @animateicons/react icons
 * (Copyright 2025 Avijit Dey), licensed under MIT.
 * See client/THIRD_PARTY_NOTICES.md for the complete license notice.
 *
 * The upstream package exposes only a full icon-library entry point. Keeping
 * these source animations local prevents every AnimateIcons icon from
 * entering the sidebar's initial bundle.
 */
import { useEffect } from 'react';
import type { Variants } from 'motion/react';
import { LazyMotion, domMin, m, useAnimation, useReducedMotion } from 'motion/react';

type AnimatedNavSpace = 'home' | 'notes' | 'anthology' | 'gallery' | 'digest';

type AnimateIconsNavIconProps = {
  space: AnimatedNavSpace;
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
    if (!isExternallyControlled) return;

    void controls.start(!reducedMotion && isHovered ? 'animate' : 'normal');
  }, [controls, isExternallyControlled, isHovered, reducedMotion]);

  const play = () => {
    if (!reducedMotion) void controls.start('animate');
  };

  const reset = () => {
    void controls.start('normal');
  };

  return (
    <LazyMotion features={domMin} strict>
      <m.span
        className="inline-flex items-center justify-center"
        onMouseEnter={isExternallyControlled ? undefined : play}
        onMouseLeave={isExternallyControlled ? undefined : reset}
      >
        {space === 'home' && <HomeIcon controls={controls} duration={duration} size={size} />}
        {space === 'notes' && <FolderOpenIcon controls={controls} duration={duration} size={size} />}
        {space === 'anthology' && <BookOpenTextIcon controls={controls} duration={duration} size={size} />}
        {space === 'gallery' && <InstagramIcon controls={controls} duration={duration} size={size} />}
        {space === 'digest' && <MailsIcon controls={controls} duration={duration} size={size} />}
      </m.span>
    </LazyMotion>
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
  const baseVariants: Variants = {
    normal: { opacity: 1 },
    animate: { opacity: 0.65, transition: { duration: 0.2 * duration, ease: 'easeOut' } },
  };
  const doorVariants: Variants = {
    normal: { opacity: 1 },
    animate: {
      opacity: [1, 0.4, 1],
      transition: { duration: 0.35 * duration, ease: 'easeInOut' },
    },
  };

  return (
    <m.svg
      aria-hidden="true"
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
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10" />
      <m.path d="M21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9" variants={baseVariants} />
      <m.path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" variants={doorVariants} />
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
      <m.path d="M12 7v14" animate={controls} custom={0} initial="normal" variants={spineVariants} />
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

function InstagramIcon({
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
      rotate: 0,
      scale: [1, 1.06, 1],
      transition: { duration: 0.4 * duration, ease: 'easeOut' },
    },
  };
  const frameVariants: Variants = {
    normal: { opacity: 1, pathLength: 1 },
    animate: {
      opacity: [0.6, 1],
      pathLength: [0.2, 1],
      transition: { duration: 0.55 * duration, ease: 'easeInOut' },
    },
  };
  const lensVariants: Variants = {
    normal: { pathLength: 1, scale: 1 },
    animate: {
      pathLength: [0, 1],
      scale: [0.85, 1.05, 1],
      transition: { delay: 0.1 * duration, duration: 0.5 * duration, ease: 'easeOut' },
    },
  };
  const indicatorVariants: Variants = {
    normal: { opacity: 1, scale: 1 },
    animate: {
      opacity: [1, 0.4, 1],
      scale: [1, 1.5, 1],
      transition: { delay: 0.2 * duration, duration: 0.35 * duration, ease: 'easeInOut' },
    },
  };

  return (
    <m.svg
      aria-hidden="true"
      data-icon-name="instagram"
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
      <m.rect width="20" height="20" x="2" y="2" rx="5" ry="5" variants={frameVariants} />
      <m.path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" variants={lensVariants} />
      <m.line x1="17.5" x2="17.51" y1="6.5" y2="6.5" variants={indicatorVariants} />
    </m.svg>
  );
}

function FolderOpenIcon({
  controls,
  duration,
  size,
}: {
  controls: ReturnType<typeof useAnimation>;
  duration: number;
  size: number;
}) {
  const folderVariants: Variants = {
    normal: { rotate: 0, scale: 1, y: 0 },
    animate: {
      rotate: [0, -2, 2, 0],
      scale: [1, 1.05, 0.97, 1],
      transition: { duration: 0.9 * duration, ease: 'easeInOut' },
      y: [0, -1.5, 0.5, 0],
    },
  };
  const paperVariants: Variants = {
    normal: { opacity: 0, y: 0 },
    animate: {
      opacity: [0, 1, 0],
      transition: { delay: 0.2, duration, ease: 'easeInOut' },
      y: [-6, 0],
    },
  };

  return (
    <m.svg
      aria-hidden="true"
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
        d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
        variants={folderVariants}
      />
      <m.rect width="10" height="6" x="7" y="11" rx="1" variants={paperVariants} />
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
      <m.path
        d="m22 5.5-6.419 4.179a2 2 0 0 1-2.162 0L7 5.5"
        variants={flapVariants}
      />
      <m.rect width="15" height="12" x="7" y="3" rx="2" variants={outlineVariants} />
    </m.svg>
  );
}
