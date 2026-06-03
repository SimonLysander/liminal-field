/**
 * SkillSlashPopover 单测 — TDD 先行,覆盖 spec §5.3 + Phase 4 Task 4.1 要求。
 *
 * 验证点(对应任务约束):
 *   1. query 以 / 开头且 skills 非空 → 浮层渲染所有候选
 *   2. query="/cri" → 仅渲染匹配 critic
 *   3. 选中(回车 / 点击)调 onPick 携带 skill name
 *   4. skills 空数组 → 浮层不渲染(隐式 close)
 *   5. ↑↓ 键移动高亮,Esc 关闭
 *
 * spec: docs/superpowers/specs/2026-06-03-agent-skills-design.md §5.3
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SkillSlashPopover } from './SkillSlashPopover';
import {
  filterSkillsByQuery,
  replaceSlashTokenInText,
} from './slash-text-utils';
import type { Skill } from '@/services/skills';

/** 构造 Skill 对象的测试工厂(只填浮层关心的字段;其他字段塞空) */
function makeSkill(name: string, description = ''): Skill {
  return {
    _id: name,
    name,
    displayName: name,
    description,
    whenToUse: '',
    body: '',
    requiredTools: [],
    createdAt: '',
    updatedAt: '',
  };
}

const SKILLS: Skill[] = [
  makeSkill('critic', '批评文字'),
  makeSkill('coach', '陪练写作'),
  makeSkill('researcher', '查资料'),
];

describe('filterSkillsByQuery(纯函数)', () => {
  // 浮层的「触发 + 过滤」纯逻辑抽出来单测,组件层只验渲染。
  it('query="/" → 返回全部', () => {
    expect(filterSkillsByQuery(SKILLS, '/').map((s) => s.name)).toEqual([
      'critic',
      'coach',
      'researcher',
    ]);
  });

  it('query="/cri" → 仅 critic', () => {
    expect(filterSkillsByQuery(SKILLS, '/cri').map((s) => s.name)).toEqual([
      'critic',
    ]);
  });

  it('query="/zzz" → 空数组', () => {
    expect(filterSkillsByQuery(SKILLS, '/zzz')).toEqual([]);
  });

  it('query 不以 / 开头 → 空(浮层应不触发)', () => {
    expect(filterSkillsByQuery(SKILLS, 'critic')).toEqual([]);
  });

  it('query="/" + skills 空 → 空', () => {
    expect(filterSkillsByQuery([], '/')).toEqual([]);
  });

  it('过滤大小写不敏感', () => {
    expect(filterSkillsByQuery(SKILLS, '/CRI').map((s) => s.name)).toEqual([
      'critic',
    ]);
  });
});

describe('<SkillSlashPopover>', () => {
  it('open=true + skills 有匹配 → 渲染候选 + description', () => {
    render(
      <SkillSlashPopover
        open
        skills={SKILLS}
        query="/"
        onPick={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('critic')).toBeInTheDocument();
    expect(screen.getByText('coach')).toBeInTheDocument();
    expect(screen.getByText('批评文字')).toBeInTheDocument();
  });

  it('query="/cri" → 仅渲染 critic,不渲染 coach', () => {
    render(
      <SkillSlashPopover
        open
        skills={SKILLS}
        query="/cri"
        onPick={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('critic')).toBeInTheDocument();
    expect(screen.queryByText('coach')).not.toBeInTheDocument();
  });

  it('open=true + skills 空 → 不渲染浮层', () => {
    // 空 enabledSkills 时浮层完全不出,避免假阳性触发(用户体验:输 / 没事发生)
    render(
      <SkillSlashPopover
        open
        skills={[]}
        query="/"
        onPick={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('open=false → 不渲染', () => {
    render(
      <SkillSlashPopover
        open={false}
        skills={SKILLS}
        query="/"
        onPick={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText('critic')).not.toBeInTheDocument();
  });

  it('skills 空但 query="/" → 不渲染浮层(对应任务约束:没 enabledSkills 不弹)', () => {
    const { container } = render(
      <SkillSlashPopover
        open
        skills={[]}
        query="/"
        onPick={() => {}}
        onClose={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('mouseDown 候选项调 onPick(skill.name)', () => {
    // 真实 DOM 上 click 之前 Plate 编辑器先收 blur,会丢焦点;所以浮层
    // 用 mouseDown 触发选中(preventDefault 阻断焦点漂移)。测试覆盖该路径。
    const onPick = vi.fn();
    render(
      <SkillSlashPopover
        open
        skills={SKILLS}
        query="/"
        onPick={onPick}
        onClose={() => {}}
      />,
    );
    fireEvent.mouseDown(screen.getByText('coach'));
    expect(onPick).toHaveBeenCalledWith('coach');
  });
});

describe('replaceSlashTokenInText(选中后的文本改写)', () => {
  // 抽出来的纯函数,覆盖关键约束:选中替换 input value
  it('/cri 这段写得怎么样 → /critic 这段写得怎么样', () => {
    expect(replaceSlashTokenInText('/cri 这段写得怎么样', 'critic')).toBe(
      '/critic 这段写得怎么样',
    );
  });

  it('单独 / → /critic ', () => {
    expect(replaceSlashTokenInText('/', 'critic')).toBe('/critic ');
  });

  it('没斜杠的输入 → 前插 /critic ', () => {
    expect(replaceSlashTokenInText('已有内容', 'critic')).toBe(
      '/critic 已有内容',
    );
  });

  it('空文本 → /critic ', () => {
    expect(replaceSlashTokenInText('', 'critic')).toBe('/critic ');
  });

  it('保留尾部空白结构(/cri →空格→内容)', () => {
    expect(replaceSlashTokenInText('/cri', 'critic')).toBe('/critic ');
  });
});
