/**
 * Vercel Serverless 엔트리.
 * vercel.json rewrite로 /api/* → /api(index) 전달 후 Express가 라우팅한다.
 * (Vite 프로젝트는 [...path] catch-all 미지원 → 404 원인)
 */
import app from '../server/app.js';

function ensureApiPrefix(req) {
  // rewrite 이후에도 원본 경로가 헤더에 남는 경우 복구
  const forwarded =
    req.headers['x-forwarded-uri'] ||
    req.headers['x-invoke-path'] ||
    req.url ||
    '/';
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const url = raw.startsWith('http') ? new URL(raw).pathname + new URL(raw).search : raw;

  if (url.startsWith('/api')) {
    req.url = url;
    return;
  }

  const pathOnly = url.startsWith('/') ? url : `/${url}`;
  const [pathname, query = ''] = pathOnly.split('?');
  req.url = `/api${pathname === '/' ? '' : pathname}${query ? `?${query}` : ''}`;
}

export default function handler(req, res) {
  ensureApiPrefix(req);
  return app(req, res);
}
