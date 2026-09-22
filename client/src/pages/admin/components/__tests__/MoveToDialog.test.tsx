import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { StructureNode } from '@/services/structure';
import { structureApi } from '@/services/structure';
import { MoveToDialog } from '../MoveToDialog';

vi.mock('@/services/structure', () => ({
  structureApi: {
    getRootNodes: vi.fn(),
    getChildren: vi.fn(),
  },
}));

const movingNode: StructureNode = {
  id: 'moving',
  name: '待移动笔记',
  type: 'DOC',
  sortOrder: 0,
  hasChildren: false,
  createdAt: '2026-09-22T00:00:00.000Z',
};

const leafTarget: StructureNode = {
  id: 'leaf-target',
  name: '叶子笔记',
  type: 'DOC',
  sortOrder: 1,
  hasChildren: false,
  createdAt: '2026-09-22T00:00:00.000Z',
};

describe('MoveToDialog', () => {
  it('允许进入叶子节点并将其选为目标父节点', async () => {
    vi.mocked(structureApi.getRootNodes).mockResolvedValue({
      path: [],
      children: [movingNode, leafTarget],
    });
    vi.mocked(structureApi.getChildren).mockResolvedValue({
      path: [],
      children: [],
    });
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <MoveToDialog
        node={movingNode}
        scope="notes"
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText('叶子笔记')).toBeInTheDocument();
    expect(screen.queryByText('待移动笔记')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('叶子笔记'));
    await waitFor(() =>
      expect(structureApi.getChildren).toHaveBeenCalledWith('leaf-target', {
        visibility: 'all',
        scope: 'notes',
      }),
    );

    expect(await screen.findByText('目标：叶子笔记')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移动到此处' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('leaf-target'));
  });
});
