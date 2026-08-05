import { DAY_LABELS } from '../../constants/hosts';
import { getAvailableDays, isDayPast } from '../../utils/scheduler';
import styles from './AssignmentResult.module.scss';

/**
 * 확정된 주차의 자동 배정 결과.
 */
export function AssignmentResult({ week, hostMap }) {
  const availableDays = getAvailableDays(week);

  return (
    <div className={styles.result}>
      <h4 className={styles.title}>배정 결과</h4>
      <ul className={styles.list}>
        {availableDays.map((day) => {
          const hostId = week.assignments[day];
          const host = hostId !== undefined ? hostMap.get(hostId) : undefined;
          const past = isDayPast(week, day);

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
                  {past && (
                    <span className={styles.pastBadge}>지난 날짜</span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
