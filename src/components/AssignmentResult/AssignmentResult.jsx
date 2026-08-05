import { DAY_LABELS } from '../../constants/hosts';
import { getAvailableDays } from '../../utils/scheduler';
import styles from './AssignmentResult.module.scss';

/**
 * 확정된 주차의 자동 배정 결과 + 당일 패스 버튼.
 */
export function AssignmentResult({
  week,
  hostMap,
  frozen = false,
  onEmergencyPass,
}) {
  const availableDays = getAvailableDays(week);

  return (
    <div className={styles.result}>
      <h4 className={styles.title}>배정 결과</h4>
      <ul className={styles.list}>
        {availableDays.map((day) => {
          const hostId = week.assignments[day];
          const host = hostId !== undefined ? hostMap.get(hostId) : undefined;
          const passInfo = week.passes?.[day];
          const fromName = passInfo
            ? hostMap.get(passInfo.fromId)?.name
            : null;

          return (
            <li key={day} className={styles.item}>
              <div className={styles.row}>
                <span className={styles.day}>{DAY_LABELS[day]}</span>
                <div className={styles.assigneeWrap}>
                  <span
                    className={
                      host
                        ? styles.assignee
                        : `${styles.assignee} ${styles.empty}`
                    }
                  >
                    {host ? host.name : '미배정'}
                  </span>
                  {passInfo && (
                    <span className={styles.passBadge}>
                      Pass ← {fromName ?? '?'}
                    </span>
                  )}
                </div>
              </div>
              {!frozen && hostId !== undefined && onEmergencyPass && (
                <button
                  type="button"
                  className={styles.passButton}
                  onClick={() => onEmergencyPass(day)}
                  title="큐 순위 유지한 채 2순위 출근자에게 이관"
                >
                  당일 패스
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
