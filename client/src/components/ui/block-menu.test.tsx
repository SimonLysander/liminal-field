/**
 * BlockMenu 集成测试 —— 在一个简化 editor mock 里验证按钮触发的 editor.tf.* 调用
 *
 * 注意：vi.mock 被 vitest 提升到文件顶部，所以 mock factory 中不能引用之后定义的变量。
 * 解决：用 vi.hoisted 在提升阶段创建 mockEditor，再在 mock factory 里引用它。
 *
 * motion/react mock 说明：
 *   happy-dom 下 AnimatePresence + motion.div 本身不阻止渲染，但 motion.div 的
 *   initial/animate props 依赖真实动画引擎，在 jsdom/happy-dom 里不会 commit 样式。
 *   为确保元素确实进入 DOM（不被动画引擎延迟），用最简单的恒等组件替换。
 *
 * block-menu-turn-into mock 说明：
 *   TurnInto 子菜单依赖 KEYS（platejs 常量）和 setBlockType。
 *   为让 C5 断言简单稳定，mock 成只渲染固定文本的组件；
 *   不影响对 view 切换逻辑的验证（那是 block-menu 自身的状态）。
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ComponentProps } from 'react';

// ─── motion/react ──────────────────────────────────────────────────────────
// 用恒等组件替换动画封装，确保 DOM 里的子节点立即可见。
// 重要：要把 motion.div 接收的 initial/animate/exit/transition 这几个 motion 专属 prop
// 从 spread 里剥掉，否则 React 19 会对真实 <div> 报"未知 DOM 属性"warning，污染测试 console。
const MOTION_ONLY_PROPS = ['initial', 'animate', 'exit', 'transition'] as const;
const stripMotionProps = (
  props: Record<string, unknown>,
): Record<string, unknown> => {
  const out = { ...props };
  for (const k of MOTION_ONLY_PROPS) delete out[k];
  return out;
};
vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      children,
      ...rest
    }: ComponentProps<'div'> & Record<string, unknown>) => (
      <div {...stripMotionProps(rest)}>{children}</div>
    ),
  },
}));

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

// block-menu-turn-into mock：渲染固定占位文本，让 C5/C6 只验证 view 切换而无需关心子菜单内部实现
vi.mock('@/components/ui/block-menu-turn-into', () => ({
  BlockMenuTurnInto: () => <div>转换成子菜单</div>,
}));

import { BlockMenu } from './block-menu';

describe('BlockMenu', () => {
  // ── C1 ────────────────────────────────────────────────────────────────────
  it('点击删除调 editor.tf.removeNodes', async () => {
    const node = { type: 'p', children: [{ text: 'hello' }] } as Parameters<typeof BlockMenu>[0]['blockNode'];
    render(<BlockMenu blockPath={[2]} blockNode={node} />);
    // 触发 Popover 打开
    fireEvent.click(screen.getByRole('button', { name: '块菜单' }));
    // 等 Radix Portal 渲染
    fireEvent.click(await screen.findByText('删除块'));
    expect(mockEditor.tf.removeNodes).toHaveBeenCalledWith({ at: [2] });
  });

  // ── C2 ────────────────────────────────────────────────────────────────────
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

  // ── C3 ────────────────────────────────────────────────────────────────────
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

  // ── C4 ────────────────────────────────────────────────────────────────────
  it('在下方插入调 editor.tf.insertNodes 空段落在 path+1', async () => {
    const node = { type: 'p', children: [{ text: 'hello' }] } as Parameters<typeof BlockMenu>[0]['blockNode'];
    render(<BlockMenu blockPath={[2]} blockNode={node} />);
    fireEvent.click(screen.getByRole('button', { name: '块菜单' }));
    fireEvent.click(await screen.findByText('在下方插入'));
    // 与复制不同：插入的是空段落而非克隆节点，路径同为 path+1
    expect(mockEditor.tf.insertNodes).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'p', children: [{ text: '' }] }),
      { at: [3] }
    );
  });

  // ── C5 ────────────────────────────────────────────────────────────────────
  it('点击转换成 → 切换到 turnInto 视图，显示返回按钮和子菜单', async () => {
    const node = { type: 'p', children: [{ text: 'hello' }] } as Parameters<typeof BlockMenu>[0]['blockNode'];
    render(<BlockMenu blockPath={[2]} blockNode={node} />);
    fireEvent.click(screen.getByRole('button', { name: '块菜单' }));

    // 主视图：转换成 可见
    expect(await screen.findByText('转换成')).toBeInTheDocument();

    fireEvent.click(screen.getByText('转换成'));

    // turnInto 视图：返回按钮 + 子菜单占位文本可见
    expect(await screen.findByText('返回')).toBeInTheDocument();
    expect(screen.getByText('转换成子菜单')).toBeInTheDocument();
    // 主视图的菜单项（删除块）不应再显示
    expect(screen.queryByText('删除块')).not.toBeInTheDocument();
  });

  // ── C6 ────────────────────────────────────────────────────────────────────
  it('点击转换成 → 点击返回 → 回到主视图', async () => {
    const node = { type: 'p', children: [{ text: 'hello' }] } as Parameters<typeof BlockMenu>[0]['blockNode'];
    render(<BlockMenu blockPath={[2]} blockNode={node} />);
    fireEvent.click(screen.getByRole('button', { name: '块菜单' }));

    // 进入 turnInto 视图
    fireEvent.click(await screen.findByText('转换成'));
    expect(await screen.findByText('返回')).toBeInTheDocument();

    // 返回主视图
    fireEvent.click(screen.getByText('返回'));

    // 主视图项重新可见
    expect(await screen.findByText('转换成')).toBeInTheDocument();
    expect(screen.getByText('删除块')).toBeInTheDocument();
    // 返回按钮已消失
    expect(screen.queryByText('返回')).not.toBeInTheDocument();
  });

  // ── C7 ────────────────────────────────────────────────────────────────────
  it('受控 open=true 时不点触发器也能看到菜单内容；删除后调 onOpenChange(false)', async () => {
    const node = { type: 'p', children: [{ text: 'hello' }] } as Parameters<typeof BlockMenu>[0]['blockNode'];
    const onOpenChange = vi.fn();

    // open=true 直接受控展开，不需要点触发器
    render(<BlockMenu blockPath={[1]} blockNode={node} open={true} onOpenChange={onOpenChange} />);

    // 菜单内容应立即可见（受控 open 由 Radix Popover 处理）
    expect(await screen.findByText('删除块')).toBeInTheDocument();

    fireEvent.click(screen.getByText('删除块'));

    // handleDelete 内 close() → setOpen(false) → onOpenChange(false)
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockEditor.tf.removeNodes).toHaveBeenCalledWith({ at: [1] });
  });

  // ── C8 ────────────────────────────────────────────────────────────────────
  it('非受控模式：点触发器打开，删除后 popover 关闭（菜单项不再可查）', async () => {
    const node = { type: 'p', children: [{ text: 'hello' }] } as Parameters<typeof BlockMenu>[0]['blockNode'];
    render(<BlockMenu blockPath={[0]} blockNode={node} />);

    const trigger = screen.getByRole('button', { name: '块菜单' });

    // 初始状态：菜单项不可见
    expect(screen.queryByText('删除块')).not.toBeInTheDocument();

    // 点击触发器打开
    fireEvent.click(trigger);
    expect(await screen.findByText('删除块')).toBeInTheDocument();

    // 点击删除 → close() 收起 popover
    fireEvent.click(screen.getByText('删除块'));

    // 关闭后菜单内容应从 DOM 中消失
    expect(screen.queryByText('删除块')).not.toBeInTheDocument();
    // trigger 的 aria-expanded / data-state 回到关闭
    expect(trigger).toHaveAttribute('data-state', 'closed');
  });
});
