/*
 * AnthologyAdmin — 文集管理入口壳子（Phase 4 重构产物）
 *
 * 旧实现(EntryListPanel / EntryPreviewPanel / AnthologySidePanel 等)已被
 * 统一的 ContentAdmin + page tree 取代:同一套钻入/选中/编辑骨架,
 * 由 scope='anthology' 切到文集数据源、文案、跳转。
 *
 * Phase 4 只改入口,旧组件与旧条目编辑页(./components/*, ./edit.tsx)Phase 6 一起清。
 */
import ContentAdmin from '../content';

export default function AnthologyAdmin() {
  return <ContentAdmin scope="anthology" />;
}
