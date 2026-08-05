/**
 * Vercel Serverless 엔트리.
 * /api/* 요청을 Express 앱으로 전달한다.
 */
import app from '../server/app.js';

function ensureApiPrefix(req) {
  const url = req.url || '/';
  if (url.startsWith('/api')) return;

  // Vercel이 /api 접두사를 제거해 넘기는 경우 보정
  const pathOnly = url.startsWith('/') ? url : `/${url}`;
  const [pathname, query = ''] = pathOnly.split('?');
  req.url = `/api${pathname === '/' ? '' : pathname}${query ? `?${query}` : ''}`;
}

export default function handler(req, res) {
  ensureApiPrefix(req);
  return app(req, res);
}
