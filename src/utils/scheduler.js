import { DAY_LABELS, MIN_HOST_COUNT } from '../constants/hosts.js';

/** 배정 대상 요일 순서 */
export const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday'];

/** JS getDay() → DayKey (월=1 … 목=4) */
const DAY_INDEX_TO_KEY = {
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
};

/**
 * 호스트 ID 목록으로 기본 출근(true) Attendance를 생성한다.
 */
export function createDefaultAttendance(hostIds) {
  const dayAttendance = () =>
    Object.fromEntries(hostIds.map((id) => [id, true]));

  return {
    monday: dayAttendance(),
    tuesday: dayAttendance(),
    wednesday: dayAttendance(),
    thursday: dayAttendance(),
  };
}

/**
 * 날짜를 로컬 YYYY-MM-DD 문자열로 변환한다.
 */
export function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * YYYY-MM-DD 문자열을 로컬 Date로 파싱한다.
 */
export function parseDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/**
 * Date를 시간 없이 정규화한다.
 */
function toDateOnly(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * 해당 날짜가 속한 주의 월요일을 반환한다.
 */
function getMondayOfWeek(date) {
  const d = toDateOnly(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

/**
 * 활성 호스트만 반환한다.
 */
export function getActiveHosts(hosts) {
  return hosts.filter((h) => h.active !== false);
}

/**
 * 큐에서 활성 호스트만 남긴다.
 */
export function filterActiveQueue(queue, hosts) {
  const activeIds = new Set(getActiveHosts(hosts).map((h) => h.id));
  return queue.filter((id) => activeIds.has(id));
}

/**
 * Week의 startDate~endDate 구간에서 실제 존재하는 월~목 요일을 반환한다.
 */
export function getAvailableDays(week) {
  const days = [];
  const cursor = toDateOnly(week.startDate);
  const end = toDateOnly(week.endDate);

  while (cursor <= end) {
    const key = DAY_INDEX_TO_KEY[cursor.getDay()];
    if (key) {
      days.push(key);
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

/**
 * Week 구간에서 특정 요일(DayKey)에 해당하는 날짜를 반환한다.
 */
export function getDateForDay(week, dayKey) {
  const cursor = toDateOnly(week.startDate);
  const end = toDateOnly(week.endDate);

  while (cursor <= end) {
    if (DAY_INDEX_TO_KEY[cursor.getDay()] === dayKey) {
      return toDateOnly(cursor);
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return null;
}

/**
 * 해당 요일의 캘린더 날짜가 오늘보다 이전인지 여부.
 */
export function isDayPast(week, dayKey, now = new Date()) {
  const dayDate = getDateForDay(week, dayKey);
  if (!dayDate) return true;
  return dayDate.getTime() < toDateOnly(now).getTime();
}

/**
 * 교환/패스 가능한(아직 지나지 않은) 요일만 반환한다.
 */
export function getSwappableDays(week, now = new Date()) {
  return getAvailableDays(week).filter((day) => !isDayPast(week, day, now));
}

/**
 * Freeze Rule: 이후 확정 주차가 있으면 과거 확정 주차로 표시한다.
 * (교환 가능 여부는 지난 날짜 여부로 따로 판단한다.)
 */
export function isWeekFrozen(weeks, weekId) {
  const index = weeks.findIndex((w) => w.id === weekId);
  if (index < 0) return true;

  const week = weeks[index];
  if (!week.confirmed) return false;

  return weeks.slice(index + 1).some((w) => w.confirmed);
}

/**
 * 시작일~종료일 기준으로 월~목 Week 리스트를 생성한다.
 * 금·토·일은 제외하며, 동일 주차별로 그룹핑한다.
 */
export function generateWeeks(startDateStr, endDateStr, hostIds) {
  const rangeStart = parseDate(startDateStr);
  const rangeEnd = parseDate(endDateStr);

  if (!rangeStart || !rangeEnd || rangeEnd < rangeStart) {
    return [];
  }

  const weekMap = new Map();
  const cursor = toDateOnly(rangeStart);
  const end = toDateOnly(rangeEnd);

  while (cursor <= end) {
    const dayKey = DAY_INDEX_TO_KEY[cursor.getDay()];

    if (dayKey) {
      const monday = getMondayOfWeek(cursor);
      const weekKey = formatDate(monday);
      const days = weekMap.get(weekKey) ?? [];
      days.push(toDateOnly(cursor));
      weekMap.set(weekKey, days);
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  const weeks = [];
  let index = 0;

  for (const [, dates] of weekMap) {
    dates.sort((a, b) => a.getTime() - b.getTime());

    weeks.push({
      id: `week-${index + 1}-${formatDate(dates[0])}`,
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      attendance: createDefaultAttendance(hostIds),
      assignments: {},
      passes: {},
      confirmed: false,
      isLocked: index !== 0,
    });

    index += 1;
  }

  return weeks;
}

/**
 * 활성 출근자가 0명인 요일 목록을 반환한다.
 * 비활성 멤버의 체크만으로는 "출근 있음"으로 치지 않는다.
 */
export function findEmptyAttendanceDays(week, hosts = []) {
  const activeIds = getActiveHosts(hosts).map((h) => h.id);

  return getAvailableDays(week).filter((day) => {
    const record = week.attendance[day] ?? {};

    if (activeIds.length === 0) {
      return true;
    }

    return !activeIds.some((id) => record[id] === true);
  });
}

/**
 * 호스트를 추가한다.
 */
export function addHost(hosts, queue, baseQueue, weeks, name) {
  const trimmed = name.trim();
  if (!trimmed) {
    return { hosts, queue, baseQueue, weeks };
  }

  const nextId =
    hosts.length === 0 ? 1 : Math.max(...hosts.map((h) => h.id)) + 1;

  const newHost = {
    id: nextId,
    name: trimmed,
    count: 0,
    totalWorkingDays: 0,
    active: true,
    notionPageId: null,
  };

  const nextWeeks = weeks.map((week) => {
    if (week.confirmed) {
      return week;
    }

    return {
      ...week,
      attendance: {
        monday: { ...week.attendance.monday, [nextId]: true },
        tuesday: { ...week.attendance.tuesday, [nextId]: true },
        wednesday: { ...week.attendance.wednesday, [nextId]: true },
        thursday: { ...week.attendance.thursday, [nextId]: true },
      },
    };
  });

  return {
    hosts: [...hosts, newHost],
    queue: [...queue, nextId],
    baseQueue: [...baseQueue, nextId],
    weeks: nextWeeks,
  };
}

/**
 * 확정된 일정에 해당 호스트가 배정된 적이 있는지 확인한다.
 */
export function hasConfirmedAssignment(weeks, hostId) {
  return weeks.some(
    (week) =>
      week.confirmed &&
      DAY_KEYS.some((day) => week.assignments[day] === hostId),
  );
}

/**
 * 호스트를 삭제한다.
 * - 활성 호스트 최소 인원(2명) 미만 불가
 * - 확정 일정 배정 이력이 있으면 불가
 */
export function removeHost(hosts, queue, baseQueue, weeks, hostId) {
  if (!hosts.some((h) => h.id === hostId)) {
    return { ok: false, error: 'NOT_FOUND' };
  }

  const remainingActive = getActiveHosts(hosts).filter((h) => h.id !== hostId);
  if (remainingActive.length < MIN_HOST_COUNT) {
    return { ok: false, error: 'MIN_HOSTS' };
  }

  if (hasConfirmedAssignment(weeks, hostId)) {
    return { ok: false, error: 'HAS_ASSIGNMENT' };
  }

  const stripAttendance = (record) => {
    const next = { ...record };
    delete next[hostId];
    return next;
  };

  const nextWeeks = weeks.map((week) => {
    if (week.confirmed) {
      return week;
    }

    return {
      ...week,
      attendance: {
        monday: stripAttendance(week.attendance.monday),
        tuesday: stripAttendance(week.attendance.tuesday),
        wednesday: stripAttendance(week.attendance.wednesday),
        thursday: stripAttendance(week.attendance.thursday),
      },
      assignments: Object.fromEntries(
        Object.entries(week.assignments).filter(([, id]) => id !== hostId),
      ),
    };
  });

  return {
    ok: true,
    hosts: hosts.filter((h) => h.id !== hostId),
    queue: queue.filter((id) => id !== hostId),
    baseQueue: baseQueue.filter((id) => id !== hostId),
    weeks: nextWeeks,
  };
}

/**
 * 멤버 활성/비활성 전환.
 * - 비활성: 통계(count/totalWorkingDays) 유지, 큐에서 제외
 * - 활성: 큐 맨 뒤로 재진입
 */
export function setHostActive(hosts, queue, baseQueue, hostId, active) {
  const target = hosts.find((h) => h.id === hostId);
  if (!target) {
    return { ok: false, error: 'NOT_FOUND' };
  }

  if (target.active !== false && !active) {
    const remainingActive = getActiveHosts(hosts).filter((h) => h.id !== hostId);
    if (remainingActive.length < MIN_HOST_COUNT) {
      return { ok: false, error: 'MIN_HOSTS' };
    }
  }

  const nextHosts = hosts.map((h) =>
    h.id === hostId ? { ...h, active } : h,
  );

  if (!active) {
    return {
      ok: true,
      hosts: nextHosts,
      queue: queue.filter((id) => id !== hostId),
      baseQueue: baseQueue.filter((id) => id !== hostId),
    };
  }

  const nextQueue = queue.includes(hostId) ? queue : [...queue, hostId];
  const nextBase = baseQueue.includes(hostId)
    ? baseQueue
    : [...baseQueue, hostId];

  return {
    ok: true,
    hosts: nextHosts,
    queue: nextQueue,
    baseQueue: nextBase,
  };
}

/**
 * 특정 Week / 요일 / 호스트의 출근 여부를 갱신한다.
 * 확정된 Week는 수정하지 않는다.
 */
export function updateAttendance(weeks, weekId, hostId, day, present) {
  return weeks.map((week) => {
    if (week.id !== weekId || week.confirmed) {
      return week;
    }

    return {
      ...week,
      attendance: {
        ...week.attendance,
        [day]: {
          ...week.attendance[day],
          [hostId]: present,
        },
      },
    };
  });
}

/**
 * Priority Queue에서 해당 호스트를 맨 뒤로 이동한다.
 */
export function moveHostToQueueTail(queue, hostId) {
  const filtered = queue.filter((id) => id !== hostId);
  return [...filtered, hostId];
}

/**
 * 단일 요일 자동 배정.
 * Queue 앞에서부터 탐색하여 당일 출근자 중 최우선 호스트를 선택한다.
 * excludeHostId(직전 요일 배정자)는 연속 배정 방지를 위해 1차로 건너뛰고,
 * 다른 출근자가 없을 때만 fallback으로 허용한다.
 */
export function assignDay(queue, attendance, day, excludeHostId) {
  const dayAttendance = attendance[day] ?? {};

  for (const hostId of queue) {
    if (excludeHostId !== undefined && hostId === excludeHostId) continue;
    if (dayAttendance[hostId] === true) {
      return hostId;
    }
  }

  // 대안 출근자가 없으면 연속 배정 허용 (1명만 출근한 경우 등)
  if (excludeHostId !== undefined && dayAttendance[excludeHostId] === true) {
    return excludeHostId;
  }

  return undefined;
}

/**
 * 확정 주차 배정만으로 count / totalWorkingDays를 재계산한다.
 * (큐 순서는 변경하지 않는다 — Notion Priority가 소스)
 */
export function recountFromWeeks(hosts, weeks) {
  let nextHosts = hosts.map((h) => ({
    ...h,
    count: 0,
    totalWorkingDays: 0,
  }));

  for (const week of weeks) {
    if (!week.confirmed) continue;

    for (const day of getAvailableDays(week)) {
      const dayAttendance = week.attendance[day] ?? {};

      nextHosts = nextHosts.map((host) =>
        dayAttendance[host.id] === true
          ? { ...host, totalWorkingDays: host.totalWorkingDays + 1 }
          : host,
      );

      const assignedId = week.assignments[day];
      if (assignedId !== undefined) {
        nextHosts = nextHosts.map((host) =>
          host.id === assignedId
            ? { ...host, count: host.count + 1 }
            : host,
        );
      }
    }
  }

  return nextHosts;
}

/**
 * 확정된 배정 결과를 1일차부터 순차 Replay하여
 * count / totalWorkingDays / priorityQueue를 재계산한다.
 * (동결된 과거 주차의 배정 결과 자체는 변경하지 않으며,
 *  재계산된 큐는 미확정 차주 배정에만 사용된다.)
 */
export function replayQueueAndCounts(hosts, baseQueue, weeks) {
  let nextHosts = hosts.map((h) => ({
    ...h,
    count: 0,
    totalWorkingDays: 0,
  }));
  let nextQueue = filterActiveQueue(baseQueue, hosts);

  for (const week of weeks) {
    if (!week.confirmed) continue;

    for (const day of getAvailableDays(week)) {
      const dayAttendance = week.attendance[day] ?? {};

      nextHosts = nextHosts.map((host) =>
        dayAttendance[host.id] === true
          ? { ...host, totalWorkingDays: host.totalWorkingDays + 1 }
          : host,
      );

      const assignedId = week.assignments[day];
      if (assignedId !== undefined) {
        nextHosts = nextHosts.map((host) =>
          host.id === assignedId
            ? { ...host, count: host.count + 1 }
            : host,
        );

        // 활성 멤버만 큐 순환 (비활성은 통계만 유지)
        if (nextQueue.includes(assignedId)) {
          nextQueue = moveHostToQueueTail(nextQueue, assignedId);
        }
      }
    }
  }

  return { hosts: nextHosts, queue: nextQueue };
}

/**
 * 주차 자동 배정 + 확정.
 * 요일 순회 시 직전 요일 배정자와 연속되지 않도록 우선 배정한다.
 */
export function assignWeek(week, hosts, queue) {
  const emptyDays = findEmptyAttendanceDays(week, hosts);
  if (emptyDays.length > 0) {
    return {
      ok: false,
      error: 'EMPTY_ATTENDANCE',
      emptyDays,
    };
  }

  const activeQueue = filterActiveQueue(queue, hosts);
  let nextQueue = [...activeQueue];
  let nextHosts = hosts.map((h) => ({ ...h }));
  const assignments = {};
  const availableDays = getAvailableDays(week);
  const failedDays = [];
  let previousHostId;

  for (const day of availableDays) {
    const hostId = assignDay(
      nextQueue,
      week.attendance,
      day,
      previousHostId,
    );

    if (hostId === undefined) {
      failedDays.push(day);
      continue;
    }

    assignments[day] = hostId;
    previousHostId = hostId;

    const dayAttendance = week.attendance[day] ?? {};

    nextHosts = nextHosts.map((host) => {
      let updated = host;

      if (dayAttendance[host.id] === true) {
        updated = {
          ...updated,
          totalWorkingDays: updated.totalWorkingDays + 1,
        };
      }

      if (host.id === hostId) {
        updated = { ...updated, count: updated.count + 1 };
      }

      return updated;
    });

    nextQueue = moveHostToQueueTail(nextQueue, hostId);
  }

  if (failedDays.length > 0) {
    return {
      ok: false,
      error: 'EMPTY_ATTENDANCE',
      emptyDays: failedDays,
    };
  }

  // 비활성 멤버는 큐 뒤에 다시 붙이지 않음 — activeQueue만 유지
  return {
    ok: true,
    week: {
      ...week,
      assignments,
      passes: week.passes ?? {},
      confirmed: true,
    },
    hosts: nextHosts,
    queue: nextQueue,
  };
}

/**
 * 해당 주차에서 호스트가 배정된 요일을 찾는다. 없으면 null.
 */
export function findAssignedDay(week, hostId) {
  for (const day of getAvailableDays(week)) {
    if (week.assignments[day] === hostId) {
      return day;
    }
  }
  return null;
}

/**
 * 전체 주차에서 호스트 배정 슬롯을 찾는다.
 * futureOnly면 아직 지나지 않은 날짜만 대상으로 한다.
 */
export function findHostAssignment(
  weeks,
  hostId,
  { futureOnly = false, now = new Date() } = {},
) {
  for (const week of weeks) {
    if (!week.confirmed) continue;

    for (const day of getAvailableDays(week)) {
      if (week.assignments[day] !== hostId) continue;
      if (futureOnly && isDayPast(week, day, now)) continue;
      return { weekId: week.id, day, week };
    }
  }

  return null;
}

/**
 * 교체/맞교환.
 * - 지난 캘린더 날짜 배정은 수정 불가
 * - 이후 주차가 확정돼도, 미래 요일이면 주차 간 맞교환 가능
 * - 상대가 미래 요일에 배정돼 있으면 그 슬롯과 맞교환
 * - 상대가 미래 배정이 없으면 해당 요일만 교체
 */
export function swapAssignments(
  weeks,
  weekId,
  day,
  targetHostId,
  hosts,
  baseQueue,
) {
  const sourceWeek = weeks.find((w) => w.id === weekId);
  if (!sourceWeek || !sourceWeek.confirmed) {
    return { ok: false, error: 'NOT_CONFIRMED' };
  }

  const availableDays = getAvailableDays(sourceWeek);
  if (!availableDays.includes(day)) {
    return { ok: false, error: 'INVALID_DAY' };
  }

  if (isDayPast(sourceWeek, day)) {
    return { ok: false, error: 'DAY_PAST' };
  }

  const originalId = sourceWeek.assignments[day];
  if (originalId === undefined) {
    return { ok: false, error: 'NO_ASSIGNMENT' };
  }

  if (Number(targetHostId) === Number(originalId)) {
    return { ok: false, error: 'SAME_HOST' };
  }

  const hostExists = hosts.some((h) => h.id === Number(targetHostId));
  if (!hostExists) {
    return { ok: false, error: 'NOT_FOUND' };
  }

  const swapHostId = Number(targetHostId);
  const otherSlot = findHostAssignment(weeks, swapHostId, { futureOnly: true });

  // 상대의 미래 배정이 같은 (week, day)면 동일 슬롯
  if (
    otherSlot &&
    otherSlot.weekId === weekId &&
    otherSlot.day === day
  ) {
    return { ok: false, error: 'SAME_HOST' };
  }

  const affectedWeekIds = new Set([weekId]);
  if (otherSlot) {
    affectedWeekIds.add(otherSlot.weekId);
  }

  const nextWeeks = weeks.map((week) => {
    let changed = false;
    const nextAssignments = { ...week.assignments };
    const nextPasses = { ...(week.passes ?? {}) };

    if (week.id === weekId) {
      nextAssignments[day] = swapHostId;
      delete nextPasses[day];
      changed = true;
    }

    if (otherSlot && week.id === otherSlot.weekId) {
      nextAssignments[otherSlot.day] = originalId;
      delete nextPasses[otherSlot.day];
      changed = true;
    }

    if (!changed) return week;

    return {
      ...week,
      assignments: nextAssignments,
      passes: nextPasses,
    };
  });

  const replayed = replayQueueAndCounts(hosts, baseQueue, nextWeeks);

  return {
    ok: true,
    weeks: nextWeeks,
    hosts: replayed.hosts,
    queue: replayed.queue,
    affectedWeekIds: [...affectedWeekIds],
  };
}

/**
 * 확정된 Week의 다음 주 잠금을 해제한다.
 */
export function unlockNextWeek(weeks, confirmedWeekId) {
  const index = weeks.findIndex((w) => w.id === confirmedWeekId);
  if (index < 0 || index >= weeks.length - 1) {
    return weeks;
  }

  const nextIndex = index + 1;

  return weeks.map((week, i) =>
    i === nextIndex ? { ...week, isLocked: false } : week,
  );
}

/**
 * Host ID → Host 맵을 생성한다.
 */
export function createHostMap(hosts) {
  return new Map(hosts.map((host) => [host.id, host]));
}

/**
 * 출근일 대비 수행 비율(%)을 계산한다.
 */
export function calcWorkRatio(host) {
  if (!host.totalWorkingDays || host.totalWorkingDays <= 0) {
    return 0;
  }
  return Math.round((host.count / host.totalWorkingDays) * 1000) / 10;
}

/**
 * 슬랙 공유용 텍스트를 생성한다.
 */
export function formatSlackShare(week, weekNumber, hostMap) {
  const parts = getAvailableDays(week).map((day) => {
    const hostId = week.assignments[day];
    const name =
      hostId !== undefined ? (hostMap.get(hostId)?.name ?? '-') : '미배정';
    return `${DAY_LABELS[day]}: ${name}`;
  });

  return `📢 [${weekNumber}주차 호스트] ${parts.join(' | ')}`;
}

/**
 * 확정된 모든 주차의 슬랙 공유 텍스트를 생성한다.
 */
export function formatAllSlackShares(weeks, hostMap) {
  return weeks
    .map((week, index) => {
      if (!week.confirmed) return null;
      return formatSlackShare(week, index + 1, hostMap);
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * 상태를 JSON 백업 객체로 직렬화한다.
 */
export function serializeBackup(state) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    hosts: state.hosts,
    priorityQueue: state.priorityQueue,
    basePriorityQueue: state.basePriorityQueue,
    weeks: state.weeks.map((week) => ({
      ...week,
      startDate: formatDate(week.startDate),
      endDate: formatDate(week.endDate),
    })),
  };
}

/**
 * JSON 백업을 상태 객체로 파싱·검증한다.
 */
export function parseBackup(data) {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'INVALID_JSON' };
  }

  if (!Array.isArray(data.hosts) || !Array.isArray(data.priorityQueue)) {
    return { ok: false, error: 'INVALID_SCHEMA' };
  }

  const hosts = data.hosts.map((h) => ({
    id: h.id,
    name: h.name,
    count: h.count ?? 0,
    totalWorkingDays: h.totalWorkingDays ?? 0,
    active: h.active !== false,
    notionPageId: h.notionPageId ?? null,
  }));

  if (hosts.some((h) => h.id == null || !h.name)) {
    return { ok: false, error: 'INVALID_HOSTS' };
  }

  try {
    const weeks = (data.weeks ?? []).map((week) => {
      const startDate = parseDate(week.startDate);
      const endDate = parseDate(week.endDate);
      if (!startDate || !endDate) {
        throw new Error('INVALID_WEEK_DATE');
      }

      return {
        ...week,
        startDate,
        endDate,
        isLocked: week.isLocked ?? !week.unlocked,
        confirmed: Boolean(week.confirmed),
        assignments: week.assignments ?? {},
        passes: week.passes ?? {},
        attendance: week.attendance,
      };
    });

    return {
      ok: true,
      state: {
        hosts,
        priorityQueue: data.priorityQueue,
        basePriorityQueue: data.basePriorityQueue ?? [...data.priorityQueue],
        weeks,
      },
    };
  } catch {
    return { ok: false, error: 'INVALID_SCHEMA' };
  }
}
