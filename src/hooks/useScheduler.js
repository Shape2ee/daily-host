import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createInitialState,
  MIN_HOST_COUNT,
  STORAGE_KEY,
} from '../constants/hosts.js';
import {
  addHost as addHostUtil,
  assignWeek as assignWeekUtil,
  createHostMap,
  filterActiveQueue,
  generateWeeks,
  getActiveHosts,
  getWeekMondayKey,
  hasConfirmedAssignment,
  insertAtAveragePriority,
  isWeekFrozen,
  mergeConfirmedIntoWeeks,
  parseBackup,
  removeHost as removeHostUtil,
  serializeBackup,
  setHostActive as setHostActiveUtil,
  swapAssignments as swapAssignmentsUtil,
  replayQueueAndCounts,
  unlockNextWeek,
  updateAttendance as updateAttendanceUtil,
} from '../utils/scheduler.js';
import {
  notionMembersToHosts,
  notionSchedulesToWeeks,
} from '../utils/notionSync.js';

/**
 * 확정 주차를 캘린더 월요일 키 기준으로 중복 제거 후 시간순 정렬한다.
 */
function uniqueConfirmedWeeksSorted(weeks) {
  const seen = new Set();
  const unique = [];
  for (const week of weeks ?? []) {
    if (!week?.confirmed) continue;
    const key = getWeekMondayKey(week);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(week);
  }
  unique.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  return unique;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    const parsed = parseBackup(JSON.parse(raw));
    return parsed.ok ? parsed.state : createInitialState();
  } catch {
    return createInitialState();
  }
}

/**
 * 스케줄러 상태와 비즈니스 액션을 관리하는 Custom Hook.
 * 모든 상태 변화는 localStorage에 자동 저장된다.
 */
