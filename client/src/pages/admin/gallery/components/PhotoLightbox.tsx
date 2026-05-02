/**
 * PhotoLightbox — 图片预览弹窗（只读查看大图）。
 *
 * 基于 yet-another-react-lightbox，提供暗色遮罩 + 大图 + 左右切换 + 键盘导航。
 * 用于画廊管理预览页点击照片时查看大图。
 */

import Lightbox from 'yet-another-react-lightbox';
import 'yet-another-react-lightbox/styles.css';

interface PhotoLightboxProps {
  open: boolean;
  urls: string[];
  initialIndex: number;
  onClose: () => void;
}

export function PhotoLightbox({ open, urls, initialIndex, onClose }: PhotoLightboxProps) {
  return (
    <Lightbox
      open={open}
      close={onClose}
      index={initialIndex}
      slides={urls.map((src) => ({ src }))}
    />
  );
}
