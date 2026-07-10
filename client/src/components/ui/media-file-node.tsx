'use client';

import type { TFileElement } from 'platejs';
import type { PlateElementProps } from 'platejs/react';

import { useMediaState } from '@platejs/media/react';
import { ResizableProvider } from '@platejs/resizable';
import { FileUp } from 'lucide-react';
import { PlateElement, useReadOnly, withHOC } from 'platejs/react';

import {
  mediaFileCaptionClassName,
  mediaFileContentClassName,
  mediaFileElementClassName,
  mediaFileIconClassName,
  mediaFileLinkClassName,
} from '@/components/shared/document-static/document-node-styles';
import { Caption, CaptionTextarea } from './caption';

export const FileElement = withHOC(
  ResizableProvider,
  function FileElement(props: PlateElementProps<TFileElement>) {
    const readOnly = useReadOnly();
    const { name, unsafeUrl } = useMediaState();

    return (
      <PlateElement className={mediaFileElementClassName} {...props}>
        <a
          className={mediaFileLinkClassName}
          contentEditable={false}
          download={name}
          href={unsafeUrl}
          rel="noopener noreferrer"
          role="button"
          target="_blank"
        >
          <div className={mediaFileContentClassName}>
            <FileUp className={mediaFileIconClassName} />
            <div>{name}</div>
          </div>

          <Caption align="left">
            <CaptionTextarea
              className={mediaFileCaptionClassName}
              readOnly={readOnly}
              placeholder="说明（可选）"
            />
          </Caption>
        </a>
        {props.children}
      </PlateElement>
    );
  }
);
