import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  PublicLibraryService,
  type PublicCatalog,
} from './public-library.service';
import { ExternalAssetsService } from './external-assets.service';
import { ExternalReferenceService } from './external-reference.service';
import { markdownPage } from './document-structure';
import { resolveTarget, siteUrl } from './external-target';
import {
  browseQuerySchema,
  browseResponseSchema,
  readQuerySchema,
  readResponseSchema,
  scopes,
  searchQuerySchema,
  searchResponseSchema,
  type LibraryItem,
} from './external-read.contract';

const areaNames = {
  notes: '笔记',
  anthology: '文集',
  gallery: '画廊',
  digest: '简报',
};
const areaPaths = {
  notes: '/note',
  anthology: '/anthology',
  gallery: '/gallery',
  digest: '/digest',
};

@Injectable()
export class ExternalReadService {
  private readonly logger = new Logger(ExternalReadService.name);
  constructor(
    private readonly library: PublicLibraryService,
    private readonly references: ExternalReferenceService,
    private readonly assets: ExternalAssetsService,
  ) {}

  private breadcrumbs(
    catalog: PublicCatalog,
    item: LibraryItem,
  ): LibraryItem[] {
    const result: LibraryItem[] = [];
    const seen = new Set<string>();
    let parent = item.parentTarget;
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const record = catalog.records.get(parent);
      if (!record) break;
      result.unshift(record.item);
      parent = record.item.parentTarget;
    }
    return result;
  }

  async browse(
    query: z.infer<typeof browseQuerySchema>,
  ): Promise<z.infer<typeof browseResponseSchema>> {
    const target = resolveTarget(query.target);
    const catalog = await this.library.catalog();
    const item =
      target.kind === 'root' || target.kind === 'scope'
        ? null
        : this.library.select(catalog, target).item;
    const items: LibraryItem[] =
      target.kind === 'root'
        ? scopes.map((scope) => ({
            target: scope,
            scope,
            title: areaNames[scope],
            summary: '',
            url: areaPaths[scope],
            kind: 'collection',
            parentTarget: null,
            bodyAvailable: false,
            childrenAvailable: [...catalog.records.values()].some(
              (record) => record.item.scope === scope,
            ),
            revision: null,
          }))
        : this.library.children(catalog, target);
    const canonical = item?.target ?? target.target;
    return {
      target: canonical,
      item,
      breadcrumbs: item ? this.breadcrumbs(catalog, item) : [],
      siteUrl: siteUrl(),
      ...this.references.page(
        items,
        query.limit,
        query.cursor,
        `browse:${canonical}`,
      ),
    };
  }

  async search(
    query: z.infer<typeof searchQuerySchema>,
  ): Promise<z.infer<typeof searchResponseSchema>> {
    const target = resolveTarget(query.within);
    const catalog = await this.library.catalog();
    const canonical =
      target.kind === 'node'
        ? this.library.select(catalog, target).item.target
        : target.target;
    const hits = await this.library.search(catalog, target, query.query);
    this.logger.debug({
      event: 'search_completed',
      within: canonical,
      queryLength: query.query.length,
      hits: hits.length,
    });
    return {
      query: query.query,
      within: canonical,
      ...this.references.page(
        hits,
        query.limit,
        query.cursor,
        `search:${canonical}:${query.query}`,
      ),
    };
  }

  async read(
    query: z.infer<typeof readQuerySchema>,
  ): Promise<z.infer<typeof readResponseSchema>> {
    const catalog = await this.library.catalog();
    const document = await this.library.document(
      catalog,
      resolveTarget(query.target),
    );
    const { item } = document;
    const sections = item.revision
      ? document.structure.sections.map((section, index) => ({
          ...section,
          sectionRef: this.references.encode({
            kind: 'section',
            target: item.target,
            revision: item.revision!,
            index,
          }),
        }))
      : [];
    let markdown = document.markdown;
    let boundaries = document.structure.boundaries;
    let index: number | null = null;
    if (query.sectionRef) {
      const ref = this.references.decode(query.sectionRef);
      if (
        ref.kind !== 'section' ||
        ref.target !== item.target ||
        !item.revision
      )
        throw new BadRequestException('INVALID_SECTION');
      this.references.assertRevision(ref.revision, item.revision);
      const section = sections[ref.index];
      if (!section) throw new BadRequestException('INVALID_SECTION');
      index = ref.index;
      markdown = markdown.slice(section.start, section.end);
      // Keep offsets relative to the selected section without reparsing its body.
      boundaries = [
        ...boundaries
          .filter((end) => end > section.start && end < section.end)
          .map((end) => end - section.start),
        markdown.length,
      ];
    }
    const context = `content:${item.target}:${index ?? 'all'}`;
    if (query.cursor && !item.revision)
      throw new BadRequestException('INVALID_CURSOR');
    const offset = this.references.offset(
      query.cursor,
      context,
      item.revision ?? '',
    );
    if (offset > markdown.length)
      throw new BadRequestException('INVALID_CURSOR');
    const page = markdownPage(
      markdown,
      offset,
      query.maxCharacters,
      boundaries,
    );
    // Descriptors stay document-wide: a page may split a long HTML/media block.
    return {
      item,
      metadata: document.metadata,
      breadcrumbs: this.breadcrumbs(catalog, item),
      updatedAt: document.updatedAt,
      bodyMarkdown: item.bodyAvailable ? page.markdown : null,
      sections,
      sectionRef: query.sectionRef ?? null,
      assets: this.assets.describe(document),
      citations: document.citations,
      totalCharacters: markdown.length,
      start: offset,
      end: page.end,
      partialBlock: page.partialBlock,
      nextCursor:
        page.end < markdown.length && item.revision
          ? this.references.encode({
              kind: 'cursor',
              context,
              revision: item.revision,
              offset: page.end,
            })
          : null,
    };
  }
}
