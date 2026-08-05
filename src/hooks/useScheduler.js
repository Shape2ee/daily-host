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
  hasConfirmedAssignment,
  isWeekFrozen,
  parseBackup,
  removeHost as removeHostUtil,
  serializeBackup,
  setHostActive as setHostActiveUtil,
  swapAssignments as swapAssignmentsUtil,
  replayQueueAndCounts,
  recountFromWeeks,
  unlockNextWeek,
  updateAttendance as updateAttendanceUtil,
} from '../utils/scheduler.js';
import {
  notionMembersToHosts,
  notionSchedulesToWeeks,
} from '../utils/notionSync.js';

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

  const searchSchedule = useCallback((startDate, endDate) => {
    patchState((prev) => {
      const hostIds = getActiveHosts(prev.hosts).map((h) => h.id);
      const weeks = generateWeeks(startDate, endDate, hostIds);
      const activeQueue = filterActiveQueue(
        prev.basePriorityQueue,
        prev.hosts,
      );

      return {
        ...prev,
        hosts: prev.hosts.map((h) => ({
          ...h,
          count: 0,
          totalWorkingDays: 0,
        })),
        priorityQueue: activeQueue,
        weeks,
      };
    });
  }, [patchState]);

  /**
   * Notion 멤버(+스케줄)로 앱 상태를 hydrate한다.
   * - 큐 순서: Notion Priority / BasePriority 그대로 사용 (다른 세션과 동일)
   * - 횟수: 전체 확정 스케줄로 recount
   * - 화면 weeks: displaySchedules (당월) 기준
   */
  const hydrateFromNotion = useCallback((members, displaySchedules, allSchedules) => {
    patchState((prev) => {
      let hosts = prev.hosts;
      let priorityQueue = prev.priorityQueue;
      let basePriorityQueue = prev.basePriorityQueue;

      if (Array.isArray(members) && members.length > 0) {
        const mapped = notionMembersToHosts(members, prev.hosts);
        hosts = mapped.hosts;
        priorityQueue = mapped.priorityQueue;
        basePriorityQueue = mapped.basePriorityQueue;
      }

      const replaySource =
        allSchedules !== undefined
          ? allSchedules
          : displaySchedules !== undefined
            ? displaySchedules
            : null;

      const replaceWeeks = displaySchedules !== undefined;
      const allWeeks =
        replaySource != null
          ? notionSchedulesToWeeks(replaySource ?? [], hosts)
          : prev.weeks;
      const weeks = replaceWeeks
        ? notionSchedulesToWeeks(displaySchedules ?? [], hosts)
        : prev.weeks;

      const recounted = recountFromWeeks(hosts, allWeeks);

      return {
        hosts: recounted,
        priorityQueue: filterActiveQueue(priorityQueue, recounted),
        basePriorityQueue,
        weeks,
      };
    });
  }, [patchState]);

  const addHost = useCallback((name) => {
    const next = patchState((prev) => {
      const result = addHostUtil(
        prev.hosts,
        prev.priorityQueue,
        prev.basePriorityQueue,
        prev.weeks,
        name,
      );
      return {
        hosts: result.hosts,
        priorityQueue: result.queue,
        basePriorityQueue: result.baseQueue,
        weeks: result.weeks,
      };
    });
    return { ok: true, snapshot: next };
  }, [patchState]);

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

    return { error: null, snapshot };
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
