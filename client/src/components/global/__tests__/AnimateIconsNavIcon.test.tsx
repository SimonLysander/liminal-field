import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnimateIconsNavIcon } from '../AnimateIconsNavIcon';

describe('AnimateIconsNavIcon', () => {
  it.each([
    ['home', 'house'],
    ['notes', 'notebook-pen'],
    ['anthology', 'book-open-text'],
    ['gallery', 'image'],
    ['digest', 'mails'],
    ['connect', 'file-code'],
    ['search', 'search'],
    ['theme', 'sun-moon'],
  ] as const)('renders %s with the %s semantic icon', (space, iconName) => {
    const { container } = render(<AnimateIconsNavIcon space={space} />);

    const icon = container.querySelector(`svg[data-icon-name="${iconName}"]`);
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute('width', '16');
    expect(icon).toHaveAttribute('height', '16');
    expect(icon).toHaveAttribute('stroke-width', '2');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('uses AnimateIcons official Image geometry', () => {
    const { container } = render(<AnimateIconsNavIcon space="gallery" />);

    expect(
      container.querySelector('path[d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"]'),
    ).toBeInTheDocument();
    expect(container.querySelector('rect')).toHaveAttribute('width', '18');
    expect(container.querySelector('circle')).toHaveAttribute('r', '2');
  });

  it('uses AnimateIcons official NotebookPen geometry', () => {
    const { container } = render(<AnimateIconsNavIcon space="notes" />);

    expect(container.querySelector('svg')?.querySelectorAll('path')).toHaveLength(6);
    expect(container.querySelector('path[d="M2 6h4"]')).toBeInTheDocument();
    expect(container.querySelector('path[d="M2 18h4"]')).toBeInTheDocument();
  });

  it('uses the combined SunMoon icon rather than theme-specific icons', () => {
    const { container } = render(<AnimateIconsNavIcon space="theme" />);

    expect(container.querySelector('svg')?.querySelectorAll('path')).toHaveLength(5);
    expect(container.querySelector('path[d="M16 12a4 4 0 0 0-4-4"]')).toBeInTheDocument();
  });

  it('keeps the mobile size without changing geometry or stroke', () => {
    const { container } = render(<AnimateIconsNavIcon space="home" size={22} />);

    expect(container.querySelector('svg')).toHaveAttribute('width', '22');
    expect(container.querySelector('svg')).toHaveAttribute('stroke-width', '2');
  });

  it('uses AnimateIcons official FileCode geometry and the requested navigation size', () => {
    const { container } = render(<AnimateIconsNavIcon space="connect" size={16} />);
    const icon = container.querySelector('svg[data-icon-name="file-code"]');

    expect(icon).toHaveAttribute('width', '16');
    expect(icon).toHaveAttribute('height', '16');
    expect(icon).toHaveAttribute('stroke-width', '2');
    expect(icon?.querySelector('path[d="M10 12.5 8 15l2 2.5"]')).toBeInTheDocument();
    expect(icon?.querySelector('path[d="m14 12.5 2 2.5-2 2.5"]')).toBeInTheDocument();
  });
});
