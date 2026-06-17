/**
 * BlockMenu 集成测试 —— 在一个简化 editor mock 里验证按钮触发的 editor.tf.* 调用
 *
 * 注意：vi.mock 被 vitest 提升到文件顶部，所以 mock factory 中不能引用之后定义的变量。
 * 解决：用 vi.hoisted 在提升阶段创建 mockEditor，再在 mock factory 里引用它。
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// vi.hoisted 确保 mockEditor 在 vi.mock 提升时已存在
const mockEditor = vi.hoisted(() => ({
  tf: {
    insertNodes: vi.fn(),
    removeNodes: vi.fn(),
  },
}));

vi.mock('platejs/react', () => ({
  useEditorRef: () => mockEditor,
}));

vi.mock('@/components/editor/transforms', () => ({
  getBlockType: () => 'p',
  setBlockType: vi.fn(),
}));

import { BlockMenu } from './block-menu';

describe('BlockMenu', () => {
  it('点击删除调 editor.tf.removeNodes', async () => {
    const node = { type: 'p', children: [{ text: 'hello' }] } as Parameters<typeof BlockMenu>[0]['blockNode'];
    render(<BlockMenu blockPath={[2]} blockNode={node} />);
    // 触发 Popover 打开
    fireEvent.click(screen.getByRole('button', { name: '块菜单' }));
    // 等 Radix Portal 渲染
    fireEvent.click(await screen.findByText('删除块'));
    expect(mockEditor.tf.removeNodes).toHaveBeenCalledWith({ at: [2] });
  });

  it('点击复制调 editor.tf.insertNodes 在 path+1', async () => {
    const node = { type: 'p', children: [{ text: 'hello' }] } as Parameters<typeof BlockMenu>[0]['blockNode'];
    render(<BlockMenu blockPath={[2]} blockNode={node} />);
    fireEvent.click(screen.getByRole('button', { name: '块菜单' }));
    fireEvent.click(await screen.findByText('复制'));
    expect(mockEditor.tf.insertNodes).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'p' }),
      { at: [3] }
    );
  });

  it('在上方插入调 editor.tf.insertNodes 在 path', async () => {
    const node = { type: 'p', children: [{ text: 'hello' }] } as Parameters<typeof BlockMenu>[0]['blockNode'];
    render(<BlockMenu blockPath={[2]} blockNode={node} />);
    fireEvent.click(screen.getByRole('button', { name: '块菜单' }));
    fireEvent.click(await screen.findByText('在上方插入'));
    expect(mockEditor.tf.insertNodes).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'p', children: [{ text: '' }] }),
      { at: [2] }
    );
  });
});
