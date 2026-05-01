import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypegooseModule } from 'nestjs-typegoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ContentModule } from './modules/content/content.module';
import { NavigationModule } from './modules/navigation/navigation.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { AuthModule } from './modules/auth/auth.module';
import { MinioModule } from './modules/minio/minio.module';
import { yamlLoader } from './config/yaml.loader';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [yamlLoader],
    }),
    TypegooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const host = config.get<string>('mongo.host');
        const port = config.get<number>('mongo.port');
        const user = config.get<string>('mongo.username');
        const pass = config.get<string>('mongo.password');
        const db = config.get<string>('mongo.database');
        const authSource = config.get<string>('mongo.options.authSource');
        return {
          uri: `mongodb://${user}:${pass}@${host}:${port}/${db}?authSource=${authSource}`,
        };
      },
    }),
    ScheduleModule.forRoot(),
    MinioModule,
    AuthModule,
    ContentModule,
    NavigationModule,
    WorkspaceModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
