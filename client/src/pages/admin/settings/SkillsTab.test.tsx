/**
 * SkillsTab 单测 — 渲染 + 表单提交 happy path + 校验失败拦截。
 *
 * 因为 SkillsTab 接 skillsApi + settingsApi,这里把 services 整个模块 mock。
 * 覆盖:
 *   1. 列表渲染:从 skillsApi.list 拉到的 skill 展示
 *   2. 空态:list 返回 [] 时显示提示
 *   3. 新建表单 happy path:校验通过 → 调 skillsApi.create
 *   4. 校验失败:name 非法时按钮 disabled
 *
 * spec: docs/superpowers/specs/2026-06-03-agent-skills-design.md §6.2
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SkillsTab } from './SkillsTab';

// mock 整个 skills/settings services 模块,确保 SkillsTab 不真发请求
vi.mock('@/services/skills', () => ({
  skillsApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/services/settings', () => ({
  settingsApi: {
    getAvailableTools: vi.fn(),
  },
}));

// banner toast 不参与断言,简单 mock 避免副作用
vi.mock('@/components/ui/banner-api', () => ({
  banner: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { skillsApi } from '@/services/skills';
import { settingsApi } from '@/services/settings';

const mkSkill = (over: Partial<{ _id: string; name: string; displayName: string; description: string; whenToUse: string; body: string; requiredTools: string[] }> = {}) => ({
  _id: 'sk-001',
  name: 'critic',
  displayName: '批评家',
  description: '挑稿子毛病',
  whenToUse: '用户请求批评式 review 时',
  body: '## 批评家方法论\n严厉而具体',
  requiredTools: ['web_search'],
  createdAt: '2026-06-03T00:00:00Z',
  updatedAt: '2026-06-03T00:00:00Z',
  ...over,
});

describe('<SkillsTab>', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(settingsApi.getAvailableTools).mockResolvedValue([
      'web_search',
      'recall_memory',
      'web_fetch',
    ]);
  });

  it('渲染列表:展示 displayName + name slug + description', async () => {
    vi.mocked(skillsApi.list).mockResolvedValue([mkSkill()]);
    render(<SkillsTab />);

    await waitFor(() => {
      expect(screen.getByText('批评家')).toBeInTheDocument();
    });
    expect(screen.getByText('critic')).toBeInTheDocument();
    expect(screen.getByText('挑稿子毛病')).toBeInTheDocument();
  });

  it('空态:list 返回 [] 时显示空提示', async () => {
    vi.mocked(skillsApi.list).mockResolvedValue([]);
    render(<SkillsTab />);

    await waitFor(() => {
      expect(screen.getByText(/暂无技能/)).toBeInTheDocument();
    });
  });

  it('新建 happy path:校验通过 → 调 skillsApi.create 并传入完整 input', async () => {
    vi.mocked(skillsApi.list).mockResolvedValue([]);
    vi.mocked(skillsApi.create).mockResolvedValue(mkSkill());

    render(<SkillsTab />);
    await waitFor(() => {
      expect(screen.getByText(/暂无技能/)).toBeInTheDocument();
    });

    // 打开新建 dialog
    fireEvent.click(screen.getByText('+ 新建技能'));

    await waitFor(() => {
      // dialog 标题出现
      expect(screen.getByText('新建技能')).toBeInTheDocument();
    });

    // 填表单 — 按 placeholder 锁定 input(不依赖 label 关联,SettingsUI.TextInput 没 htmlFor)
    fireEvent.change(screen.getByPlaceholderText('critic'), {
      target: { value: 'polisher' },
    });
    fireEvent.change(screen.getByPlaceholderText('批评家'), {
      target: { value: '润色师' },
    });
    fireEvent.change(
      screen.getByPlaceholderText('一句话说明这个 skill 的作用'),
      { target: { value: '把粗稿改得通顺' } },
    );
    fireEvent.change(
      screen.getByPlaceholderText(
        '什么时候该用这个 skill,引导 agent 自动判断',
      ),
      { target: { value: '用户问"帮我润色"时' } },
    );
    fireEvent.change(
      screen.getByPlaceholderText('agent invoke 这个 skill 时注入的方法论 prompt'),
      { target: { value: '## 润色师 body' } },
    );

    // 提交
    fireEvent.click(screen.getByText('创建'));

    await waitFor(() => {
      expect(skillsApi.create).toHaveBeenCalledTimes(1);
    });
    const call = vi.mocked(skillsApi.create).mock.calls[0][0];
    expect(call.name).toBe('polisher');
    expect(call.displayName).toBe('润色师');
    expect(call.description).toBe('把粗稿改得通顺');
    expect(call.whenToUse).toBe('用户问"帮我润色"时');
    expect(call.body).toBe('## 润色师 body');
    expect(call.requiredTools).toEqual([]); // 没添加 chip
  });

  it('name 非法时提交按钮 disabled,不发请求', async () => {
    vi.mocked(skillsApi.list).mockResolvedValue([]);
    render(<SkillsTab />);
    await waitFor(() => {
      expect(screen.getByText(/暂无技能/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('+ 新建技能'));
    await waitFor(() => {
      expect(screen.getByText('新建技能')).toBeInTheDocument();
    });

    // 填非法 name(大写起头)+ 其余字段合规
    fireEvent.change(screen.getByPlaceholderText('critic'), {
      target: { value: 'Critic' },
    });
    fireEvent.change(screen.getByPlaceholderText('批评家'), {
      target: { value: '批评家' },
    });
    fireEvent.change(
      screen.getByPlaceholderText('一句话说明这个 skill 的作用'),
      { target: { value: '挑毛病' } },
    );
    fireEvent.change(
      screen.getByPlaceholderText(
        '什么时候该用这个 skill,引导 agent 自动判断',
      ),
      { target: { value: '用户要批评时' } },
    );
    fireEvent.change(
      screen.getByPlaceholderText('agent invoke 这个 skill 时注入的方法论 prompt'),
      { target: { value: '## body' } },
    );

    // 提交按钮存在但点击不发请求(disabled)
    const createBtn = screen.getByText('创建');
    fireEvent.click(createBtn);
    // 应显示 name 错误提示
    expect(screen.getByText(/小写字母起头/)).toBeInTheDocument();
    expect(skillsApi.create).not.toHaveBeenCalled();
  });
});
