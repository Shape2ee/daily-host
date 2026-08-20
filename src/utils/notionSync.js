import {
  DAY_KEYS,
  createDefaultAttendance,
  formatDate,
  formatSlackShare,
  getAvailableDays,
  getMondayOfWeek,
  parseDate,
} from './scheduler.js';

/**
 * 주차 attendance → Notion Attendance(JSON) 문자열.
 * 예: {"monday":["홍길동","김철수"],"tuesday":[...],...}
 */
export function serializeAttendance(weekAttendance, hostMap) {
  if (!weekAttendance || typeof weekAttendance !== 'object') return '';

  const payload = {};
  for (const day of DAY_KEYS) {
    const dayAttendance = weekAttendance[day] ?? {};
    payload[day] = Object.entries(dayAttendance)
      .filter(([, present]) => present === true)
      .map(([hostId]) => hostMap.get(Number(hostId))?.name ?? '')
      .filter(Boolean);
  }
  return JSON.stringify(payload);
}

/**
 * Notion Attendance(JSON) → 앱 attendance.
 * 비어 있거나 파싱 실패면 null (레거시: 전원 출근 유지).
 */
export function deserializeAttendance(text, hosts) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const attendance = {};
  for (const day of DAY_KEYS) {
    const names = Array.isArray(parsed[day]) ? parsed[day] : [];
    const presentIds = new Set();
    for (const name of names) {
      const hostId = resolveHostIdByName(hosts, name);
      if (hostId !== undefined) presentIds.add(hostId);
    }
    attendance[day] = {};
    for (const host of hosts) {
      attendance[day][host.id] = presentIds.has(host.id);
    }
  }
  return attendance;
}

/**
 * 주차를 Notion upsert 페이로드로 변환한다.
 * 기본값은 기존 동작과 동일하게 확정 주차만 포함한다.
 */
export function buildSchedulePayload(
  weeks,
  hostMap,
  { includeDrafts = false } = {},
) {
  return weeks
    .map((week, index) => {
      if (!week.confirmed && !includeDrafts) return null;

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
      if (week.confirmed && !hasAny) return null;

      const period = `${formatDate(week.startDate)}~${formatDate(week.endDate)}`;
      const mondayKey = formatDate(getMondayOfWeek(week.startDate));

      return {
        weekKey: mondayKey || week.id,
        weekNumber: index + 1,
        name: period,
        startDate: formatDate(week.startDate),
        endDate: formatDate(week.endDate),
        monday: dayNames.monday,
        tuesday: dayNames.tuesday,
        wednesday: dayNames.wednesday,
        thursday: dayNames.thursday,
        attendance: serializeAttendance(week.attendance, hostMap),
        slackText: week.confirmed ? formatSlackShare(week, hostMap) : '',
        confirmed: Boolean(week.confirmed),
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
  return filterSchedulesByDateRange(schedules, monthStart, monthEnd);
}

/**
 * Notion 스케줄 중 Period가 start~end 와 겹치는 항목만 남긴다.
 */
export function filterSchedulesByDateRange(schedules, rangeStart, rangeEnd) {
  if (!rangeStart || !rangeEnd) return [];

  return (schedules ?? []).filter((item) => {
    const start = item.startDate || item.endDate;
    const end = item.endDate || item.startDate;
    if (!start) return false;
    return start <= rangeEnd && end >= rangeStart;
  });
}

function resolveHostIdByName(hosts, name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return undefined;

  const lower = trimmed.toLowerCase();
  const matches = hosts.filter(
    (h) => h.name === trimmed || h.name.toLowerCase() === lower,
  );

  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0].id;

  // 동명이면 활성 멤버 우선 (완전 해소는 불가 — 추가 시 중복명 차단)
  const active = matches.filter((h) => h.active !== false);
  if (active.length === 1) return active[0].id;
  return (active[0] ?? matches[0]).id;
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

  // 비활성은 기준/현재 큐 모두에서 제외 (로컬 setHostActive와 정책 통일)
  const basePriorityQueue = byBase
    .filter((h) => h.active !== false)
    .map((h) => h.id);
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
 * Notion Schedule History → 앱 Week[] 변환.
 * 호스트 이름은 현재 hosts 목록과 매칭한다.
 * Attendance(JSON)가 있으면 복원하고, 없으면(레거시) 전원 출근으로 둔다.
 */
export function notionSchedulesToWeeks(schedules, hosts) {
  const hostIds = hosts.map((h) => h.id);

  const weeks = (schedules ?? [])
    .map((item) => {
      const startDate = parseDate(item.startDate);
      const endDate = parseDate(item.endDate || item.startDate);
      if (!startDate || !endDate) return null;

      const mondayKey = formatDate(getMondayOfWeek(startDate));
      if (!mondayKey) return null;

      const assignments = {};
      for (const day of DAY_KEYS) {
        const hostId = resolveHostIdByName(hosts, item[day]);
        if (hostId !== undefined) {
          assignments[day] = hostId;
        }
      }

      const restored = deserializeAttendance(item.attendance, hosts);
      const legacyKey = String(item.weekKey ?? '');
      const keyIsStable = legacyKey === mondayKey;

      return {
        id: mondayKey,
        startDate,
        endDate,
        attendance: restored ?? createDefaultAttendance(hostIds),
        assignments,
        passes: {},
        // 레거시 Updated/빈 Status는 이미 확정 이력으로 취급한다.
        confirmed: item.status !== 'Draft',
        isLocked: false,
        weekNumber: item.weekNumber ?? null,
        _keyIsStable: keyIsStable,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  const unique = [];
  const seen = new Set();
  for (const week of weeks) {
    if (seen.has(week.id)) {
      // 동일 월요일이 여러 개면 안정 weekKey(=월요일)인 쪽을 우선
      if (week._keyIsStable) {
        const idx = unique.findIndex((w) => w.id === week.id);
        if (idx >= 0) {
          const { _keyIsStable, ...rest } = week;
          unique[idx] = rest;
        }
      }
      continue;
    }
    seen.add(week.id);
    const { _keyIsStable, ...rest } = week;
    unique.push(rest);
  }

  return unique;
}
