import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnimateIconsNavIcon } from '../AnimateIconsNavIcon';

describe('AnimateIconsNavIcon', () => {
  it.each([
    ['gallery', 'instagram'],
    ['digest', 'mails'],
  ] as const)('renders %s with the %s semantic icon', (space, iconName) => {
    const { container } = render(<AnimateIconsNavIcon space={space} />);

    expect(container.querySelector(`svg[data-icon-name="${iconName}"]`)).toBeInTheDocument();
  });

  it('uses AnimateIcons official Instagram geometry', () => {
    const { container } = render(<AnimateIconsNavIcon space="gallery" />);

    expect(
      container.querySelector('path[d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"]'),
    ).toBeInTheDocument();
  });
});
