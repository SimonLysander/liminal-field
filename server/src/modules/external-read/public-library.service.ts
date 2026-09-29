import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ContentRepository,
  type PublicContentHead,
} from '../content/content.repository';
import { ContentSnapshotRepository } from '../content/content-snapshot.repository';
import { NavigationRepository } from '../navigation/navigation.repository';
import {
  NavigationScope,
  type NavigationNode,
} from '../navigation/navigation.entity';
import { DigestPublicService } from '../digest/digest-public.service';
import { DigestReportRepository } from '../digest/digest-report.repository';
import {
  parseAnthologyIndex,
  parseEntryContent,
} from '../workspace/anthology-view.service';
import { parseGalleryContent } from '../workspace/gallery-view.service';
import { stripNoteFrontmatter } from '../workspace/note-view.service';
import { documentStructure, isAssetName } from './document-structure';
import { resolveTarget, type LibraryTarget } from './external-target';
import { revisionOf } from './external-reference.service';
import type {
  LibraryItem,
  LibraryScope,
  PublicDocument,
} from './external-read.contract';

interface CatalogRecord {
  item: LibraryItem;
  node?: NavigationNode;
  head?: PublicContentHead;
  topicId?: string;
  reportId?: string;
}
export interface PublicCatalog {
  records: Map<string, CatalogRecord>;
  nodes: Map<string, CatalogRecord>;
}

@Injectable()
export class PublicLibraryService {
  private readonly logger = new Logger(PublicLibraryService.name);

  constructor(
    private readonly navigation: NavigationRepository,
    private readonly content: ContentRepository,
    private readonly snapshots: ContentSnapshotRepository,
    private readonly digest: DigestPublicService,
    private readonly reports: DigestReportRepository,
  ) {}

  /** Metadata-only bulk reads avoid a recursive database request for every note descendant. */
  async catalog(): Promise<PublicCatalog> {
    const startedAt = Date.now();
    const allNodes = await this.navigation.listAll();
    const nodes = allNodes.filter((node) =>
      ['notes', 'anthology', 'gallery'].includes(node.scope),
    );
    const heads = new Map(
      (
        await this.content.findPublicHeads(
          nodes.map((node) => node.contentItemId),
        )
      ).map((head) => [head._id, head]),
    );
    const byId = new Map(nodes.map((node) => [node._id.toString(), node]));
    const visible = new Set<string>();
    for (const node of nodes) {
      if (!heads.get(node.contentItemId)?.publishedVersion?.versionId) continue;
      const chain: NavigationNode[] = [];
      const seen = new Set<string>();
      let cursor: NavigationNode | undefined = node;
      while (cursor && !seen.has(cursor._id.toString())) {
        seen.add(cursor._id.toString());
        chain.push(cursor);
        cursor = cursor.parentId
          ? byId.get(cursor.parentId.toString())
          : undefined;
      }
      // Corrupt or cross-scope topology must not create a new public path.
      if (
        cursor ||
        chain.at(-1)?.parentId ||
        chain.some((ancestor) => ancestor.scope !== node.scope)
      )
        continue;
      if (
        node.scope === NavigationScope.anthology &&
        chain.some(
          (ancestor) =>
            !heads.get(ancestor.contentItemId)?.publishedVersion?.versionId,
        )
      )
        continue;
      for (const ancestor of node.scope === NavigationScope.notes
        ? chain
        : [node])
        visible.add(ancestor._id.toString());
    }
    const records = new Map<string, CatalogRecord>();
    const nodeRecords = new Map<string, CatalogRecord>();
    for (const node of nodes.filter((candidate) =>
      visible.has(candidate._id.toString()),
    )) {
      const head = heads.get(node.contentItemId);
      const version = head?.publishedVersion;
      const scope = node.scope as LibraryScope;
      const parent = node.parentId
        ? byId.get(node.parentId.toString())
        : undefined;
      const target = `${scope}:${node.contentItemId}`;
      const item: LibraryItem = {
        target,
        scope,
        kind: scope === 'anthology' && !parent ? 'collection' : 'page',
        title: version?.title ?? node.name,
        summary: version?.summary ?? '',
        url:
          scope === 'notes'
            ? `/note?node=${node.contentItemId}`
            : scope === 'gallery'
              ? `/gallery?post=${node.contentItemId}`
              : parent
                ? `/anthology?at=${parent.contentItemId}&node=${node.contentItemId}`
                : `/anthology?node=${node.contentItemId}`,
        parentTarget:
          parent && visible.has(parent._id.toString())
            ? `${scope}:${parent.contentItemId}`
            : null,
        bodyAvailable: !!version?.versionId,
        childrenAvailable: false,
        revision: version?.versionId
          ? revisionOf([
              target,
              version.versionId,
              version.title,
              version.summary,
            ])
          : null,
      };
      if (!item.bodyAvailable) item.url = `/note?at=${node._id.toString()}`;
      const record = { item, node, head };
      records.set(target, record);
      nodeRecords.set(node._id.toString(), record);
    }
    for (const record of records.values()) {
      const parent =
        record.item.parentTarget && records.get(record.item.parentTarget);
      if (parent) parent.item.childrenAvailable = true;
    }
    const topics = await this.digest.listTopicHeaders();
    for (const topic of topics) {
      const target = `digest:${topic.id}`;
      records.set(target, {
        item: {
          target,
          scope: 'digest',
          kind: 'topic',
          title: topic.name,
          summary: topic.description,
          url: `/digest/${topic.id}`,
          parentTarget: null,
          bodyAvailable: false,
          childrenAvailable: false,
          revision: null,
        },
        topicId: topic.id,
      });
    }
    const summaries = await this.reports.listPublicSummaries(
      topics.map((topic) => topic.id),
    );
    for (const report of summaries) {
      const parentTarget = `digest:${report.topicId}`;
      const parent = records.get(parentTarget);
      if (!parent) continue;
      parent.item.childrenAvailable = true;
      const target = `report:${report.topicId}:${report._id}`;
      records.set(target, {
        item: {
          target,
          scope: 'digest',
          kind: 'report',
          title: report.headline,
          summary: report.deck,
          url: `/digest/${report.topicId}/${report._id}`,
          parentTarget,
          bodyAvailable: true,
          childrenAvailable: false,
          revision: revisionOf([
            target,
            report.publishedAt.toISOString(),
            report.headline,
            report.deck,
          ]),
        },
        topicId: report.topicId,
        reportId: report._id,
      });
    }
    this.logger.debug({
      event: 'catalog_loaded',
      nodes: nodes.length,
      visible: records.size,
      durationMs: Date.now() - startedAt,
    });
    return { records, nodes: nodeRecords };
  }

