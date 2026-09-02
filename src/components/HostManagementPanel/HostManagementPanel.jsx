import styles from './HostManagementPanel.module.scss';
import { getEffectiveCount, isCountAdjusted } from '../../utils/scheduler';

/**
 * 좌측 패널: 호스트 관리 + Priority 순위 + 활성/비활성
 */
export function HostManagementPanel({
  hosts,
  priorityQueue,
  hostMap,
  canRemoveHost,
  onAddHost,
  onRemoveHost,
  onToggleActive,
  newHostName,
  onNewHostNameChange,
  calcWorkRatio,
}) {
  const handleSubmit = (event) => {
    event.preventDefault();
    onAddHost(newHostName);
  };

  return (
    <aside className={styles.panel}>
      <section className={styles.section}>
        <header className={styles.header}>
          <h2 className={styles.title}>호스트 관리</h2>
          <p className={styles.subtitle}>
            추가·삭제·비활성화 (복귀·신규는 평균 횟수를 기준선으로 시작)
          </p>
        </header>

        <form className={styles.addForm} onSubmit={handleSubmit}>
          <input
            className={styles.input}
            type="text"
            placeholder="호스트 이름"
            value={newHostName}
            onChange={(e) => onNewHostNameChange(e.target.value)}
            aria-label="호스트 이름"
          />
          <button className={styles.addButton} type="submit">
            + 추가
          </button>
        </form>

        <ul className={styles.hostList}>
          {hosts.map((host) => {
            const removable = canRemoveHost(host.id);
            const ratio = calcWorkRatio(host);
            const isActive = host.active !== false;

            return (
              <li
                key={host.id}
                className={`${styles.hostItem} ${
                  isActive ? '' : styles.inactive
                }`}
              >
                <div className={styles.hostInfo}>
                  <div className={styles.nameRow}>
                    <span className={styles.hostName}>{host.name}</span>
                    {isActive && isCountAdjusted(host) && (
                      <span
                        className={styles.adjustBadge}
                        title={`복귀 기준 ${host.baselineCount}회 · 실제 ${host.count}회. 실제 횟수가 기준에 도달하면 해제됩니다.`}
                      >
                        보정 중
                      </span>
                    )}
                    {!isActive && (
                      <span className={styles.inactiveBadge}>InActive</span>
                    )}
                  </div>
                  <span className={styles.hostCount}>
                    {host.count}회
                    {isCountAdjusted(host)
                      ? ` · 점수 ${getEffectiveCount(host)}`
                      : ''}
                    {' · '}출근 {host.totalWorkingDays}일 · {ratio}%
                  </span>
                </div>
                <div className={styles.hostActions}>
                  <button
                    type="button"
                    className={styles.activeButton}
                    onClick={() => onToggleActive(host.id, !isActive)}
                    title={
                      isActive
                        ? '비활성화 (통계 유지, Priority Queue에서 제외)'
                        : '활성화 (복귀 당일 활성 멤버 평균 횟수를 기준선으로 설정)'
                    }
                  >
                    {isActive ? '비활성' : '활성'}
                  </button>
                  <button
                    type="button"
                    className={styles.removeButton}
                    disabled={!removable}
                    title={
                      removable
                        ? '호스트 삭제'
                        : '삭제 불가 (최소 활성 2명 또는 배정 이력)'
                    }
                    onClick={() => onRemoveHost(host.id)}
                  >
                    삭제
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={styles.section}>
        <header className={styles.header}>
          <h2 className={styles.title}>Priority 순위</h2>
          <p className={styles.subtitle}>횟수(보정 포함) 적은 순 · 동률이면 오래된 순</p>
        </header>

        <ol className={styles.priorityList}>
          {priorityQueue.map((hostId, index) => {
            const host = hostMap.get(hostId);
            if (!host || host.active === false) {
              return null;
            }

            const ratio = calcWorkRatio(host);

            return (
              <li key={hostId} className={styles.priorityItem}>
                <span className={styles.rank}>{index + 1}위</span>
                <span className={styles.priorityName}>{host.name}</span>
                <span className={styles.priorityCount}>
                  {isCountAdjusted(host)
                    ? `점수 ${getEffectiveCount(host)} · `
                    : ''}
                  {host.count}회 · {ratio}%
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </aside>
  );
}
