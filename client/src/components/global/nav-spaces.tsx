/*
 * nav-spaces — 展示端导航空间的单一数据来源
 *
 * Sidebar 和 BottomTabBar 共用这套定义，防止数据漂移。
 * 值与 Sidebar.tsx 原定义完全一致（2026-05-23 抽出）。
 */

import { Home, FileText, BookOpen, Image, Sparkles, type LucideIcon } from 'lucide-react';

export type Space = 'home' | 'notes' | 'anthology' | 'gallery' | 'digest';

/** nav 实际展示的 tab（Aurora 只在管理端编辑器里，展示端/访客端不暴露） */
export const spaces: Space[] = ['home', 'notes', 'anthology', 'gallery', 'digest'];

export const labels: Record<Space, string> = {
  home: '首页',
  notes: '笔记',
  anthology: '文集',
  gallery: '画廊',
  digest: '精选',
};

export const NavIcons: Record<Space, LucideIcon> = {
  home: Home,
  notes: FileText,
  anthology: BookOpen,
  gallery: Image,
  digest: Sparkles,
};

export function spaceToPath(space: Space): string {
  if (space === 'notes') return '/note';
  return `/${space}`;
}

export function pathToSpace(pathname: string): Space {
  const seg = pathname.split('/')[1];
  if (seg === 'note') return 'notes';
  if (seg === 'anthology') return 'anthology';
  if (seg === 'digest') return 'digest';
  if (spaces.includes(seg as Space)) return seg as Space;
  return 'notes';
}
