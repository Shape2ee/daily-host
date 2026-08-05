import {
  DAY_KEYS,
  createDefaultAttendance,
  formatDate,
  formatSlackShare,
  getAvailableDays,
  parseDate,
} from './scheduler.js';

/**
 * 확정 주차를 Notion upsert 페이로드로 변환한다.
 */
export function buildSchedulePayload(weeks, hostMap) {
  return weeks
    .map((week, index) => {
      if (!week.confirmed) return null;

      const weekNumber = index + 1;
      const dayNames = {};
      for (const day of DAY_KEYS) {
        const hostId = week.assignments[day];
        dayNames[day] =
          hostId !== undefined
            ? hostMap.get(hostId)?.name ?? ''
            : '';
      }

      const available = getAvailableDays(week);
      const hasAny = available.some((d) => week.assignments[d] !== undefined);
      if (!hasAny) return null;

      return {
        weekKey: week.id,
        weekNumber,
        name: `${weekNumber}주차 ${formatDate(week.startDate)}~${formatDate(week.endDate)}`,
        startDate: formatDate(week.startDate),
        endDate: formatDate(week.endDate),
        monday: dayNames.monday,
        tuesday: dayNames.tuesday,
        wednesday: dayNames.wednesday,
        thursday: dayNames.thursday,
        slackText: formatSlackShare(week, weekNumber, hostMap),
      };
    })
    .filter(Boolean);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * 기준일(기본: 오늘)이 속한 연·월의 YYYY-MM-DD 범위를 반환한다.
 */
export function getMonthRange(baseDate = new Date()) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const start = `${year}-${pad2(month + 1)}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const end = `${year}-${pad2(month + 1)}-${pad2(lastDay)}`;
  return { year, month: month + 1, start, end };
}

/**
 * Notion 스케줄 중 Period가 지정 월과 겹치는 항목만 남긴다.
 */
export function filterSchedulesByMonth(schedules, baseDate = new Date()) {
  const { start: monthStart, end: monthEnd } = getMonthRange(baseDate);

  return (schedules ?? []).filter((item) => {
    const start = item.startDate || item.endDate;
    const end = item.endDate || item.startDate;
    if (!start) return false;
    return start <= monthEnd && end >= monthStart;
  });
}

function resolveHostIdByName(hosts, name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return undefined;

  const exact = hosts.find((h) => h.name === trimmed);
  if (exact) return exact.id;

  const lower = trimmed.toLowerCase();
  return hosts.find((h) => h.name.toLowerCase() === lower)?.id;
}

/**
 * Notion Schedule History → 앱 Week[] (확정 상태) 변환.
 * 호스트 이름은 현재 hosts 목록과 매칭한다.
 */
export function notionSchedulesToWeeks(schedules, hosts) {
  const hostIds = hosts.map((h) => h.id);

  const weeks = (schedules ?? [])
    .map((item) => {
      const startDate = parseDate(item.startDate);
      const endDate = parseDate(item.endDate || item.startDate);
      if (!startDate || !endDate) return null;

      const assignments = {};
      for (const day of DAY_KEYS) {
        const hostId = resolveHostIdByName(hosts, item[day]);
        if (hostId !== undefined) {
          assignments[day] = hostId;
        }
      }

      return {
        id: item.weekKey || `week-notion-${formatDate(startDate)}`,
        startDate,
        endDate,
        attendance: createDefaultAttendance(hostIds),
        assignments,
        passes: {},
        confirmed: true,
        isLocked: false,
        weekNumber: item.weekNumber ?? null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  return weeks.map((week) => ({
    ...week,
    isLocked: false,
  }));
}
