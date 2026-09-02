import { useEffect, useState } from 'react';
import {
  fetchNotionHealth,
  fetchNotionMembers,
  fetchNotionSchedules,
  pushNotionMembers,
} from '../../api/notion';
import { buildMembersPayload } from '../../utils/notionSync';
import { HistoryModal } from '../HistoryModal/HistoryModal';
import styles from './NotionSyncPanel.module.scss';

/**
 * Notion 멤버/확정주차 동기화 패널.
 * 멤버 불러오기 시 확정 Schedule도 함께 가져와 Replay에 사용한다.
 */
export function NotionSyncPanel({
  hosts,
  priorityQueue = [],
  basePriorityQueue = [],
  busy = false,
  historyTick = 0,
  onPushSchedules,
  /** @type {(members: object[], schedules?: object[]) => void | Promise<void>} */
  onLoadMembers,
  onToast,
}) {
  const [health, setHealth] = useState(null);
  const [localBusy, setLocalBusy] = useState(false);
  const [history, setHistory] = useState([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const isBusy = busy || localBusy;

  const refreshHealth = async () => {
    try {
      const data = await fetchNotionHealth();
      setHealth(data.notion);
    } catch {
      setHealth(null);
    }
  };

  const refreshHistory = async () => {
    const data = await fetchNotionSchedules();
    setHistory(data.schedules ?? []);
    return data.schedules ?? [];
  };

  useEffect(() => {
    refreshHealth();
  }, []);

  useEffect(() => {
    if (historyTick > 0 && isHistoryOpen) {
      refreshHistory().catch(() => {});
    }
  }, [historyTick, isHistoryOpen]);

  const run = async (fn) => {
    setLocalBusy(true);
    try {
      await fn();
    } catch (error) {
      onToast(error.message || 'Notion 요청에 실패했습니다.');
    } finally {
      setLocalBusy(false);
    }
  };

  const handlePullMembers = () =>
    run(async () => {
      const [membersResult, schedulesResult] = await Promise.all([
        fetchNotionMembers(),
        fetchNotionSchedules(),
      ]);
      const members = membersResult.members ?? [];
      if (members.length === 0) {
        onToast('Notion에 등록된 멤버가 없습니다.');
        return;
      }
      const schedules = schedulesResult.schedules ?? [];
      await onLoadMembers?.(members, schedules);
      const schedulePart =
        schedules.length > 0
          ? ` · 확정 스케줄 ${schedules.length}건 Replay`
          : '';
      onToast(`Notion 멤버 ${members.length}명 불러옴${schedulePart}`);
    });

  const handlePushMembers = () =>
    run(async () => {
      const payload = buildMembersPayload(
        hosts,
        priorityQueue,
        basePriorityQueue,
      );
      const data = await pushNotionMembers(payload);
      onToast(`멤버·우선순위 Notion 반영 완료 · ${data.count}명`);
    });

  const handlePushSchedules = () =>
    run(async () => {
      await onPushSchedules?.();
    });

  const handleOpenHistory = () =>
    run(async () => {
      const schedules = await refreshHistory();
      setIsHistoryOpen(true);
      onToast(`노션 히스토리 ${schedules.length}건 불러옴`);
    });

  const handleRefreshHistory = () =>
    run(async () => {
      const schedules = await refreshHistory();
      onToast(`노션 히스토리 ${schedules.length}건 불러옴`);
    });

  const configured =
    health?.token && health?.membersDb && health?.scheduleDb;

  return (
    <>
      <section className={styles.panel}>
        <header className={styles.header}>
          <div>
            <h2 className={styles.title}>Notion 동기화</h2>
            <p className={styles.subtitle}>
              Active·우선순위·주차·출근 양방향 동기화
            </p>
          </div>
          <span
            className={`${styles.status} ${
              configured ? styles.ready : styles.warn
            }`}
          >
            {configured ? '연결됨' : '설정 필요'}
          </span>
        </header>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondary}
            disabled={isBusy}
            onClick={handlePullMembers}
          >
            멤버·Active 불러오기
          </button>
          <button
            type="button"
            className={styles.secondary}
            disabled={isBusy}
            onClick={handlePushMembers}
          >
            멤버·Active·우선순위 반영
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={isBusy}
            onClick={handlePushSchedules}
          >
            주차 업로드/업데이트
          </button>
          <button
            type="button"
            className={styles.secondary}
            disabled={isBusy}
            onClick={handleOpenHistory}
          >
            히스토리 조회
          </button>
        </div>
      </section>

      {isHistoryOpen && (
        <HistoryModal
          items={history}
          loading={isBusy}
          onClose={() => setIsHistoryOpen(false)}
          onRefresh={handleRefreshHistory}
        />
      )}
    </>
  );
}
