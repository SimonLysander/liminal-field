/**
 * SkillService 单测 — CRUD 主路径 + 重名/404 异常路径。
 *
 * 与项目内 *.service.spec.ts 风格对齐:直接 new SkillService + cast mock,不上 Test.createTestingModule
 * (CRUD service 没有装配复杂度,DI 模拟反而冗余)。
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SkillService } from './skill.service';
import type { SkillRepository } from './skill.repository';

function createMocks() {
  const mockRepo: jest.Mocked<SkillRepository> = {
    findAll: jest.fn(),
    findById: jest.fn(),
    findByName: jest.fn(),
    findByIds: jest.fn(),
    create: jest.fn(),
    updateById: jest.fn(),
    deleteById: jest.fn(),
  } as unknown as jest.Mocked<SkillRepository>;

  const mockEventBus = {
    emit: jest.fn(),
  } as unknown as jest.Mocked<EventEmitter2>;

  const service = new SkillService(mockRepo, mockEventBus);

  return { service, mockRepo, mockEventBus };
}

describe('SkillService', () => {
  describe('create', () => {
    it('name 重名 → 抛 ConflictException(409)', async () => {
      const { service, mockRepo } = createMocks();
      mockRepo.findByName.mockResolvedValue({ name: 'critic' } as never);

      await expect(
        service.create({
          name: 'critic',
          displayName: '批评家',
          description: 'x',
          whenToUse: 'x',
          body: 'x',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('name 不重复 → 正常创建', async () => {
      const { service, mockRepo } = createMocks();
      mockRepo.findByName.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue({ _id: 'a1', name: 'critic' } as never);

      const result = await service.create({
        name: 'critic',
        displayName: '批评家',
        description: 'x',
        whenToUse: 'x',
        body: 'x',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'critic' }),
      );
      expect(result).toEqual(expect.objectContaining({ _id: 'a1' }));
    });
  });

  describe('update', () => {
    it('找不到 skill → 抛 NotFoundException(404)', async () => {
      const { service, mockRepo } = createMocks();
      mockRepo.updateById.mockResolvedValue(null);

      await expect(
        service.update('nope', { description: 'new' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('改 name 时撞别的 skill → 抛 ConflictException', async () => {
      const { service, mockRepo } = createMocks();
      // 别的 skill 已用 'polish'(id 不同)
      mockRepo.findByName.mockResolvedValue({
        _id: 'other-id',
        name: 'polish',
      } as never);

      await expect(
        service.update('this-id', { name: 'polish' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('改 name 时撞自己的 name → 通过(同 id)', async () => {
      const { service, mockRepo } = createMocks();
      mockRepo.findByName.mockResolvedValue({
        _id: 'this-id',
        name: 'polish',
      } as never);
      mockRepo.updateById.mockResolvedValue({
        _id: 'this-id',
        name: 'polish',
      } as never);

      await expect(
        service.update('this-id', { name: 'polish' }),
      ).resolves.toBeDefined();
    });
  });

  describe('delete', () => {
    it('找不到 skill → 不抛(幂等)', async () => {
      const { service, mockRepo } = createMocks();
      mockRepo.deleteById.mockResolvedValue(undefined);

      await expect(service.delete('any')).resolves.toBeUndefined();
    });

    it('删除后发 skill.deleted 事件(级联清理 agent.enabledSkillIds 在 Task 0.6 接)', async () => {
      const { service, mockRepo, mockEventBus } = createMocks();
      mockRepo.deleteById.mockResolvedValue(undefined);

      await service.delete('sk1');

      expect(mockEventBus.emit).toHaveBeenCalledWith('skill.deleted', {
        skillId: 'sk1',
      });
    });
  });
});
