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
 * Notion Members → 앱 hosts / queue 변환.
 * Priority = 현재 큐 순서, BasePriority = 기준 큐 순서 (없으면 AppHostId).
 */
export function notionMembersToHosts(members, previousHosts = []) {
  const usedIds = new Set();
  let nextAutoId =
    previousHosts.length > 0
      ? Math.max(...previousHosts.map((h) => Number(h.id) || 0), 0) + 1
      : 1;

  const hosts = [];

  for (const member of members ?? []) {
    const name = String(member.name ?? '').trim();
    if (!name) continue;

    let id =
      member.appHostId != null && Number.isFinite(Number(member.appHostId))
        ? Number(member.appHostId)
        : null;

    if (id == null || id <= 0 || usedIds.has(id)) {
      const prevByName = previousHosts.find((h) => h.name === name);
      if (
        prevByName &&
        !usedIds.has(prevByName.id) &&
        (id == null || id <= 0)
      ) {
        id = prevByName.id;
      } else {
        while (usedIds.has(nextAutoId)) nextAutoId += 1;
        id = nextAutoId;
        nextAutoId += 1;
      }
    }

    usedIds.add(id);
    hosts.push({
      id,
      name,
      count: 0,
      totalWorkingDays: 0,
      active: member.active !== false,
      notionPageId: member.notionPageId ?? null,
      note: member.note ?? '',
      _priority: member.priority ?? null,
      _basePriority: member.basePriority ?? null,
    });
  }

  const byBase = [...hosts].sort((a, b) => {
    const aHas = a._basePriority != null;
    const bHas = b._basePriority != null;
    if (aHas && bHas) return a._basePriority - b._basePriority;
    if (aHas) return -1;
    if (bHas) return 1;
    return a.id - b.id;
  });

  const byPriority = [...hosts].sort((a, b) => {
    const aHas = a._priority != null;
    const bHas = b._priority != null;
    if (aHas && bHas) return a._priority - b._priority;
    if (aHas) return -1;
    if (bHas) return 1;
    const av = a._basePriority ?? a.id;
    const bv = b._basePriority ?? b.id;
    return Number(av) - Number(bv);
  });

  const basePriorityQueue = byBase.map((h) => h.id);
  const priorityQueue = byPriority
    .filter((h) => h.active !== false)
    .map((h) => h.id);

  return {
    hosts: hosts.map(({ _priority, _basePriority, ...rest }) => rest),
    priorityQueue,
    basePriorityQueue,
  };
}

/**
 * 앱 상태를 Notion Members upsert 페이로드로 변환한다.
 * Priority/BasePriority에 큐 인덱스를 실어 다른 세션과 순서를 맞춘다.
 */
export function buildMembersPayload(hosts, priorityQueue, basePriorityQueue) {
  return hosts.map((host) => {
    const priorityIdx = priorityQueue.indexOf(host.id);
    const baseIdx = basePriorityQueue.indexOf(host.id);
    return {
      id: host.id,
      name: host.name,
      active: host.active !== false,
      note: host.note ?? '',
      priority: priorityIdx >= 0 ? priorityIdx : null,
      basePriority: baseIdx >= 0 ? baseIdx : null,
    };
  });
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
