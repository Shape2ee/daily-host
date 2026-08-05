import { DAY_LABELS } from '../../constants/hosts';
import { getAvailableDays } from '../../utils/scheduler';
import styles from './AttendanceTable.module.scss';

/**
 * 주차별 월~목 출근 체크 테이블.
 * 확정된 Week는 읽기 전용이다.
 */
export function AttendanceTable({ week, hosts, onToggle }) {
  const availableDays = getAvailableDays(week);
  const readOnly = week.confirmed;

  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.hostCol}>호스트</th>
            {availableDays.map((day) => (
              <th key={day}>{DAY_LABELS[day]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hosts.map((host) => (
            <tr key={host.id}>
              <td className={styles.hostCol}>{host.name}</td>
              {availableDays.map((day) => {
                const checked = week.attendance[day][host.id] ?? false;

                return (
                  <td key={day}>
                    <label className={styles.checkLabel}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={readOnly}
                        onChange={(e) =>
                          onToggle(host.id, day, e.target.checked)
                        }
                        aria-label={`${host.name} ${DAY_LABELS[day]} 출근`}
                      />
                    </label>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
