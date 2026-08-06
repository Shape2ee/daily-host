import { useCallback, useEffect, useRef, useState } from "react";
import { DAY_LABELS, NOTION_PENDING_KEY } from "../../constants/hosts";
import { useScheduler } from "../../hooks/useScheduler";
import {
  clearNotionSchedules,
  fetchNotionMembers,
  fetchNotionSchedules,
  pushNotionMembers,
  upsertNotionSchedules,
} from "../../api/notion";
import {
  calcWorkRatio,
  createHostMap,
  formatAllSlackShares,
} from "../../utils/scheduler";
import {
  buildMembersPayload,
  buildSchedulePayload,
  filterSchedulesByDateRange,
  filterSchedulesByMonth,
  getMonthRange,
  notionSchedulesToWeeks,
} from "../../utils/notionSync";
import { ConfirmModal } from "../ConfirmModal/ConfirmModal";
import { DateSearchForm } from "../DateSearchForm/DateSearchForm";
import { HostManagementPanel } from "../HostManagementPanel/HostManagementPanel";
import { NotionSyncPanel } from "../NotionSyncPanel/NotionSyncPanel";
import { ScheduleContainer } from "../ScheduleContainer/ScheduleContainer";
import styles from "./Dashboard.module.scss";

function readNotionPending() {
  try {
    return localStorage.getItem(NOTION_PENDING_KEY) === "1";
  } catch {
    return false;
  }
}

const REMOVE_ERROR_MESSAGES = {
  MIN_HOSTS: "최소 활성 2명 이상 유지해야 하므로 삭제할 수 없습니다.",
  HAS_ASSIGNMENT: "확정된 일정에 배정된 호스트는 삭제할 수 없습니다.",
  NOT_FOUND: "호스트를 찾을 수 없습니다.",
};

const ACTIVE_ERROR_MESSAGES = {
  MIN_HOSTS: "활성 호스트는 최소 2명 이상이어야 합니다.",
  NOT_FOUND: "호스트를 찾을 수 없습니다.",
};

const SWAP_ERROR_MESSAGES = {
  NOT_CONFIRMED: "확정된 주차만 맞교환할 수 있습니다.",
  SAME_HOST: "같은 호스트로는 교환할 수 없습니다.",
  NO_ASSIGNMENT: "해당 요일에 배정된 호스트가 없습니다.",
  NOT_FOUND: "상대 호스트를 찾을 수 없습니다.",
  INVALID_DAY: "유효하지 않은 요일입니다.",
  DAY_PAST: "이미 지난 날짜는 교환할 수 없습니다.",
  TARGET_DAY_PAST: "이미 지난 요일 담당자와는 교환할 수 없습니다.",
};

const IMPORT_ERROR_MESSAGES = {
  INVALID_JSON: "유효한 JSON 파일이 아닙니다.",
  INVALID_SCHEMA: "백업 스키마가 올바르지 않습니다.",
  INVALID_HOSTS: "호스트 데이터가 올바르지 않습니다.",
};

/**
 * @returns {{ ok: true, skipped?: boolean, created?: number, updated?: number } | { ok: false, error: string }}
 */
async function syncWeeksToNotion(
  weeks,
  hosts,
  showToast,
  label = 'Notion 히스토리 동기화',
  weekIds = null,
) {
  const map = createHostMap(hosts);
  let payload = buildSchedulePayload(weeks, map);
  if (weekIds != null) {
    const idSet = new Set(Array.isArray(weekIds) ? weekIds : [weekIds]);
    payload = payload.filter((item) => idSet.has(item.weekKey));
  }
  if (payload.length === 0) {
    return { ok: true, skipped: true, created: 0, updated: 0 };
  }

  try {
    const data = await upsertNotionSchedules(payload);
    showToast(`${label} · 생성 ${data.created} / 갱신 ${data.updated}`);
    return { ok: true, ...data };
  } catch (error) {
    showToast(`Notion 동기화 실패: ${error.message}`);
    return { ok: false, error: error.message };
  }
}

