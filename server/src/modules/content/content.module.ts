import { Module } from '@nestjs/common';
import { TypegooseModule } from 'nestjs-typegoose';
import { ContentController } from './content.controller';
import { ContentGitService } from './content-git.service';
import { ContentItem } from './content-item.entity';
import { ContentRepoService } from './content-repo.service';
import { ContentRepository } from './content.repository';
import { ContentService } from './content.service';

@Module({
  imports: [TypegooseModule.forFeature([ContentItem])],
  controllers: [ContentController],
  providers: [
    ContentRepository,
    ContentRepoService,
    ContentGitService,
    ContentService,
  ],
  exports: [
    ContentRepository,
    ContentRepoService,
    ContentGitService,
    ContentService,
  ],
})
export class ContentModule {}
