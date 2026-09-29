import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module';
import { NavigationModule } from '../navigation/navigation.module';
import { DigestPublicModule } from '../digest/digest-public.module';
import { OssModule } from '../oss/oss.module';
import { ExternalReadController } from './external-read.controller';
import { PublicLibraryService } from './public-library.service';
import { ExternalReferenceService } from './external-reference.service';
import { ExternalAssetsService } from './external-assets.service';
import { ExternalReadService } from './external-read.service';
import { ExternalMcpController } from './external-mcp.controller';
import { ExternalMcpService } from './external-mcp.service';

@Module({
  imports: [ContentModule, NavigationModule, DigestPublicModule, OssModule],
  controllers: [ExternalReadController, ExternalMcpController],
  providers: [
    PublicLibraryService,
    ExternalReferenceService,
    ExternalAssetsService,
    ExternalReadService,
    ExternalMcpService,
  ],
})
export class ExternalReadModule {}
