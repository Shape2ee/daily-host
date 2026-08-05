import { useEffect, useRef, useState } from "react";
import { DAY_LABELS } from "../../constants/hosts";
import { useScheduler } from "../../hooks/useScheduler";
import {
  fetchNotionSchedules,
  upsertNotionSchedules,
} from "../../api/notion";
import {
  calcWorkRatio,
  createHostMap,
  formatAllSlackShares,
} from "../../utils/scheduler";
import {
  buildSchedulePayload,
  filterSchedulesByMonth,
  getMonthRange,
} from "../../utils/notionSync";
import { ConfirmModal } from "../ConfirmModal/ConfirmModal";
import { DateSearchForm } from "../DateSearchForm/DateSearchForm";
import { HostManagementPanel } from "../HostManagementPanel/HostManagementPanel";
import { NotionSyncPanel } from "../NotionSyncPanel/NotionSyncPanel";
import { ScheduleContainer } from "../ScheduleContainer/ScheduleContainer";
import styles from "./Dashboard.module.scss";

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
    showToast('업로드할 확정 주차가 없습니다.');
    return null;
  }

  try {
    const data = await upsertNotionSchedules(payload);
    showToast(`${label} · 생성 ${data.created} / 갱신 ${data.updated}`);
    return data;
  } catch (error) {
    showToast(`Notion 동기화 실패: ${error.message}`);
    return null;
  }
}

/**
 * Admin Dashboard 레이아웃.
 */
export function Dashboard() {
  const {
    hosts,
    priorityQueue,
    weeks,
    hostMap,
    searchSchedule,
    hydrateFromNotionSchedules,
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
  const fileInputRef = useRef(null);
  const toastTimerRef = useRef(null);

  const showToast = (message) => {
    setToast(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3200);
  };

  // 첫 진입: 오늘 달 Notion 확정 기록이 있으면 화면에 hydrate
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { month } = getMonthRange();
      try {
        const data = await fetchNotionSchedules();
        if (cancelled) return;

        const monthSchedules = filterSchedulesByMonth(
          data.schedules ?? [],
          new Date(),
        );
        hydrateFromNotionSchedules(monthSchedules);

        if (monthSchedules.length > 0) {
          showToast(
            `Notion ${month}월 확정 주차 ${monthSchedules.length}건을 불러왔습니다.`,
          );
        }
      } catch {
        // Notion 실패 시 localStorage weeks 유지
      } finally {
        if (!cancelled) setMonthBootstrapping(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시 1회
  }, []);

  const handlePushSchedules = async (label) => {
    setNotionBusy(true);
    try {
      const data = await syncWeeksToNotion(weeks, hosts, showToast, label);
      if (data) setHistoryTick((n) => n + 1);
      return data;
    } finally {
      setNotionBusy(false);
    }
  };

  const handleAddHost = (name) => {
    if (!name.trim()) {
      showToast("호스트 이름을 입력하세요.");
      return;
    }
    addHost(name);
    setNewHostName("");
    showToast(`"${name.trim()}" 호스트가 추가되었습니다.`);
  };

  const handleRemoveHost = (hostId) => {
    const error = removeHost(hostId);
    if (error) {
      showToast(REMOVE_ERROR_MESSAGES[error] ?? "삭제에 실패했습니다.");
      return;
    }
    showToast("호스트가 삭제되었습니다.");
  };

  const handleToggleActive = (hostId, active) => {
    const error = setHostActive(hostId, active);
    if (error) {
      showToast(ACTIVE_ERROR_MESSAGES[error] ?? "상태 변경에 실패했습니다.");
      return;
    }
    showToast(
      active ? "호스트가 활성화되었습니다." : "호스트가 비활성화되었습니다.",
    );
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
      const data = await syncWeeksToNotion(
        result.snapshot.weeks,
        result.snapshot.hosts,
        showToast,
        '주차 확정 · Notion 동기화',
        weekId,
      );
      if (data) setHistoryTick((n) => n + 1);
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
      const data = await syncWeeksToNotion(
        result.snapshot.weeks,
        result.snapshot.hosts,
        showToast,
        '맞교환 · Notion 동기화',
        result.affectedWeekIds ?? [weekId],
      );
      if (data) setHistoryTick((n) => n + 1);
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

  const handleResetConfirm = () => {
    resetAll();
    setIsResetOpen(false);
    showToast("일정과 수행 횟수가 초기화되었습니다.");
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
            <span>주차 {weeks.length}개</span>
          </div>
          <button
            type="button"
            className={styles.slackButton}
            onClick={handleCopySlack}
          >
            📋 슬랙 공유용 복사
          </button>
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
          <DateSearchForm onSearch={searchSchedule} />
          <NotionSyncPanel
            hosts={hosts}
            busy={notionBusy}
            historyTick={historyTick}
            onPushSchedules={() => handlePushSchedules("확정 주차 동기화")}
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
          message="확정 일정과 수행 횟수만 초기화합니다. 호스트 목록과 큐 순서는 유지됩니다. 계속하시겠습니까?"
          confirmLabel="초기화"
          danger
          onCancel={() => setIsResetOpen(false)}
          onConfirm={handleResetConfirm}
        />
      )}
    </div>
  );
}
