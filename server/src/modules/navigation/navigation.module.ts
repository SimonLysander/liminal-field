import { Module } from '@nestjs/common';
import { TypegooseModule } from 'nestjs-typegoose';
import { ContentModule } from '../content/content.module';
import { NavigationNode } from './navigation.entity';
import { NavigationRepository } from './navigation.repository';
import { NavigationNodeService } from './navigation.service';
import { NavigationTopologyLockService } from './navigation-topology-lock.service';

@Module({
  imports: [TypegooseModule.forFeature([NavigationNode]), ContentModule],
  providers: [
    NavigationNodeService,
    NavigationRepository,
    NavigationTopologyLockService,
  ],
  exports: [
    NavigationRepository,
    NavigationNodeService,
    NavigationTopologyLockService,
  ],
})
export class NavigationModule {}
