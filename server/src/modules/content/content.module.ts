import { Module } from '@nestjs/common';
import { TypegooseModule } from 'nestjs-typegoose';
import { ContentController } from './content.controller';
import { ContentGitService } from './content-git.service';
import { ContentItem } from './content-item.entity';
import { ContentSnapshot } from './content-snapshot.entity';
import { ContentRepoService } from './content-repo.service';
import { ContentRepository } from './content.repository';
import { ContentSnapshotRepository } from './content-snapshot.repository';
import { ContentService } from './content.service';

@Module({
  imports: [TypegooseModule.forFeature([ContentItem, ContentSnapshot])],
  controllers: [ContentController],
  providers: [
    ContentRepository,
    ContentSnapshotRepository,
    ContentRepoService,
    ContentGitService,
    ContentService,
  ],
  exports: [
    ContentRepository,
    ContentSnapshotRepository,
    ContentRepoService,
    ContentGitService,
    ContentService,
  ],
})
export class ContentModule {}
