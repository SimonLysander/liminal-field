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
import { SkillModule } from './modules/skill/skill.module';
import { DigestModule } from './modules/digest/digest.module';
import { PromptManagerModule } from './infrastructure/prompt/prompt-manager.module';
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
        // 本地（无 auth mongo）与线上（root admin/changeme）兼容：
        // user/pass 缺省时拼无认证 URI。mongoose 客户端 URI 里带 user:pass 会发 SASL 握手，
        // 而 mongo 容器不启 auth 时会拒绝握手 → 必须从 URI 里把 user:pass 也去掉。
        // user 和 pass 必须成对出现，单边缺会造成无 auth URI 撞上 auth-required mongo,
        // 错误现场远离根因；提前 throw 让 misconfig 在启动阶段就暴露。
        if (Boolean(user) !== Boolean(pass)) {
          throw new Error(
            'Mongo config: MONGO_USER 和 MONGO_PASSWORD 必须同时提供或同时缺省',
          );
        }
        const hasAuth = Boolean(user && pass);
        const userInfo = hasAuth ? `${user}:${encodeURIComponent(pass!)}@` : '';
        // 防御 authSource 缺省：hasAuth 但 yaml/env 漏配 authSource → URI 会拼出
        // `?authSource=undefined` 这种字面量，silent 失败。这里 fallback 走无 query 段。
        const authQuery =
          hasAuth && authSource ? `?authSource=${authSource}` : '';
        return {
          uri: `mongodb://${userInfo}${host}:${port}/${db}${authQuery}`,
        };
      },
    }),
    ScheduleModule.forRoot(),
    PromptManagerModule,
    OssModule,
    AuthModule,
    ContentModule,
    NavigationModule,
    WorkspaceModule,
    ImportModule,
    HomeModule,
    SkillModule,
    SettingsModule,
    AgentModule,
    DigestModule,
  ],
  controllers: [AppController],
  providers: [AppService, StartupDiagnosticsService],
})
export class AppModule {}
