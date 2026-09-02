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
  getHostForDate,
  getSeoulToday,
  listMembers,
  listSchedules,
  patchScheduleAttendance,
  upsertMember,
  upsertSchedule,
} from './notion/service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// 같은 서버 인스턴스에서 동일 주차의 연속 체크 요청을 순서대로 처리한다.
// 서버리스 인스턴스 간 경합은 service의 저장 후 검증·재시도로 보완한다.
const attendanceLocks = new Map();

async function withAttendanceLock(weekKey, task) {
  const previous = attendanceLocks.get(weekKey) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  attendanceLocks.set(weekKey, current);

  try {
    return await current;
  } finally {
    if (attendanceLocks.get(weekKey) === current) {
      attendanceLocks.delete(weekKey);
    }
  }
}

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

  /** 크롬 확장: 오늘(Asia/Seoul) 호스트 */
  app.get('/api/get-host', async (_req, res) => {
    try {
      const config = assertConfigured('schedule');
      const notion = createNotionClient(config.token);
      const { date } = getSeoulToday();
      const result = await getHostForDate(notion, config.scheduleDbId, date);
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(error.status || 500).json({
        ok: false,
        error: error.message || '오늘 호스트 조회 실패',
      });
    }
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
          softResetPending: host.softResetPending === true,
          baselineCount: host.baselineCount ?? 0,
          lastHostedAt: host.lastHostedAt ?? '',
          appHostId: host.id,
          priority: host.priority,
          basePriority: host.basePriority,
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

  app.get('/api/notion/members', async (_req, res) => {
    try {
      const config = assertConfigured('members');
      const notion = createNotionClient(config.token);
      const members = await listMembers(notion, config.membersDbId);
      res.json({ ok: true, members, count: members.length });
    } catch (error) {
      res.status(error.status || 500).json({
        ok: false,
        error: error.message || '멤버 조회 실패',
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
        skipped: results.filter((r) => r.action === 'skipped').length,
      });
    } catch (error) {
      res.status(error.status || 500).json({
        ok: false,
        error: error.message || '스케줄 동기화 실패',
      });
    }
  });

  app.post('/api/notion/schedules/attendance', async (req, res) => {
    try {
      const config = assertConfigured('schedule');
      const notion = createNotionClient(config.token);
      const week = req.body?.week;
      const day = req.body?.day;
      const hostName = String(req.body?.hostName ?? '').trim();
      const present = req.body?.present;

      if (!week?.weekKey || !hostName || typeof present !== 'boolean') {
        return res.status(400).json({
          ok: false,
          error: 'week.weekKey, hostName, present(boolean)가 필요합니다.',
        });
      }

      const result = await withAttendanceLock(week.weekKey, () =>
        patchScheduleAttendance(notion, config.scheduleDbId, {
          week,
          day,
          hostName,
          present,
        }),
      );

      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(error.status || 500).json({
        ok: false,
        error: error.message || '출근 정보 동기화 실패',
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
