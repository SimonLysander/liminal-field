import { Module } from '@nestjs/common';
import { TypegooseModule } from 'nestjs-typegoose';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { ImportSessionRepository } from './import-session.repository';
import { BatchImportSessionRepository } from './batch-import-session.repository';
import { ImportSession } from './import-session.entity';
import { BatchImportSession } from './batch-import-session.entity';
import { MineruService } from './mineru.service';
import { ContentModule } from '../content/content.module';
import { NavigationModule } from '../navigation/navigation.module';

@Module({
  imports: [
    TypegooseModule.forFeature([ImportSession, BatchImportSession]),
    ContentModule,
    NavigationModule,
  ],
  controllers: [ImportController],
  providers: [
    ImportService,
    ImportSessionRepository,
    BatchImportSessionRepository,
    MineruService,
  ],
  exports: [MineruService],
})
export class ImportModule {}
