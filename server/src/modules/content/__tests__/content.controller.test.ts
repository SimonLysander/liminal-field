import { ContentController } from '../content.controller';
import { ContentService } from '../content.service';
import { HomeController } from '../../home/home.controller';
import type { ContentSnapshotRepository } from '../content-snapshot.repository';
import type { NavigationRepository } from '../../navigation/navigation.repository';
import type { GalleryViewService } from '../../workspace/gallery-view.service';

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
  let snapshotRepository: jest.Mocked<ContentSnapshotRepository>;
  let navigationRepository: jest.Mocked<NavigationRepository>;
  let galleryViewService: jest.Mocked<GalleryViewService>;

  beforeEach(() => {
    contentService = {
      getPublishedLatest: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<ContentService>;

    snapshotRepository = {
      findByVersionId: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<ContentSnapshotRepository>;

    navigationRepository = {
      listByScope: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<NavigationRepository>;

    galleryViewService = {
      listPublishedForHome: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<GalleryViewService>;

    controller = new HomeController(
      contentService,
      snapshotRepository,
      navigationRepository,
      galleryViewService,
    );
  });

  it('delegates home aggregation to contentService and galleryViewService', async () => {
    const result = await controller.getHome();

    expect(result).toHaveProperty('notes');
    expect(result).toHaveProperty('gallery');
    expect(contentService.getPublishedLatest).toHaveBeenCalled();
    expect(galleryViewService.listPublishedForHome).toHaveBeenCalled();
  });
});
