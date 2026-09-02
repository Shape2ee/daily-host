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
export function getMondayOfWeek(date) {
  const d = toDateOnly(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

/**
 * 캘린더 주차 키(해당 주 월요일 YYYY-MM-DD).
 * week.id 는 조회 구간에 따라 달라질 수 있어 매칭용으로 쓴다.
 */
export function getWeekMondayKey(week) {
  if (!week?.startDate) return '';
  return formatDate(getMondayOfWeek(week.startDate));
}

/**
 * 연속 확정 규칙에 맞게 isLocked 를 재계산한다.
 * — 앞선 모든 주차가 확정된 경우에만 다음 미확정 주차를 연다.
 *   (중간에만 확정 이력이 병합돼도 앞주 미확정 시 뒤주를 열지 않음)
 */
export function applySequentialLocks(weeks) {
  let allPrevConfirmed = true;

  return weeks.map((week) => {
    const isLocked = !allPrevConfirmed;
    if (!week.confirmed) {
      allPrevConfirmed = false;
    }
    return { ...week, isLocked };
  });
}

/**
 * 새로 생성한 주차 골격에 기존/외부 주차를 병합한다.
 * 같은 캘린더 주차면 확정 기록을 최우선하고, 미확정끼리는 뒤에 전달된
 * 소스(Notion 원격 상태 등)를 우선한다.
 */
export function mergeConfirmedIntoWeeks(generatedWeeks, confirmedSources = []) {
  const weekByKey = new Map();

  for (const source of confirmedSources) {
    if (!Array.isArray(source)) continue;
    for (const week of source) {
      if (!week) continue;
      const key = getWeekMondayKey(week);
      if (!key) continue;

      const existing = weekByKey.get(key);
      if (!existing) {
        weekByKey.set(key, week);
        continue;
      }

      if (existing.confirmed && !week.confirmed) continue;
      // 미확정은 확정을 덮지 못한다. 같은 상태끼리는 뒤 소스가 최신이다.
      weekByKey.set(key, week);
    }
  }

  const merged = generatedWeeks.map((generated) => {
    const mondayKey = getWeekMondayKey(generated);
    const stored = weekByKey.get(mondayKey);
    if (!stored) return generated;

    // Notion upsert 키가 조회 구간 index에 묶이지 않도록 월요일 키로 정규화
    return {
      ...stored,
      id: mondayKey || stored.id,
    };
  });

  return applySequentialLocks(merged);
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
 * 순위 점수. 복귀/신규 기준선을 실제 횟수가 따라잡으면 기준선은 무의미해진다.
 */
export function getEffectiveCount(host) {
  return Math.max(host?.count ?? 0, host?.baselineCount ?? 0);
}

/** 실제 횟수가 아직 복귀 기준선에 도달하지 못한 상태 (= 보정 중) */
export function isCountAdjusted(host) {
  return (host?.count ?? 0) < (host?.baselineCount ?? 0);
}

/**
 * 활성 멤버의 실제 진행 횟수 평균 (Math.round).
 * excludeId가 있으면 그 멤버는 평균에서 뺀다.
 */
export function getAverageActiveCount(hosts, excludeId = null) {
  const peers = getActiveHosts(hosts).filter((h) => h.id !== excludeId);
  if (peers.length === 0) return 0;
  const sum = peers.reduce((total, host) => total + (host.count ?? 0), 0);
  return Math.round(sum / peers.length);
}

function laterDate(left, right) {
  const a = left || '';
  const b = right || '';
  return a >= b ? a : b;
}

/**
 * 복귀/신규 멤버의 순위 기준선을 복귀 당일 활성 멤버 평균 횟수로 잡는다.
 * 기준선은 고정값이라 다시 계산해도 흔들리지 않고,
 * 실제 횟수가 기준선을 넘어서면 자동으로 효력을 잃는다.
 */
export function applyAverageCountBaseline(host, peerHosts, dateStr) {
  const baselineCount = getAverageActiveCount(peerHosts, host.id);
  const next = {
    ...host,
    baselineCount,
    lastHostedAt: dateStr,
  };
  return { ...next, softResetPending: isCountAdjusted(next) };
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

  for (const [mondayKey, dates] of weekMap) {
    dates.sort((a, b) => a.getTime() - b.getTime());

    weeks.push({
      // 조회 구간과 무관한 안정 키 (해당 주 월요일 YYYY-MM-DD)
      id: mondayKey,
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

  return applySequentialLocks(weeks);
}

/**
 * 활성 출근자가 0명인 요일 목록을 반환한다.
 * 비활성 멤버의 체크만으로는 "출근 있음"으로 치지 않는다.
 */
export function findEmptyAttendanceDays(week, hosts = []) {
  const activeIds = getActiveHosts(hosts).map((h) => h.id);

  return getAvailableDays(week).filter((day) => {
    const record = week.attendance?.[day] ?? {};

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
    return { ok: false, error: 'EMPTY_NAME', hosts, queue, baseQueue, weeks };
  }

  const duplicated = hosts.some(
    (h) => h.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (duplicated) {
    return {
      ok: false,
      error: 'DUPLICATE_NAME',
      hosts,
      queue,
      baseQueue,
      weeks,
    };
  }

  const nextId =
    hosts.length === 0 ? 1 : Math.max(...hosts.map((h) => h.id)) + 1;

  const newHost = applyAverageCountBaseline(
    {
      id: nextId,
      name: trimmed,
      count: 0,
      totalWorkingDays: 0,
      active: true,
      notionPageId: null,
    },
    hosts,
    formatDate(new Date()),
  );

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

  const nextHosts = [...hosts, newHost];
  return {
    ok: true,
    hosts: nextHosts,
    queue: sortQueueByPriority([...queue, nextId], nextHosts),
    baseQueue: sortQueueByPriority([...baseQueue, nextId], nextHosts),
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
 * - 비활성: 통계 유지, 큐에서 제외
 * - 재활성: 활성 멤버 평균 횟수(round)를 점수로 부여하고 마지막 진행일을 당일로 둔다.
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

  if (!active) {
    const nextHosts = hosts.map((h) =>
      h.id === hostId ? { ...h, active: false } : h,
    );

    return {
      ok: true,
      hosts: nextHosts,
      queue: queue.filter((id) => id !== hostId),
      baseQueue: baseQueue.filter((id) => id !== hostId),
      reactivated: false,
    };
  }

  const wasInactive = target.active === false;
  if (!wasInactive) {
    return {
      ok: true,
      hosts: hosts.map((h) => (h.id === hostId ? { ...h, active: true } : h)),
      queue,
      baseQueue,
      reactivated: false,
    };
  }

  const today = formatDate(new Date());
  const nextHosts = hosts.map((h) =>
    h.id === hostId
      ? applyAverageCountBaseline({ ...h, active: true }, hosts, today)
      : h,
  );
  const withHost = (q) => (q.includes(hostId) ? q : [...q, hostId]);
  const nextQueue = sortQueueByPriority(withHost(queue), nextHosts);
  const nextBase = sortQueueByPriority(withHost(baseQueue), nextHosts);
  const adjusted = nextHosts.find((h) => h.id === hostId);

  return {
    ok: true,
    hosts: nextHosts,
    queue: filterActiveQueue(nextQueue, nextHosts),
    baseQueue: filterActiveQueue(nextBase, nextHosts),
    reactivated: true,
    averageCount: adjusted?.baselineCount ?? 0,
    adjusting: isCountAdjusted(adjusted),
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
 * 횟수(보정 포함) 오름차순, 동률이면 마지막 진행일이 늦을수록 뒤.
 */
export function sortQueueByPriority(queue, hosts) {
  const byId = new Map(hosts.map((h) => [h.id, h]));
  return [...queue].sort((a, b) => {
    const hostA = byId.get(a);
    const hostB = byId.get(b);
    const countDiff = getEffectiveCount(hostA) - getEffectiveCount(hostB);
    if (countDiff !== 0) return countDiff;
    const lastA = hostA?.lastHostedAt ?? '';
    const lastB = hostB?.lastHostedAt ?? '';
    if (lastA !== lastB) return lastA < lastB ? -1 : 1;
    return (a ?? 0) - (b ?? 0);
  });
}

export function sortQueueByCount(queue, hosts) {
  return sortQueueByPriority(queue, hosts);
}

/**
 * 단일 요일 자동 배정.
 * 큐 Front부터 순회하여 당일 출근(attendance === true)인 첫 멤버를 배정한다.
 * (연속 배정 가드 없음 — 순수 Round-robin)
 */
export function assignDay(queue, attendance, day) {
  const dayAttendance = attendance?.[day] ?? {};

  for (const hostId of queue) {
    if (dayAttendance[hostId] === true) {
      return hostId;
    }
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
      const dayAttendance = week.attendance?.[day] ?? {};

      nextHosts = nextHosts.map((host) =>
        dayAttendance[host.id] === true
          ? { ...host, totalWorkingDays: host.totalWorkingDays + 1 }
          : host,
      );

      const assignedId = week.assignments?.[day];
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
 * count / totalWorkingDays / lastHostedAt / priorityQueue를 재계산한다.
 * baselineCount는 Notion/로컬에 저장된 값을 유지한다.
 */
export function replayQueueAndCounts(hosts, baseQueue, weeks) {
  const storedLastById = new Map(
    hosts.map((h) => [h.id, h.lastHostedAt ?? '']),
  );

  let nextHosts = hosts.map((h) => ({
    ...h,
    count: 0,
    totalWorkingDays: 0,
    lastHostedAt: '',
  }));

  let nextQueue = filterActiveQueue(baseQueue, hosts);

  for (const week of weeks) {
    if (!week.confirmed) continue;

    for (const day of getAvailableDays(week)) {
      const dayAttendance = week.attendance?.[day] ?? {};

      nextHosts = nextHosts.map((host) =>
        dayAttendance[host.id] === true
          ? { ...host, totalWorkingDays: host.totalWorkingDays + 1 }
          : host,
      );

      const assignedId = week.assignments?.[day];
      if (assignedId !== undefined) {
        const dayDate = getDateForDay(week, day);
        const dayKey = dayDate ? formatDate(dayDate) : '';

        nextHosts = nextHosts.map((host) =>
          host.id === assignedId
            ? {
                ...host,
                count: host.count + 1,
                lastHostedAt: laterDate(host.lastHostedAt, dayKey),
              }
            : host,
        );

        if (nextQueue.includes(assignedId)) {
          nextQueue = moveHostToQueueTail(nextQueue, assignedId);
        }
      }
    }
  }

  nextHosts = nextHosts.map((host) => ({
    ...host,
    lastHostedAt: laterDate(storedLastById.get(host.id), host.lastHostedAt),
    softResetPending: isCountAdjusted(host),
  }));

  nextQueue = sortQueueByPriority(nextQueue, nextHosts);

  return { hosts: nextHosts, queue: nextQueue };
}

/**
 * 주차 자동 배정 + 확정.
 * 요일마다 큐 Front부터 출근자를 배정하고 Tail로 보낸다.
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

  for (const day of availableDays) {
    const hostId = assignDay(nextQueue, week.attendance, day);

    if (hostId === undefined) {
      failedDays.push(day);
      continue;
    }

    assignments[day] = hostId;

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
        const dayDate = getDateForDay(week, day);
        updated = {
          ...updated,
          count: updated.count + 1,
          lastHostedAt: dayDate
            ? laterDate(updated.lastHostedAt, formatDate(dayDate))
            : updated.lastHostedAt,
        };
      }

      return updated;
    });

    nextQueue = moveHostToQueueTail(nextQueue, hostId);
    nextQueue = sortQueueByPriority(nextQueue, nextHosts);
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
 * 확정 후 연속 잠금 규칙을 다시 적용한다.
 */
export function unlockNextWeek(weeks, _confirmedWeekId) {
  return applySequentialLocks(weeks);
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
 * 슬랙 공유용 텍스트를 생성한다. (날짜 구간 기준, 주차 번호 없음)
 */
export function formatSlackShare(week, hostMap) {
  const parts = getAvailableDays(week).map((day) => {
    const hostId = week.assignments[day];
    const name =
      hostId !== undefined ? (hostMap.get(hostId)?.name ?? '-') : '미배정';
    return `${DAY_LABELS[day]}: ${name}`;
  });

  const period = `${formatDate(week.startDate)}~${formatDate(week.endDate)}`;
  return `📢 [${period} 호스트] ${parts.join(' | ')}`;
}

/**
 * 확정된 모든 주차의 슬랙 공유 텍스트를 생성한다.
 */
export function formatAllSlackShares(weeks, hostMap) {
  return weeks
    .map((week) => {
      if (!week.confirmed) return null;
      return formatSlackShare(week, hostMap);
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
    weeks: state.weeks.map((week) => {
      const mondayKey = getWeekMondayKey(week);
      return {
        ...week,
        id: mondayKey || week.id,
        startDate: formatDate(week.startDate),
        endDate: formatDate(week.endDate),
      };
    }),
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

  const hosts = data.hosts.map((h) => {
    const count = h.count ?? 0;
    const host = {
      id: h.id,
      name: h.name,
      count,
      totalWorkingDays: h.totalWorkingDays ?? 0,
      active: h.active !== false,
      baselineCount: h.baselineCount ?? count + (h.countAdjustment ?? 0),
      lastHostedAt: h.lastHostedAt ?? '',
      notionPageId: h.notionPageId ?? null,
    };
    return { ...host, softResetPending: isCountAdjusted(host) };
  });

  if (hosts.some((h) => h.id == null || !h.name)) {
    return { ok: false, error: 'INVALID_HOSTS' };
  }

  try {
    const hostIds = hosts.map((h) => h.id);
    const weeks = (data.weeks ?? []).map((week) => {
      const startDate = parseDate(week.startDate);
      const endDate = parseDate(week.endDate);
      if (!startDate || !endDate) {
        throw new Error('INVALID_WEEK_DATE');
      }

      const mondayKey = formatDate(getMondayOfWeek(startDate));
      const attendance =
        week.attendance && typeof week.attendance === 'object'
          ? week.attendance
          : createDefaultAttendance(hostIds);

      return {
        ...week,
        id: mondayKey || week.id,
        startDate,
        endDate,
        isLocked: week.isLocked ?? !week.unlocked,
        confirmed: Boolean(week.confirmed),
        assignments: week.assignments ?? {},
        passes: week.passes ?? {},
        attendance,
      };
    });

    return {
      ok: true,
      state: {
        hosts,
        priorityQueue: data.priorityQueue,
        basePriorityQueue: data.basePriorityQueue ?? [...data.priorityQueue],
        weeks: applySequentialLocks(weeks),
      },
    };
  } catch {
    return { ok: false, error: 'INVALID_SCHEMA' };
  }
}
