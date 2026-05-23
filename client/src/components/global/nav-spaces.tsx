/*
 * nav-spaces — 展示端导航空间的单一数据来源
 *
 * Sidebar 和 BottomTabBar 共用这套定义，防止数据漂移。
 * 值与 Sidebar.tsx 原定义完全一致（2026-05-23 抽出）。
 */

import { Home, FileText, BookOpen, Image, Sparkles, type LucideIcon } from 'lucide-react';

export type Space = 'home' | 'notes' | 'anthology' | 'gallery' | 'agent';

/** nav 实际展示的 tab（agent 不在内，与 Sidebar 现状一致） */
export const spaces: Space[] = ['home', 'notes', 'anthology', 'gallery'];

export const labels: Record<Space, string> = {
  home: '首页',
  notes: '笔记',
  anthology: '文集',
  gallery: '画廊',
  agent: '助手',
};

export const NavIcons: Record<Space, LucideIcon> = {
  home: Home,
  notes: FileText,
  anthology: BookOpen,
  gallery: Image,
  agent: Sparkles,
};

export function spaceToPath(space: Space): string {
  if (space === 'notes') return '/note';
  return `/${space}`;
}

export function pathToSpace(pathname: string): Space {
  const seg = pathname.split('/')[1];
  if (seg === 'note') return 'notes';
  if (seg === 'anthology') return 'anthology';
  if (spaces.includes(seg as Space)) return seg as Space;
  return 'notes';
}