export function useScheduler() {
  const [state, setState] = useState(loadState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const commitState = useCallback((next) => {
    stateRef.current = next;
    setState(next);
    return next;
  }, []);

  const patchState = useCallback(
    (updater) => {
      const prev = stateRef.current;
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return commitState(next);
    },
    [commitState],
  );

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(serializeBackup(state)),
      );
    } catch {
      // storage quota / private mode — ignore
    }
  }, [state]);

  const hostMap = useMemo(
    () => createHostMap(state.hosts),
    [state.hosts],
  );

  /**
   * 일정 조회: 주차 골격을 만든 뒤, 같은 기간의 확정 기록이 있으면 병합한다.
   * @param {string} startDate
   * @param {string} endDate
   * @param {{ extraConfirmedWeeks?: object[], replayWeeks?: object[] }} [options]
   *   - extraConfirmedWeeks: Notion 등 외부 확정 주차
   *   - replayWeeks: 횟수/큐 재계산에 쓸 전체 확정 주차(미지정 시 화면 weeks)
   */
  const searchSchedule = useCallback((startDate, endDate, options = {}) => {
    const extraConfirmedWeeks = options.extraConfirmedWeeks ?? [];
    const replayWeeksOption = options.replayWeeks;

    patchState((prev) => {
      const hostIds = getActiveHosts(prev.hosts).map((h) => h.id);
      const generated = generateWeeks(startDate, endDate, hostIds);
      const weeks = mergeConfirmedIntoWeeks(generated, [
        prev.weeks,
        extraConfirmedWeeks,
      ]);

      const replaySource =
        replayWeeksOption !== undefined
          ? replayWeeksOption
          : [
              ...prev.weeks.filter((w) => w.confirmed),
              ...extraConfirmedWeeks.filter((w) => w.confirmed),
              ...weeks.filter((w) => w.confirmed),
            ];

      const replayed = replayQueueAndCounts(
        prev.hosts,
        prev.basePriorityQueue,
        uniqueConfirmedWeeksSorted(replaySource),
      );

      return {
        ...prev,
        hosts: replayed.hosts,
        priorityQueue: replayed.queue,
        weeks,
      };
    });
  }, [patchState]);

  /**
   * Notion 멤버(+스케줄)로 앱 상태를 hydrate한다.
   * - Active / BasePriority: Notion Members
   * - priorityQueue: BasePriority 위에서 확정 Schedule을 시간순 Replay한 결과
   *   (Notion Priority 필드를 그대로 쓰지 않음 — stale Priority 방지)
   * - Notion에서 InActive→Active 로 바뀐 멤버는 Soft Reset 적용
   * - 화면 weeks: displaySchedules (당월) 기준
   */
  const hydrateFromNotion = useCallback((members, displaySchedules, allSchedules) => {
    patchState((prev) => {
      let hosts = prev.hosts;
      let basePriorityQueue = prev.basePriorityQueue;

      if (Array.isArray(members) && members.length > 0) {
        // Notion 멤버가 소스 오브 트루스 — 로컬 샘플/잔존 멤버와 합치지 않음
        const mapped = notionMembersToHosts(members, prev.hosts);
        hosts = mapped.hosts;
        basePriorityQueue = mapped.basePriorityQueue;

        // Notion Active 상태 기준으로 재활성 Soft Reset
        const prevById = new Map(prev.hosts.map((h) => [h.id, h]));
        const reactivatedIds = [];

        hosts = hosts.map((h) => {
          const prevHost = prevById.get(h.id);
          const wasInactive = prevHost?.active === false;
          const nowActive = h.active !== false;

          if (wasInactive && nowActive) {
            reactivatedIds.push(h.id);
            return { ...h, softResetPending: true };
          }

          if (nowActive && prevHost?.softResetPending) {
            return { ...h, softResetPending: true };
          }

          return { ...h, softResetPending: false };
        });

        if (reactivatedIds.length > 0) {
          basePriorityQueue = basePriorityQueue.filter(
            (id) => !reactivatedIds.includes(id),
          );

          for (const hostId of reactivatedIds) {
            const b = insertAtAveragePriority(
              basePriorityQueue,
              hostId,
              basePriorityQueue,
            );
            basePriorityQueue = b.queue;
          }
        }
      }

      const replaySource =
        allSchedules !== undefined
          ? allSchedules
          : displaySchedules !== undefined
            ? displaySchedules
            : null;

      const replaceWeeks = displaySchedules !== undefined;
      const scheduleWeeks =
        replaySource != null
          ? notionSchedulesToWeeks(replaySource ?? [], hosts)
          : null;
      const weeks = replaceWeeks
        ? notionSchedulesToWeeks(displaySchedules ?? [], hosts)
        : prev.weeks;

      const replayWeeks = uniqueConfirmedWeeksSorted(
        scheduleWeeks ?? prev.weeks,
      );

      const replayed = replayQueueAndCounts(
        hosts,
        basePriorityQueue,
        replayWeeks,
      );

      return {
        hosts: replayed.hosts.map((h) => {
          const withFlag = hosts.find((x) => x.id === h.id);
          return {
            ...h,
            softResetPending: Boolean(withFlag?.softResetPending),
          };
        }),
        priorityQueue: filterActiveQueue(replayed.queue, replayed.hosts),
        basePriorityQueue: filterActiveQueue(basePriorityQueue, replayed.hosts),
        weeks,
      };
    });
  }, [patchState]);

  const addHost = useCallback((name) => {
    const prev = stateRef.current;
    const result = addHostUtil(
      prev.hosts,
      prev.priorityQueue,
      prev.basePriorityQueue,
      prev.weeks,
      name,
    );

    if (!result.ok) {
      return { error: result.error };
    }

    const snapshot = {
      hosts: result.hosts,
      priorityQueue: result.queue,
      basePriorityQueue: result.baseQueue,
      weeks: result.weeks,
    };
    commitState(snapshot);
    return { ok: true, snapshot };
  }, [commitState]);

  const canRemoveHost = useCallback(
    (hostId) => {
      const { hosts, weeks } = stateRef.current;
      const activeCount = getActiveHosts(hosts).length;
      const target = hosts.find((h) => h.id === hostId);
      if (!target) return false;

      if (target.active === false) {
        return !hasConfirmedAssignment(weeks, hostId);
      }

      if (activeCount <= MIN_HOST_COUNT) {
        return false;
      }
      return !hasConfirmedAssignment(weeks, hostId);
    },
    [],
  );

  const removeHost = useCallback((hostId) => {
    const prev = stateRef.current;
    const result = removeHostUtil(
      prev.hosts,
      prev.priorityQueue,
      prev.basePriorityQueue,
      prev.weeks,
      hostId,
    );

    if (!result.ok) {
      return { error: result.error };
    }

    commitState({
      hosts: result.hosts,
      priorityQueue: result.queue,
      basePriorityQueue: result.baseQueue,
      weeks: result.weeks,
    });

    return {
      error: null,
      snapshot: {
        hosts: result.hosts,
        priorityQueue: result.queue,
        basePriorityQueue: result.baseQueue,
        weeks: result.weeks,
      },
    };
  }, [commitState]);

  const setHostActive = useCallback((hostId, active) => {
    const prev = stateRef.current;
    const result = setHostActiveUtil(
      prev.hosts,
      prev.priorityQueue,
      prev.basePriorityQueue,
      hostId,
      active,
    );

    if (!result.ok) {
      return { error: result.error };
    }

    const snapshot = {
      ...prev,
      hosts: result.hosts,
      priorityQueue: result.queue,
      basePriorityQueue: result.baseQueue,
    };
    commitState(snapshot);

    return {
      error: null,
      snapshot,
      reactivated: Boolean(result.reactivated),
      averagePriority: result.averagePriority,
    };
  }, [commitState]);

  const updateAttendance = useCallback((weekId, hostId, day, present) => {
    patchState((prev) => ({
      ...prev,
      weeks: updateAttendanceUtil(prev.weeks, weekId, hostId, day, present),
    }));
  }, [patchState]);

  const confirmAndAssignWeek = useCallback((weekId) => {
    const prev = stateRef.current;
    const target = prev.weeks.find((w) => w.id === weekId);
    if (!target || target.confirmed || target.isLocked) {
      return { error: 'NOT_CONFIRMABLE' };
    }

    const assigned = assignWeekUtil(
      target,
      prev.hosts,
      prev.priorityQueue,
    );

    if (!assigned.ok) {
      return {
        error: assigned.error,
        emptyDays: assigned.emptyDays ?? [],
      };
    }

    const weeksWithAssignment = prev.weeks.map((w) =>
      w.id === weekId ? assigned.week : w,
    );
    const snapshot = {
      hosts: assigned.hosts,
      priorityQueue: assigned.queue,
      basePriorityQueue: prev.basePriorityQueue,
      weeks: unlockNextWeek(weeksWithAssignment, weekId),
    };

    commitState(snapshot);
    return { ok: true, snapshot, weekId };
  }, [commitState]);

  const swapAssignments = useCallback((weekId, day, targetHostId) => {
    const prev = stateRef.current;
    const result = swapAssignmentsUtil(
      prev.weeks,
      weekId,
      day,
      targetHostId,
      prev.hosts,
      prev.basePriorityQueue,
    );

    if (!result.ok) {
      return { error: result.error };
    }

    const snapshot = {
      hosts: result.hosts,
      priorityQueue: result.queue,
      basePriorityQueue: prev.basePriorityQueue,
      weeks: result.weeks,
    };

    commitState(snapshot);
    return {
      ok: true,
      snapshot,
      weekId,
      affectedWeekIds: result.affectedWeekIds ?? [weekId],
    };
  }, [commitState]);

  const resetAll = useCallback(() => {
    const prev = stateRef.current;
    const hosts = prev.hosts.map((h) => ({
      ...h,
      count: 0,
      totalWorkingDays: 0,
    }));

    const snapshot = {
      hosts,
      priorityQueue: filterActiveQueue(
        prev.basePriorityQueue,
        hosts,
      ),
      basePriorityQueue: prev.basePriorityQueue,
      weeks: [],
    };

    commitState(snapshot);
    return { ok: true, snapshot };
  }, [commitState]);

  /** JSON 파일로 내보내기 */
  const exportData = useCallback(() => {
    const backup = serializeBackup(state);
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    anchor.href = url;
    anchor.download = `daily-host-backup-${stamp}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [state]);

  /** JSON 파일 불러오기 */
  const importData = useCallback((jsonText) => {
    try {
      const data = JSON.parse(jsonText);
      const parsed = parseBackup(data);
      if (!parsed.ok) {
        return parsed.error;
      }
      commitState(parsed.state);
      return null;
    } catch {
      return 'INVALID_JSON';
    }
  }, [commitState]);

  return {
    hosts: state.hosts,
    priorityQueue: state.priorityQueue,
    basePriorityQueue: state.basePriorityQueue,
    weeks: state.weeks,
    hostMap,
    searchSchedule,
    hydrateFromNotion,
    addHost,
    removeHost,
    canRemoveHost,
    setHostActive,
    updateAttendance,
    confirmAndAssignWeek,
    swapAssignments,
    isWeekFrozen: (weekId) => isWeekFrozen(state.weeks, weekId),
    resetAll,
    exportData,
    importData,
    minHostCount: MIN_HOST_COUNT,
  };
}
