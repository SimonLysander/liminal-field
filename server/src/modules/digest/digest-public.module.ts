import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module';
import { NavigationModule } from '../navigation/navigation.module';
import { DigestSharedModule } from './digest-shared.module';
import { DigestPublicController } from './digest-public.controller';
import { DigestPublicService } from './digest-public.service';

/** Public reading has no dependency on the agent runtime or digest scheduler. */
@Module({
  imports: [ContentModule, NavigationModule, DigestSharedModule],
  controllers: [DigestPublicController],
  providers: [DigestPublicService],
  exports: [DigestPublicService, DigestSharedModule],
})
export class DigestPublicModule {}
