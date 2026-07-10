import * as React from 'react';

import type { TElement } from 'platejs';

const LazyImageLightbox = React.lazy(() =>
  import('@/components/shared/ImageLightbox').then(({ ImageLightbox }) => ({
    default: ImageLightbox,
  })),
);

type ImageSource = {
  url: string;
};

function collectImageSources(nodes: TElement[]): ImageSource[] {
  const images: ImageSource[] = [];

  for (const node of nodes) {
    if (node.type === 'img' && typeof node.url === 'string' && node.url.length > 0) {
      images.push({ url: node.url });
    }

    if (Array.isArray(node.children)) {
      images.push(...collectImageSources(node.children as TElement[]));
    }
  }

  return images;
}

export function StaticMediaPreview({
  alt,
  className,
  element,
  value,
}: {
  alt: string;
  className: string;
  element: TElement;
  value: TElement[];
}) {
  const [open, setOpen] = React.useState(false);
  const images = React.useMemo(() => collectImageSources(value), [value]);
  const initialIndex = images.findIndex((image) => image.url === element.url);

  if (typeof element.url !== 'string' || element.url.length === 0) return null;

  return (
    <>
      <button aria-label={`预览 ${alt}`} onClick={() => setOpen(true)} type="button">
        <img alt={alt} className={className} src={element.url} />
      </button>
      {open && initialIndex >= 0 && (
        <React.Suspense fallback={null}>
          <LazyImageLightbox
            initialIndex={initialIndex}
            onClose={() => setOpen(false)}
            open={open}
            urls={images.map((image) => image.url)}
          />
        </React.Suspense>
      )}
    </>
  );
}
