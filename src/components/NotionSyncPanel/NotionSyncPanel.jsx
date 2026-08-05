import { useEffect, useState } from 'react';
import {
  fetchNotionHealth,
  fetchNotionSchedules,
  pushNotionMembers,
} from '../../api/notion';
import { HistoryModal } from '../HistoryModal/HistoryModal';
import styles from './NotionSyncPanel.module.scss';

/**
 * Notion 멤버/확정주차 동기화 패널.
 */
export function NotionSyncPanel({
  hosts,
  busy = false,
  historyTick = 0,
  onPushSchedules,
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

  const handlePushMembers = () =>
    run(async () => {
      const data = await pushNotionMembers(hosts);
      onToast(`멤버 노션 반영 완료 · ${data.count}명`);
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
              주차 확정 시 자동 동기화 · 멤버/히스토리 수동 반영
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
            onClick={handlePushMembers}
          >
            멤버 노션에 반영
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={isBusy}
            onClick={handlePushSchedules}
          >
            확정 주차 업로드/업데이트
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
