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
import { OssModule } from './modules/oss/oss.module';
import { ImportModule } from './modules/import/import.module';
import { HomeModule } from './modules/home/home.module';
import { SettingsModule } from './modules/settings/settings.module';
import { AgentModule } from './modules/agent/agent.module';
import { yamlLoader } from './config/yaml.loader';
import { StartupDiagnosticsService } from './startup-diagnostics.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // 本地 dev 和 Docker 统一读根目录 .env；Docker 中 env 由 compose 注入，此文件可缺失
      envFilePath: '../.env',
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
    OssModule,
    AuthModule,
    ContentModule,
    NavigationModule,
    WorkspaceModule,
    ImportModule,
    HomeModule,
    SettingsModule,
    AgentModule,
  ],
  controllers: [AppController],
  providers: [AppService, StartupDiagnosticsService],
})
export class AppModule {}