  select(catalog: PublicCatalog, target: LibraryTarget): CatalogRecord {
    const record =
      target.kind === 'node'
        ? catalog.nodes.get(target.id)
        : catalog.records.get(target.target);
    if (!record) throw new NotFoundException('RESOURCE_NOT_FOUND');
    if (
      target.kind === 'content' &&
      target.parentId &&
      record.item.parentTarget !== `${target.scope}:${target.parentId}`
    )
      throw new NotFoundException('RESOURCE_NOT_FOUND');
    return record;
  }

  children(catalog: PublicCatalog, target: LibraryTarget): LibraryItem[] {
    let items = [...catalog.records.values()].map((record) => record.item);
    if (target.kind === 'root') return [];
    if (target.kind === 'scope')
      items = items.filter(
        (item) => item.scope === target.scope && !item.parentTarget,
      );
    else {
      const record = this.select(catalog, target);
      items = items.filter((item) => item.parentTarget === record.item.target);
    }
    return items;
  }

  within(catalog: PublicCatalog, target: LibraryTarget): CatalogRecord[] {
    if (target.kind === 'root') return [...catalog.records.values()];
    if (target.kind === 'scope')
      return [...catalog.records.values()].filter(
        (record) => record.item.scope === target.scope,
      );
    const root = this.select(catalog, target);
    const included = new Set([root.item.target]);
    const children = new Map<string, string[]>();
    for (const record of catalog.records.values()) {
      if (record.item.parentTarget) {
        const refs = children.get(record.item.parentTarget) ?? [];
        refs.push(record.item.target);
        children.set(record.item.parentTarget, refs);
      }
    }
    for (const ref of included)
      for (const child of children.get(ref) ?? []) included.add(child);
    return [...catalog.records.values()].filter((record) =>
      included.has(record.item.target),
    );
  }

  async search(catalog: PublicCatalog, target: LibraryTarget, query: string) {
    const records = this.within(catalog, target);
    const snapshotHits = await this.snapshots.searchPublishedSnapshots(
      records.flatMap((record) =>
        record.head?.publishedVersion?.versionId
          ? [record.head.publishedVersion.versionId]
          : [],
      ),
      query,
    );
    const reportHits = await this.reports.searchPublicReports(
      records.flatMap((record) => (record.reportId ? [record.reportId] : [])),
      query,
    );
    const owners = new Map(
      records.map((record) => [
        record.head?.publishedVersion?.versionId,
        record.node?.contentItemId,
      ]),
    );
    const snippets = new Map([
      ...snapshotHits
        .filter((hit) => owners.get(hit.versionId) === hit.contentItemId)
        .map((hit) => [hit.versionId, hit.snippet] as const),
      ...reportHits.map((hit) => [hit.id, hit.snippet] as const),
    ]);
    const keyword = query.toLocaleLowerCase();
    return records.flatMap((record) => {
      const key =
        record.reportId ?? record.head?.publishedVersion?.versionId ?? '';
      const snippet = snippets.get(key);
      const metadataMatch = `${record.item.title}\n${record.item.summary}`
        .toLocaleLowerCase()
        .includes(keyword);
      return snippet !== undefined || metadataMatch
        ? [{ ...record.item, snippet: snippet ?? record.item.summary }]
        : [];
    });
  }

