import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimateIconsNavIcon } from '../AnimateIconsNavIcon';

const animation = vi.hoisted(() => ({
  start: vi.fn(() => Promise.resolve()),
  reducedMotion: false,
}));

vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>();
  const controls = {
    start: animation.start,
    stop: vi.fn(),
    subscribe: () => () => {},
    mount: () => () => {},
  };
  return {
    ...actual,
    useAnimation: () => controls,
    useReducedMotion: () => animation.reducedMotion,
  };
});

describe('navigation icon animation controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    animation.reducedMotion = false;
  });

  it('follows the parent hover state and resets on leaving', () => {
    const { rerender } = render(<AnimateIconsNavIcon space="notes" isHovered={false} />);
    expect(animation.start).toHaveBeenLastCalledWith('normal');

    rerender(<AnimateIconsNavIcon space="notes" isHovered />);
    expect(animation.start).toHaveBeenLastCalledWith('animate');

    rerender(<AnimateIconsNavIcon space="notes" isHovered={false} />);
    expect(animation.start).toHaveBeenLastCalledWith('normal');
  });

  it('handles its own hover when no parent state is provided', () => {
    const { container } = render(<AnimateIconsNavIcon space="search" />);
    const wrapper = container.querySelector('span')!;

    fireEvent.mouseEnter(wrapper);
    expect(animation.start).toHaveBeenLastCalledWith('animate');
    fireEvent.mouseLeave(wrapper);
    expect(animation.start).toHaveBeenLastCalledWith('normal', undefined);
  });

  it('does not respond to icon hover when the parent controls it', () => {
    const { container } = render(<AnimateIconsNavIcon space="theme" isHovered={false} />);
    animation.start.mockClear();

    fireEvent.mouseEnter(container.querySelector('span')!);
    expect(animation.start).not.toHaveBeenCalled();
  });

  it('keeps parent-controlled icons static with reduced motion', () => {
    animation.reducedMotion = true;
    const { rerender } = render(<AnimateIconsNavIcon space="gallery" isHovered />);
    rerender(<AnimateIconsNavIcon space="gallery" isHovered={false} />);

    expect(animation.start.mock.calls).toEqual([
      ['normal', { duration: 0 }],
      ['normal', { duration: 0 }],
    ]);
  });

  it('keeps self-controlled icons static with reduced motion', () => {
    animation.reducedMotion = true;
    const { container } = render(<AnimateIconsNavIcon space="search" />);
    fireEvent.mouseEnter(container.querySelector('span')!);
    fireEvent.mouseLeave(container.querySelector('span')!);

    expect(animation.start.mock.calls).toEqual([
      ['normal', { duration: 0 }],
      ['normal', { duration: 0 }],
    ]);
  });

  it('immediately resets an active animation when reduced motion is enabled', () => {
    const { rerender } = render(<AnimateIconsNavIcon space="home" isHovered />);
    expect(animation.start).toHaveBeenLastCalledWith('animate');
    animation.start.mockClear();

    animation.reducedMotion = true;
    rerender(<AnimateIconsNavIcon space="home" isHovered />);

    expect(animation.start).toHaveBeenCalledExactlyOnceWith('normal', { duration: 0 });
  });
});
