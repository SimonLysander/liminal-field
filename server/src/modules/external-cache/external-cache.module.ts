import { Module } from '@nestjs/common';
import { TypegooseModule } from 'nestjs-typegoose';
import { ExternalCacheEntry } from './external-cache.entity';
import { ExternalCacheRepository } from './external-cache.repository';

@Module({
  imports: [TypegooseModule.forFeature([ExternalCacheEntry])],
  providers: [ExternalCacheRepository],
  exports: [ExternalCacheRepository],
})
export class ExternalCacheModule {}
