/**
 * PhotoLightbox — 图片预览弹窗（只读查看大图）。
 *
 * 公共 ImageLightbox 保留遮罩、大图、左右切换与键盘导航；本组件只适配画廊数据。
 */

import { ImageLightbox } from '@/components/shared/ImageLightbox';

interface PhotoLightboxProps {
  open: boolean;
  urls: string[];
  initialIndex: number;
  onClose: () => void;
}

export function PhotoLightbox({ open, urls, initialIndex, onClose }: PhotoLightboxProps) {
  return <ImageLightbox initialIndex={initialIndex} onClose={onClose} open={open} urls={urls} />;
}
