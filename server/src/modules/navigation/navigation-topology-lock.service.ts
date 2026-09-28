import { Injectable } from '@nestjs/common';
import { Mutex } from 'async-mutex';

/**
 * 串行化会改变“活动学习根与导航树关系”的操作。
 *
 * 当前生产部署只有一个 server 实例，因此进程内互斥可以覆盖开始/放弃学习、
 * 审批写入、新建节点、移动和删除之间的竞争。若未来扩展为多实例，必须将这里替换为分布式锁，
 * 调用方不应各自增加局部锁。
 */
@Injectable()
export class NavigationTopologyLockService {
  private readonly mutex = new Mutex();

  runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    return this.mutex.runExclusive(operation);
  }
}