  async document(
    catalog: PublicCatalog,
    target: LibraryTarget,
  ): Promise<PublicDocument> {
    if (target.kind === 'root' || target.kind === 'scope')
      throw new BadRequestException('CONTENT_TARGET_REQUIRED');
    let record =
      target.kind === 'node'
        ? catalog.nodes.get(target.id)
        : catalog.records.get(target.target);
    // A report URL remains public even when its period has a newer report. It is a
    // distinct publication, not access to a ContentSnapshot history endpoint.
    if (
      !record &&
      target.kind === 'report' &&
      catalog.records.has(`digest:${target.topicId}`)
    ) {
      const report = await this.reports.findById(target.id);
      if (!report || report.topicId !== target.topicId)
        throw new NotFoundException('RESOURCE_NOT_FOUND');
      record = {
        item: {
          target: target.target,
          scope: 'digest',
          kind: 'report',
          title: report.headline,
          summary: report.deck,
          url: `/digest/${target.topicId}/${target.id}`,
          parentTarget: `digest:${target.topicId}`,
          bodyAvailable: true,
          childrenAvailable: false,
          revision: revisionOf([
            target.target,
            report.publishedAt,
            report.headline,
            report.deck,
          ]),
        },
        topicId: target.topicId,
        reportId: target.id,
      };
    }
    if (!record) throw new NotFoundException('RESOURCE_NOT_FOUND');
    if (target.kind === 'content' && target.parentId)
      this.select(catalog, target);
    if (!record.item.bodyAvailable)
      return {
        item: record.item,
        markdown: '',
        structure: { sections: [], boundaries: [0], assets: [] },
        metadata: {},
        assets: [],
        citations: [],
        updatedAt: null,
      };
    if (record.reportId && record.topicId) {
      const report = await this.reports.findById(record.reportId);
      if (!report || report.topicId !== record.topicId)
        throw new NotFoundException('RESOURCE_NOT_FOUND');
      const markdown = report.markdown;
      const citations = report.findings.map((finding) => ({
        id: finding.citationId,
        title: finding.title,
        url: finding.url,
        source: finding.sourceName,
      }));
      return {
        item: {
          ...record.item,
          revision: revisionOf([record.item.revision, markdown, citations]),
        },
        markdown,
        structure: documentStructure(markdown),
        metadata: {},
        assets: [],
        citations,
        updatedAt: report.publishedAt.toISOString(),
      };
    }
    const versionId = record.head?.publishedVersion?.versionId;
    const snapshot = versionId
      ? await this.snapshots.findByVersionId(versionId)
      : null;
    if (
      !snapshot ||
      snapshot.contentItemId !== record.node?.contentItemId ||
      (snapshot.fileName ?? null) !== null
    )
      throw new NotFoundException('RESOURCE_NOT_FOUND');
    let markdown: string;
    const metadata: Record<string, string> = {};
    let assets: PublicDocument['assets'] = [];
    if (record.item.scope === 'notes')
      markdown = stripNoteFrontmatter(snapshot.bodyMarkdown).body;
    else if (record.item.scope === 'anthology') {
      if (record.item.kind === 'collection')
        markdown = parseAnthologyIndex(snapshot.bodyMarkdown).body;
      else {
        const parsed = parseEntryContent(snapshot.bodyMarkdown);
        markdown = parsed.bodyMarkdown;
        if (parsed.date) metadata.date = parsed.date;
      }
    } else {
      const parsed = parseGalleryContent(snapshot.bodyMarkdown);
      if (parsed.date) metadata.date = parsed.date;
      if (parsed.location) metadata.location = parsed.location;
      assets = parsed.photos
        .filter((photo) => isAssetName(photo.file))
        .map((photo) => ({
          fileName: photo.file,
          description: photo.caption,
          metadata: photo.tags,
        }));
      // The image order and captions come from the published gallery frontmatter.
      markdown = [
        parsed.prose,
        ...assets.map(
          (asset) =>
            `![${asset.description.replace(/[[\]\\\n]/g, ' ')}](./assets/${encodeURIComponent(asset.fileName)})`,
        ),
      ]
        .filter(Boolean)
        .join('\n\n');
    }
    const structure = documentStructure(markdown);
    const unique = new Map(assets.map((asset) => [asset.fileName, asset]));
    for (const asset of structure.assets)
      if (!unique.has(asset.fileName))
        unique.set(asset.fileName, { ...asset, metadata: {} });
    this.logger.debug({
      event: 'document_loaded',
      scope: record.item.scope,
      contentItemId: snapshot.contentItemId,
      versionId,
      characters: markdown.length,
    });
    return {
      item: record.item,
      markdown,
      structure,
      metadata,
      assets: [...unique.values()],
      citations: [],
      updatedAt: snapshot.createdAt.toISOString(),
      contentItemId: snapshot.contentItemId,
      commitHash: snapshot.commitHash,
    };
  }

  async currentDocument(target: string): Promise<PublicDocument> {
    return this.document(await this.catalog(), resolveTarget(target));
  }
}
