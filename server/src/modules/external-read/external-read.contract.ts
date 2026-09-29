import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { externalParameterDescriptions as descriptions } from '../../prompts/external-tools';
import type { DocumentStructure } from './document-structure';

export const scopes = ['notes', 'anthology', 'gallery', 'digest'] as const;
export type LibraryScope = (typeof scopes)[number];
export const targetSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .describe(descriptions.target);
const cursorSchema = z
  .string()
  .min(1)
  .max(4096)
  .optional()
  .describe(descriptions.cursor);
const limitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .default(30)
  .describe(descriptions.limit);
export const browseQuerySchema = z
  .object({
    target: targetSchema.optional(),
    cursor: cursorSchema,
    limit: limitSchema,
  })
  .strict();
export const searchQuerySchema = z
  .object({
    query: z.string().trim().min(1).max(200).describe(descriptions.query),
    within: targetSchema.optional().describe(descriptions.within),
    cursor: cursorSchema,
    limit: limitSchema,
  })
  .strict();
export const readQuerySchema = z
  .object({
    target: targetSchema,
    sectionRef: z
      .string()
      .min(1)
      .max(4096)
      .optional()
      .describe(descriptions.sectionRef),
    cursor: cursorSchema,
    maxCharacters: z.coerce
      .number()
      .int()
      .min(1000)
      .max(60000)
      .default(12000)
      .describe(descriptions.maxCharacters),
  })
  .strict();
export const assetQuerySchema = z
  .object({
    assetRef: z.string().min(1).max(4096).describe(descriptions.assetRef),
    representation: z
      .enum(['original', 'preview', 'text'])
      .optional()
      .describe(descriptions.representation),
  })
  .strict();

export function parseQuery<T>(schema: z.ZodType<T>, query: unknown): T {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw new BadRequestException(
      `INVALID_ARGUMENT: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  }
  return result.data;
}

export type LibraryItem = z.infer<typeof libraryItemSchema>;
export type AssetDescriptor = z.infer<typeof assetDescriptorSchema>;

export interface PublicDocument {
  item: LibraryItem;
  markdown: string;
  structure: DocumentStructure;
  metadata: Record<string, string>;
  assets: Array<{
    fileName: string;
    description: string;
    metadata: Record<string, string>;
  }>;
  citations: Array<{ id: number; title: string; url: string; source: string }>;
  updatedAt: string | null;
  contentItemId?: string;
  commitHash?: string;
}

// HTTP and MCP share schemas, so transport changes cannot redefine public content.
export const libraryItemSchema = z
  .object({
    target: z.string(),
    scope: z.enum(scopes),
    kind: z.enum(['page', 'collection', 'topic', 'report']),
    title: z.string(),
    summary: z.string(),
    url: z.string(),
    parentTarget: z.string().nullable(),
    bodyAvailable: z.boolean(),
    childrenAvailable: z.boolean(),
    revision: z.string().nullable(),
  })
  .strict();
export const assetDescriptorSchema = z
  .object({
    assetRef: z.string(),
    fileName: z.string(),
    type: z.enum(['image', 'audio', 'video', 'file']),
    mediaType: z.string(),
    description: z.string(),
    metadata: z.record(z.string(), z.string()),
    representations: z.array(z.enum(['original', 'preview', 'text'])),
    url: z.string().nullable(),
  })
  .strict();
const pagination = {
  total: z.number().int().nonnegative(),
  revision: z.string(),
  nextCursor: z.string().nullable(),
};
export const browseResponseSchema = z
  .object({
    target: z.string(),
    item: libraryItemSchema.nullable(),
    breadcrumbs: z.array(libraryItemSchema),
    siteUrl: z.string(),
    items: z.array(libraryItemSchema),
    ...pagination,
  })
  .strict();
export const searchResponseSchema = z
  .object({
    query: z.string(),
    within: z.string(),
    items: z.array(libraryItemSchema.extend({ snippet: z.string() })),
    ...pagination,
  })
  .strict();
export const readResponseSchema = z
  .object({
    item: libraryItemSchema,
    metadata: z.record(z.string(), z.string()),
    breadcrumbs: z.array(libraryItemSchema),
    updatedAt: z.string().nullable(),
    bodyMarkdown: z.string().nullable(),
    sections: z.array(
      z
        .object({
          title: z.string(),
          level: z.number().int(),
          start: z.number().int(),
          end: z.number().int(),
          sectionRef: z.string(),
        })
        .strict(),
    ),
    sectionRef: z.string().nullable(),
    assets: z.array(assetDescriptorSchema),
    citations: z.array(
      z
        .object({
          id: z.number().int(),
          title: z.string(),
          url: z.string(),
          source: z.string(),
        })
        .strict(),
    ),
    totalCharacters: z.number().int(),
    start: z.number().int(),
    end: z.number().int(),
    partialBlock: z.boolean(),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const errorResponseSchema = z
  .object({
    code: z.number().int(),
    msg: z.string(),
    data: z.null(),
    error: z.object({ code: z.string() }).strict(),
  })
  .strict();
export function successSchema<T extends z.ZodType>(data: T) {
  return z.object({ code: z.literal(0), msg: z.literal('ok'), data }).strict();
}
