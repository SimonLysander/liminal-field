import { ContentController } from '../content.controller';
import { ContentService } from '../content.service';
import { HomeController } from '../../home/home.controller';
import type { ContentRepository } from '../content.repository';
import type { ContentSnapshotRepository } from '../content-snapshot.repository';
import type { NavigationRepository } from '../../navigation/navigation.repository';
import type { GalleryViewService } from '../../workspace/gallery-view.service';
import type { DigestReportRepository } from '../../digest/digest-report.repository';

describe('ContentController', () => {
  let controller: ContentController;
  let contentService: jest.Mocked<ContentService>;

  beforeEach(() => {
    contentService = {
      searchContents: jest.fn(),
      searchWithScope: jest.fn(),
    } as unknown as jest.Mocked<ContentService>;

    controller = new ContentController(contentService);
  });

  it('delegates search to the service', async () => {
    const expected = [{ id: 'ci_test', title: 'Title' }];
    contentService.searchWithScope.mockResolvedValue(expected as never);

    const mockRequest = { user: { sub: 'admin' } } as any;
    const result = await controller.searchContents({ q: 'react' }, mockRequest);

    expect(result).toBe(expected);
    expect(contentService.searchWithScope).toHaveBeenCalledWith({ q: 'react' });
  });
});

/**
 * getHome 已迁移至 HomeController（/home），独立测试如下。
 * 原 ContentController 不再承载首页聚合逻辑。
 */
describe('HomeController', () => {
  let controller: HomeController;
  let contentService: jest.Mocked<ContentService>;
  let contentRepository: jest.Mocked<ContentRepository>;
  let snapshotRepository: jest.Mocked<ContentSnapshotRepository>;
  let navigationRepository: jest.Mocked<NavigationRepository>;
  let galleryViewService: jest.Mocked<GalleryViewService>;
  let digestReportRepository: jest.Mocked<DigestReportRepository>;

  beforeEach(() => {
    contentService = {
      getPublishedLatest: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<ContentService>;

    contentRepository = {
      findById: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<ContentRepository>;

    snapshotRepository = {
      findByVersionId: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<ContentSnapshotRepository>;

    navigationRepository = {
      listByScope: jest.fn().mockResolvedValue([]),
      countChildrenByParentIds: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<NavigationRepository>;

    galleryViewService = {
      listPublishedForHome: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<GalleryViewService>;

    digestReportRepository = {
      findGlobalLatest: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<DigestReportRepository>;

    controller = new HomeController(
      contentService,
      contentRepository,
      snapshotRepository,
      navigationRepository,
      galleryViewService,
      digestReportRepository,
    );
  });

  it('delegates home aggregation to contentService and galleryViewService', async () => {
    const result = await controller.getHome();

    expect(result).toHaveProperty('notes');
    expect(result).toHaveProperty('gallery');
    expect(result).toHaveProperty('anthology');
    expect(result).toHaveProperty('digest');
    expect(contentService.getPublishedLatest).toHaveBeenCalled();
    expect(galleryViewService.listPublishedForHome).toHaveBeenCalled();
    expect(digestReportRepository.findGlobalLatest).toHaveBeenCalled();
  });
});
