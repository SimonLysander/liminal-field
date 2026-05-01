import { Module } from '@nestjs/common';
import { TypegooseModule } from 'nestjs-typegoose';
import { ContentModule } from '../content/content.module';
import { NavigationNode } from './navigation.entity';
import { NavigationRepository } from './navigation.repository';
import { NavigationNodeService } from './navigation.service';
import { NavigationNodeController } from './navigation.controller';

@Module({
  imports: [TypegooseModule.forFeature([NavigationNode]), ContentModule],
  controllers: [NavigationNodeController],
  providers: [NavigationNodeService, NavigationRepository],
  exports: [NavigationRepository],
})
export class NavigationModule {}
