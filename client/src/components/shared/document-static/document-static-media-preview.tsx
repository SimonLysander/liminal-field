import * as React from 'react';

import type { TElement } from 'platejs';

const LazyImageLightbox = React.lazy(() =>
  import('@/components/shared/ImageLightbox').then(({ ImageLightbox }) => ({
    default: ImageLightbox,
  })),
);

type ImageSource = {
  path: number[];
  url: string;
};

function collectImageSources(nodes: TElement[], parentPath: number[] = []): ImageSource[] {
  const images: ImageSource[] = [];

  for (const [index, node] of nodes.entries()) {
    const path = [...parentPath, index];
    if (node.type === 'img' && typeof node.url === 'string' && node.url.length > 0) {
      images.push({ path, url: node.url });
    }

    if (Array.isArray(node.children)) {
      images.push(...collectImageSources(node.children as TElement[], path));
    }
  }

  return images;
}

export function StaticMediaPreview({
  alt,
  className,
  imagePath,
  url,
  value,
}: {
  alt: string;
  className: string;
  imagePath: number[];
  url: string;
  value: TElement[];
}) {
  const [open, setOpen] = React.useState(false);
  const images = React.useMemo(() => collectImageSources(value), [value]);
  const initialIndex = images.findIndex(
    (image) => image.path.length === imagePath.length && image.path.every((value, index) => value === imagePath[index]),
  );

  return (
    <>
      <button aria-label={`预览 ${alt}`} onClick={() => setOpen(true)} type="button">
        <img alt={alt} className={className} src={url} />
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
