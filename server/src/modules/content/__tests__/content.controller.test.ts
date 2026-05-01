import { ContentController } from '../content.controller';
import { ContentService } from '../content.service';

describe('ContentController', () => {
  let controller: ContentController;
  let contentService: jest.Mocked<ContentService>;

  beforeEach(() => {
    contentService = {
      searchContents: jest.fn(),
      getHome: jest.fn(),
    } as unknown as jest.Mocked<ContentService>;

    controller = new ContentController(contentService);
  });

  it('delegates search to the service', async () => {
    const expected = [{ id: 'ci_test', title: 'Title' }];
    contentService.searchContents.mockResolvedValue(expected as never);

    const mockRequest = { user: { sub: 'admin' } } as any;
    const result = await controller.searchContents({ q: 'react' }, mockRequest);

    expect(result).toBe(expected);
    expect(contentService.searchContents).toHaveBeenCalledWith({ q: 'react' });
  });

  it('delegates home aggregation to the service', async () => {
    const expected = { hero: null, featured: [], latest: [] };
    contentService.getHome.mockResolvedValue(expected as never);

    const result = await controller.getHome();

    expect(result).toBe(expected);
    expect(contentService.getHome).toHaveBeenCalled();
  });
});
