'use client';

import { CaptionPlugin } from '@platejs/caption/react';
import {
  FilePlugin,
  ImagePlugin,
  PlaceholderPlugin,
} from '@platejs/media/react';
import { KEYS } from 'platejs';

import { FileElement } from '@/components/ui/media-file-node';
import { ImageElement } from '@/components/ui/media-image-node';
import { PlaceholderElement } from '@/components/ui/media-placeholder-node';
import { MediaPreviewDialog } from '@/components/ui/media-preview-dialog';
import { MediaUploadToast } from '@/components/ui/media-upload-toast';

/* 只注册 image + file，不注册 video/audio/mediaEmbed（省掉 dash.js + hls.js ~1.5MB） */
export const MediaKit = [
  ImagePlugin.configure({
    options: { disableUploadInsert: true },
    render: { afterEditable: MediaPreviewDialog, node: ImageElement },
  }),
  FilePlugin.withComponent(FileElement),
  PlaceholderPlugin.configure({
    options: { disableEmptyPlaceholder: true },
    render: { afterEditable: MediaUploadToast, node: PlaceholderElement },
  }),
  CaptionPlugin.configure({
    options: {
      query: {
        allow: [KEYS.img, KEYS.file],
      },
    },
  }),
];
