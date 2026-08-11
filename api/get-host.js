/**
 * 크롬 확장 프로그램용: 오늘(Asia/Seoul) 호스트 조회
 * GET /api/get-host
 */
import {
  assertConfigured,
  createNotionClient,
  getHostForDate,
  getSeoulToday,
} from '../server/notion/service.js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'GET only' });
  }

  try {
    const config = assertConfigured('schedule');
    const notion = createNotionClient(config.token);
    const { date } = getSeoulToday();
    const result = await getHostForDate(notion, config.scheduleDbId, date);

    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('get-host error:', error);
    return res.status(error.status || 500).json({
      ok: false,
      error: error.message || '오늘 호스트 조회 실패',
    });
  }
}
