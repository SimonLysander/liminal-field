/**
 * PhotoLightbox — 图片预览弹窗（只读查看大图）。
 *
 * 基于 yet-another-react-lightbox，提供遮罩 + 大图 + 左右切换 + 键盘导航。
 * 通过 CSS 变量覆盖默认纯黑背景，使其跟随主题。
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
      styles={{
        container: { backgroundColor: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(12px)' },
      }}
    />
  );
}
