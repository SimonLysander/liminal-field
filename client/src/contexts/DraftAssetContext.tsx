/**
 * DraftAssetContext — 向深层组件（如 PlateJS PlaceholderElement）提供 contentItemId。
 *
 * 编辑器上传图片时需要知道当前内容的 ID 以构建上传 URL，
 * 但 PlaceholderElement 在 PlateJS 内部深处渲染，无法通过 props 传递。
 */
import { createContext, useContext } from 'react';

interface DraftAssetContextValue {
  contentItemId: string;
}

const DraftAssetContext = createContext<DraftAssetContextValue | null>(null);

export function DraftAssetProvider({
  contentItemId,
  children,
}: {
  contentItemId: string;
  children: React.ReactNode;
}) {
  return (
    <DraftAssetContext.Provider value={{ contentItemId }}>
      {children}
    </DraftAssetContext.Provider>
  );
}

export function useDraftAssetContext(): DraftAssetContextValue {
  const ctx = useContext(DraftAssetContext);
  if (!ctx) {
    throw new Error('useDraftAssetContext must be used within DraftAssetProvider');
  }
  return ctx;
}
