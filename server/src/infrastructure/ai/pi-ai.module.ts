import { Global, Module } from '@nestjs/common';
import { PiModelRuntimeService } from './pi-model-runtime.service';

@Global()
@Module({
  providers: [PiModelRuntimeService],
  exports: [PiModelRuntimeService],
})
export class PiAiModule {}
