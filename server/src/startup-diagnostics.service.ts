import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Connection } from 'mongoose';
import { ContentGitService } from './modules/content/content-git.service';
import { ContentRepoService } from './modules/content/content-repo.service';
import { MineruService } from './modules/import/mineru.service';
import { MinioService } from './modules/minio/minio.service';

/**
 * Grouped, numbered startup report — critical dependencies first (Mongo → MinIO → KB → optional).
 */
@Injectable()
export class StartupDiagnosticsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StartupDiagnosticsService.name);

  constructor(
    @Inject('DefaultTypegooseConnection')
    private readonly mongoConnection: Connection,
    private readonly configService: ConfigService,
    private readonly minioService: MinioService,
    private readonly contentRepoService: ContentRepoService,
    private readonly contentGitService: ContentGitService,
    private readonly mineruService: MineruService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const mongoHost = this.configService.get<string>('mongo.host');
    const mongoPort = this.configService.get<number>('mongo.port');
    const mongoDb = this.configService.get<string>('mongo.database');

    let mongoLine: string;
    try {
      const db = this.mongoConnection.db;
      if (!db) {
        throw new Error('MongoDB connection has no database handle yet');
      }
      const t0 = Date.now();
      await db.admin().command({ ping: 1 });
      const pingMs = Date.now() - t0;
      mongoLine = `OK — ${mongoHost}:${mongoPort}/${mongoDb}, ping ${pingMs}ms`;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      mongoLine = `FAIL — ${mongoHost}:${mongoPort}/${mongoDb ?? '?'} — ${msg}`;
    }

    const minioReady = this.minioService.isDraftStorageReady();
    const minioCfg = this.minioService.getDraftStorageConfig();
    const minioDetail = this.minioService.getDraftStorageInitError();
    const minioLine = minioReady
      ? `OK — ${minioCfg.endpoint}:${minioCfg.port}, bucket "${minioCfg.bucket}"`
      : `FAIL — ${minioCfg.endpoint}:${minioCfg.port}, bucket "${minioCfg.bucket}" — ${minioDetail ?? 'unknown error'}`;

    const kbRoot = this.contentRepoService.repoRoot;
    const kbLine = `repoRoot: ${kbRoot}`;

    const gitLine =
      this.contentGitService.getKbGitSummaryLine() ??
      'KB Git: (summary unavailable — check ContentGitService init order)';

    const mineruBaseUrl = this.configService.get<string>(
      'mineru.baseUrl',
      'https://mineru.net',
    );
    let mineruLine: string;
    if (!this.mineruService.isConfigured()) {
      mineruLine = `not configured — token empty`;
    } else {
      mineruLine = await this.probeMineruHost(mineruBaseUrl);
    }

    const httpPort = process.env.PORT ?? '4398';
    const kbRemote = process.env.KB_REMOTE_URL?.trim();

    this.emitGroupedReport([
      {
        title: '[1] MongoDB',
        lines: [mongoLine],
      },
      {
        title: '[2] MinIO',
        lines: [minioLine],
      },
      {
        title: '[3] Knowledge Base',
        lines: [kbLine, gitLine],
      },
      {
        title: '[4] MinerU (optional)',
        lines: [mineruLine],
      },
      {
        title: '[5] Process',
        lines: [
          `PORT=${httpPort}, NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}`,
          `cwd=${process.cwd()}`,
        ],
      },
      {
        title: '[6] Remote sync',
        lines: [
          `KB_REMOTE_URL=${kbRemote ? `"${kbRemote}"` : 'unset'}`,
        ],
      },
    ]);
  }

  /** Visual grouping + indentation so blocks scan faster than a flat list. */
  private emitGroupedReport(
    sections: readonly { title: string; lines: string[] }[],
  ): void {
    this.logger.log('');
    this.logger.log(
      '================================================================',
    );
    this.logger.log(
      '  Startup diagnostics — critical dependencies listed first',
    );
    this.logger.log(
      '================================================================',
    );
    for (const section of sections) {
      this.logger.log('');
      this.logger.log(section.title);
      for (const line of section.lines) {
        this.logger.log(`    ${line}`);
      }
    }
    this.logger.log('');
    this.logger.log(
      '================================================================',
    );
  }

  /** Best-effort TCP reachability of MinerU API origin; auth is validated on first import. */
  private async probeMineruHost(baseUrl: string): Promise<string> {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      return `MinerU (import): invalid mineru.baseUrl in yaml: ${baseUrl}`;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    try {
      const res = await fetch(url.origin, {
        method: 'GET',
        redirect: 'manual',
        signal: ac.signal,
      });
      return `MinerU (import): token configured; API origin reachable (${url.origin}, HTTP ${res.status})`;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return `MinerU (import): token configured but origin check failed (${url.origin}) — ${msg}`;
    } finally {
      clearTimeout(timer);
    }
  }
}