/**
 * @returns {{ ok: true, count?: number } | { ok: false, error: string }}
 */
async function syncMembersPriorityToNotion(
  hosts,
  priorityQueue,
  basePriorityQueue,
  { silent = false, showToast } = {},
) {
  try {
    const payload = buildMembersPayload(
      hosts,
      priorityQueue,
      basePriorityQueue,
    );
    const data = await pushNotionMembers(payload);
    if (!silent) {
      showToast?.(`멤버·Active·우선순위 Notion 반영 · ${data.count}명`);
    }
    return { ok: true, count: data.count };
  } catch (error) {
    showToast?.(`멤버 Notion 동기화 실패: ${error.message}`);
    return { ok: false, error: error.message };
  }
}

/**
 * Admin Dashboard 레이아웃.
 */
export function Dashboard() {
  const {
    hosts,
    priorityQueue,
    basePriorityQueue,
    weeks,
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
    resetAll,
    exportData,
    importData,
  } = useScheduler();

  const [newHostName, setNewHostName] = useState("");
  const [toast, setToast] = useState(null);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [notionBusy, setNotionBusy] = useState(false);
  const [historyTick, setHistoryTick] = useState(0);
  const [monthBootstrapping, setMonthBootstrapping] = useState(true);
  const [notionSyncPending, setNotionSyncPending] = useState(readNotionPending);
  const fileInputRef = useRef(null);
  const toastTimerRef = useRef(null);

  const showToast = (message) => {
    setToast(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3200);
  };

  const markNotionPending = useCallback(() => {
    setNotionSyncPending(true);
    try {
      localStorage.setItem(NOTION_PENDING_KEY, "1");
    } catch {
      // ignore
    }
  }, []);

  const clearNotionPending = useCallback(() => {
    setNotionSyncPending(false);
    try {
      localStorage.removeItem(NOTION_PENDING_KEY);
    } catch {
      // ignore
    }
  }, []);

  // 실패 시 pending 표시만. 성공 clear는 호출측에서 (weeks+members 모두 성공 시)
  const trackMemberSync = useCallback(
    async (...args) => {
      const result = await syncMembersPriorityToNotion(...args);
      if (!result.ok) markNotionPending();
      return result;
    },
    [markNotionPending],
  );

  const trackWeekSync = useCallback(
    async (...args) => {
      const result = await syncWeeksToNotion(...args);
      if (!result.ok) markNotionPending();
      return result;
    },
    [markNotionPending],
  );

  // 첫 진입: Notion 멤버 + 당월 확정 스케줄 hydrate
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { month } = getMonthRange();
      try {
        const [membersResult, schedulesResult] = await Promise.allSettled([
          fetchNotionMembers(),
          fetchNotionSchedules(),
        ]);
        if (cancelled) return;

        const members =
          membersResult.status === 'fulfilled'
            ? (membersResult.value.members ?? [])
            : [];
        const schedules =
          schedulesResult.status === 'fulfilled'
            ? (schedulesResult.value.schedules ?? [])
            : [];
        const monthSchedules = filterSchedulesByMonth(schedules, new Date());

        if (members.length > 0 || monthSchedules.length > 0) {
          hydrateFromNotion(members, monthSchedules, schedules);
        }

        const parts = [];
        if (members.length > 0) parts.push(`멤버 ${members.length}명`);
        if (monthSchedules.length > 0) {
          parts.push(`${month}월 주차 ${monthSchedules.length}건`);
        }
        if (parts.length > 0) {
          showToast(`Notion에서 ${parts.join(' · ')} 불러옴`);
        }
      } catch {
        // Notion 실패 시 localStorage 유지
      } finally {
        if (!cancelled) setMonthBootstrapping(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시 1회
  }, []);

  const handleSearch = async (startDate, endDate) => {
    // 로컬 확정 주차는 searchSchedule 내부에서 먼저 병합
    searchSchedule(startDate, endDate);

    try {
      const result = await fetchNotionSchedules();
      const schedules = result.schedules ?? [];
      const inRange = filterSchedulesByDateRange(
        schedules,
        startDate,
        endDate,
      );
      if (inRange.length === 0) return;

      const extraConfirmedWeeks = notionSchedulesToWeeks(inRange, hosts);
      const allConfirmedWeeks = notionSchedulesToWeeks(schedules, hosts);
      searchSchedule(startDate, endDate, {
        extraConfirmedWeeks,
        replayWeeks: allConfirmedWeeks,
      });
    } catch {
      // Notion 실패 시 로컬 병합 결과 유지
    }
  };

  const handlePushSchedules = async (label) => {
    setNotionBusy(true);
    try {
      const weeksResult = await trackWeekSync(weeks, hosts, showToast, label);
      const membersResult = await trackMemberSync(
        hosts,
        priorityQueue,
        basePriorityQueue,
        { silent: true, showToast },
      );
      if (weeksResult.ok && membersResult.ok) {
        clearNotionPending();
        if (!weeksResult.skipped) setHistoryTick((n) => n + 1);
      } else {
        markNotionPending();
      }
      return weeksResult;
    } finally {
      setNotionBusy(false);
    }
  };

  const handleResyncNotion = async () => {
    setNotionBusy(true);
    showToast("Notion 재동기화 중…");
    try {
      const membersResult = await syncMembersPriorityToNotion(
        hosts,
        priorityQueue,
        basePriorityQueue,
        { silent: true, showToast },
      );
      const weeksResult = await syncWeeksToNotion(
        weeks,
        hosts,
        showToast,
        "미동기화 재동기화",
      );
      if (membersResult.ok && weeksResult.ok) {
        clearNotionPending();
        if (!weeksResult.skipped) setHistoryTick((n) => n + 1);
        showToast("Notion 재동기화 완료.");
      } else {
        markNotionPending();
        showToast("Notion 재동기화 실패. 잠시 후 다시 시도하세요.");
      }
    } finally {
      setNotionBusy(false);
    }
  };

  const handleAddHost = async (name) => {
    if (!name.trim()) {
      showToast("호스트 이름을 입력하세요.");
      return;
    }
    const result = addHost(name);
    if (result?.error === 'DUPLICATE_NAME') {
      showToast("같은 이름의 호스트가 이미 있습니다.");
      return;
    }
    if (result?.error || !result?.ok) {
      showToast("호스트 추가에 실패했습니다.");
      return;
    }
    setNewHostName("");
    showToast(`"${name.trim()}" 호스트가 추가되었습니다.`);
    if (result?.snapshot) {
      const synced = await trackMemberSync(
        result.snapshot.hosts,
        result.snapshot.priorityQueue,
        result.snapshot.basePriorityQueue,
        { silent: true, showToast },
      );
      if (synced.ok) clearNotionPending();
    }
  };

  const handleRemoveHost = async (hostId) => {
    const result = removeHost(hostId);
    if (result?.error) {
      showToast(REMOVE_ERROR_MESSAGES[result.error] ?? "삭제에 실패했습니다.");
      return;
    }
    showToast("호스트가 삭제되었습니다.");
    if (result?.snapshot) {
      const synced = await trackMemberSync(
        result.snapshot.hosts,
        result.snapshot.priorityQueue,
        result.snapshot.basePriorityQueue,
        { silent: true, showToast },
      );
      if (synced.ok) clearNotionPending();
    }
  };

  const handleToggleActive = async (hostId, active) => {
    const result = setHostActive(hostId, active);
    if (result?.error) {
      showToast(ACTIVE_ERROR_MESSAGES[result.error] ?? "상태 변경에 실패했습니다.");
      return;
    }

    let localMessage;
    if (!active) {
      localMessage = "호스트가 비활성화되었습니다.";
    } else if (result?.reactivated && result.averagePriority != null) {
      const avgRank = result.averagePriority + 1;
      localMessage = `재활성화된 멤버의 우선순위가 현재 활성 멤버들의 평균 점수(${avgRank})로 보정되었습니다.`;
    } else {
      localMessage = "호스트가 활성화되었습니다.";
    }

    showToast(`${localMessage} Notion 반영 중…`);

    if (result?.snapshot) {
      const synced = await trackMemberSync(
        result.snapshot.hosts,
        result.snapshot.priorityQueue,
        result.snapshot.basePriorityQueue,
        { silent: true, showToast },
      );
      if (synced.ok) {
        clearNotionPending();
        showToast(`${localMessage} Notion Active 반영 완료.`);
      }
    }
  };

  const handleConfirm = async (weekId) => {
    const result = confirmAndAssignWeek(weekId);
    if (result?.error === 'EMPTY_ATTENDANCE') {
      const days = (result.emptyDays ?? [])
        .map((d) => DAY_LABELS[d] ?? d)
        .join(', ');
      showToast(`출근자가 없는 요일이 있어 확정할 수 없습니다. (${days})`);
      return;
    }
    if (!result?.ok || !result?.snapshot) {
      showToast('주차를 확정할 수 없습니다.');
      return;
    }

    showToast('주차가 확정되었습니다. Notion 동기화 중…');
    setNotionBusy(true);
    try {
      const weeksResult = await trackWeekSync(
        result.snapshot.weeks,
        result.snapshot.hosts,
        showToast,
        '주차 확정 · Notion 동기화',
        weekId,
      );
      const membersResult = await trackMemberSync(
        result.snapshot.hosts,
        result.snapshot.priorityQueue,
        result.snapshot.basePriorityQueue,
        { silent: true, showToast },
      );
      if (weeksResult.ok && membersResult.ok) {
        clearNotionPending();
        if (!weeksResult.skipped) setHistoryTick((n) => n + 1);
      } else {
        markNotionPending();
      }
    } finally {
      setNotionBusy(false);
    }
  };

  const handleSwap = async (weekId, day, targetHostId) => {
    const result = swapAssignments(weekId, day, targetHostId);
    if (result?.error) {
      showToast(SWAP_ERROR_MESSAGES[result.error] ?? '맞교환에 실패했습니다.');
      return;
    }
    showToast('교체/맞교환 반영. Notion 동기화 중…');
    setNotionBusy(true);
    try {
      const weeksResult = await trackWeekSync(
        result.snapshot.weeks,
        result.snapshot.hosts,
        showToast,
        '맞교환 · Notion 동기화',
        result.affectedWeekIds ?? [weekId],
      );
      const membersResult = await trackMemberSync(
        result.snapshot.hosts,
        result.snapshot.priorityQueue,
        result.snapshot.basePriorityQueue,
        { silent: true, showToast },
      );
      if (weeksResult.ok && membersResult.ok) {
        clearNotionPending();
        if (!weeksResult.skipped) setHistoryTick((n) => n + 1);
      } else {
        markNotionPending();
      }
    } finally {
      setNotionBusy(false);
    }
  };

  const handleCopySlack = async () => {
    const text = formatAllSlackShares(weeks, hostMap);
    if (!text) {
      showToast("확정된 주차가 없습니다.");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      showToast("슬랙 공유용 텍스트가 복사되었습니다.");
    } catch {
      showToast("클립보드 복사에 실패했습니다.");
    }
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      const error = importData(text);
      if (error) {
        showToast(IMPORT_ERROR_MESSAGES[error] ?? "불러오기에 실패했습니다.");
        return;
      }
      showToast("백업 데이터를 불러왔습니다.");
    } catch {
      showToast("파일을 읽을 수 없습니다.");
    }
  };

  const handleResetConfirm = async () => {
    setIsResetOpen(false);
    const { start, end, month } = getMonthRange();
    const result = resetAll();
    setNotionBusy(true);
    try {
      const data = await clearNotionSchedules({ start, end });
      let membersOk = true;
      if (result?.snapshot) {
        const membersResult = await trackMemberSync(
          result.snapshot.hosts,
          result.snapshot.priorityQueue,
          result.snapshot.basePriorityQueue,
          { silent: true, showToast },
        );
        membersOk = membersResult.ok;
      }
      if (membersOk) {
        clearNotionPending();
        showToast(
          `일정/횟수 초기화 · Notion ${month}월 ${data.archived ?? 0}건 삭제`,
        );
      } else {
        markNotionPending();
        showToast(
          `로컬은 초기화되었습니다. Notion 멤버 동기화는 실패했습니다.`,
        );
      }
      setHistoryTick((n) => n + 1);
    } catch (error) {
      markNotionPending();
      showToast(
        `로컬은 초기화되었습니다. Notion 동기화 실패: ${error.message}`,
      );
    } finally {
      setNotionBusy(false);
    }
  };

  return (
    <div className={styles.dashboard}>
      <header className={styles.topBar}>
        <div>
          <p className={styles.eyebrow}>Daily Host Scheduler Pro</p>
          <h1 className={styles.heading}>데일리 호스트 자동 배정 시스템</h1>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.meta}>
            <span>호스트 {hosts.length}명</span>
            {notionSyncPending && (
              <span className={styles.pendingBadge}>미동기화 변경사항 존재</span>
            )}
          </div>
          {notionSyncPending && (
            <button
              type="button"
              className={styles.resyncButton}
              disabled={notionBusy}
              onClick={handleResyncNotion}
            >
              Notion 재동기화
            </button>
          )}
          <button
            type="button"
            className={styles.backupButton}
            onClick={exportData}
          >
            데이터 내보내기
          </button>
          <button
            type="button"
            className={styles.backupButton}
            onClick={() => fileInputRef.current?.click()}
          >
            데이터 불러오기
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className={styles.hiddenInput}
            onChange={handleImportFile}
          />
          <button
            type="button"
            className={styles.resetButton}
            onClick={() => setIsResetOpen(true)}
          >
            일정/횟수 초기화
          </button>
        </div>
      </header>

      <div className={styles.layout}>
        <div className={styles.sidebar}>
          <HostManagementPanel
            hosts={hosts}
            priorityQueue={priorityQueue}
            hostMap={hostMap}
            canRemoveHost={canRemoveHost}
            onAddHost={handleAddHost}
            onRemoveHost={handleRemoveHost}
            onToggleActive={handleToggleActive}
            newHostName={newHostName}
            onNewHostNameChange={setNewHostName}
            calcWorkRatio={calcWorkRatio}
          />
        </div>

        <main className={styles.main}>
          <DateSearchForm onSearch={handleSearch} />
          <NotionSyncPanel
            hosts={hosts}
            priorityQueue={priorityQueue}
            basePriorityQueue={basePriorityQueue}
            busy={notionBusy}
            historyTick={historyTick}
            onPushSchedules={() => handlePushSchedules("확정 주차 동기화")}
            onLoadMembers={(members, schedules) =>
              hydrateFromNotion(members, undefined, schedules)
            }
            onToast={showToast}
          />
          <ScheduleContainer
            weeks={weeks}
            hosts={hosts}
            hostMap={hostMap}
            loading={monthBootstrapping}
            onUpdateAttendance={updateAttendance}
            onConfirm={handleConfirm}
            onSwap={handleSwap}
            onCopySlack={showToast}
          />
        </main>
      </div>

      {toast && (
        <div className={styles.toast} role="status">
          {toast}
        </div>
      )}

      {isResetOpen && (
        <ConfirmModal
          title="일정/횟수 초기화"
          message="확정 일정과 수행 횟수를 초기화하고, Notion의 이번 달 Schedule History도 삭제합니다. 호스트 목록과 큐 순서는 유지됩니다. 계속하시겠습니까?"
          confirmLabel="초기화"
          danger
          onCancel={() => setIsResetOpen(false)}
          onConfirm={handleResetConfirm}
        />
      )}
    </div>
  );
}
