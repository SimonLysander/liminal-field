import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { ContentModule } from '../content/content.module';
import { NavigationModule } from '../navigation/navigation.module';

@Module({
  imports: [ContentModule, NavigationModule],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
