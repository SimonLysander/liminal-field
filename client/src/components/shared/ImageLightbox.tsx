import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';

export interface ImageLightboxProps {
  initialIndex: number;
  onClose: () => void;
  open: boolean;
  urls: string[];
}

export function ImageLightbox({ initialIndex, onClose, open, urls }: ImageLightboxProps) {
  return (
    <Lightbox
      close={onClose}
      index={initialIndex}
      open={open}
      plugins={[Zoom]}
      slides={urls.map((src) => ({ src }))}
      styles={{
        container: { backgroundColor: 'rgba(0, 0, 0, 0.85)' },
      }}
      zoom={{ scrollToZoom: true }}
    />
  );
}
