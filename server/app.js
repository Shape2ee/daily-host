import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertConfigured,
  archiveSchedules,
  createNotionClient,
  getConfig,
  listSchedules,
  upsertMember,
  upsertSchedule,
} from './notion/service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * Express 앱 (로컬 listen / Vercel serverless 공용)
 */
export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    const config = getConfig();
    res.json({
      ok: true,
      notion: {
        token: Boolean(config.token),
        membersDb: Boolean(config.membersDbId),
        scheduleDb: Boolean(config.scheduleDbId),
      },
    });
  });

  app.post('/api/notion/members/push', async (req, res) => {
    try {
      const config = assertConfigured('members');
      const notion = createNotionClient(config.token);
      const hosts = Array.isArray(req.body?.hosts) ? req.body.hosts : [];
      const results = [];

      for (const host of hosts) {
        if (!host?.name) continue;
        const saved = await upsertMember(notion, config.membersDbId, {
          name: host.name,
          active: host.active !== false,
          appHostId: host.id,
          note: host.note ?? '',
        });
        results.push(saved);
      }

      res.json({ ok: true, members: results, count: results.length });
    } catch (error) {
      res.status(error.status || 500).json({
        ok: false,
        error: error.message || '멤버 업로드 실패',
      });
    }
  });

  app.get('/api/notion/schedules', async (_req, res) => {
    try {
      const config = assertConfigured('schedule');
      const notion = createNotionClient(config.token);
      const schedules = await listSchedules(notion, config.scheduleDbId);
      res.json({ ok: true, schedules });
    } catch (error) {
      res.status(error.status || 500).json({
        ok: false,
        error: error.message || '스케줄 조회 실패',
      });
    }
  });

  app.post('/api/notion/schedules/upsert', async (req, res) => {
    try {
      const config = assertConfigured('schedule');
      const notion = createNotionClient(config.token);
      const weeks = Array.isArray(req.body?.weeks) ? req.body.weeks : [];

      if (weeks.length === 0) {
        return res
          .status(400)
          .json({ ok: false, error: 'weeks 배열이 비어 있습니다.' });
      }

      const results = [];
      for (const week of weeks) {
        if (!week?.weekKey) continue;
        const saved = await upsertSchedule(notion, config.scheduleDbId, week);
        results.push(saved);
      }

      res.json({
        ok: true,
        results,
        created: results.filter((r) => r.action === 'created').length,
        updated: results.filter((r) => r.action === 'updated').length,
      });
    } catch (error) {
      res.status(error.status || 500).json({
        ok: false,
        error: error.message || '스케줄 동기화 실패',
      });
    }
  });

  app.post('/api/notion/schedules/clear', async (req, res) => {
    try {
      const config = assertConfigured('schedule');
      const notion = createNotionClient(config.token);
      const start = typeof req.body?.start === 'string' ? req.body.start : '';
      const end = typeof req.body?.end === 'string' ? req.body.end : '';

      const result = await archiveSchedules(notion, config.scheduleDbId, {
        start: start || undefined,
        end: end || undefined,
      });

      res.json({ ok: true, archived: result.archived });
    } catch (error) {
      res.status(error.status || 500).json({
        ok: false,
        error: error.message || '스케줄 초기화 실패',
      });
    }
  });

  app.use((err, _req, res, _next) => {
    res.status(500).json({ ok: false, error: err.message || 'Server error' });
  });

  return app;
}

const app = createApp();
export default app;
