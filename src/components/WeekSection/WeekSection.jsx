import { useMemo, useState } from 'react';
import { DAY_LABELS } from '../../constants/hosts';
import {
  formatDate,
  formatSlackShare,
  getAvailableDays,
  getSwappableDays,
} from '../../utils/scheduler';
import { AttendanceTable } from '../AttendanceTable/AttendanceTable';
import { AssignmentResult } from '../AssignmentResult/AssignmentResult';
import { ConfirmButton } from '../ConfirmButton/ConfirmButton';
import { SwapModal } from '../SwapModal/SwapModal';
import styles from './WeekSection.module.scss';

/**
 * 주차 카드: 출근표 / 배정 / 확정 / Swap.
 * 교환은 지난 날짜만 막고, 이후 주차 확정과 무관하게 미래 요일은 가능.
 */
export function WeekSection({
  week,
  weeks,
  weekNumber,
  hosts,
  hostMap,
  onUpdateAttendance,
  onConfirm,
  onSwap,
  onCopySlack,
}) {
  const [isSwapOpen, setIsSwapOpen] = useState(false);
  const availableDays = getAvailableDays(week);
  const daySummary = availableDays.map((d) => DAY_LABELS[d]).join(' · ');
  const swappableDays = useMemo(() => getSwappableDays(week), [week]);
  const canSwap = week.confirmed && swappableDays.length > 0;

  const weekHosts = hosts.filter((host) =>
    Object.prototype.hasOwnProperty.call(week.attendance.monday, host.id),
  );

  const cardClassName = [
    styles.card,
    week.isLocked ? styles.locked : '',
    week.confirmed ? styles.confirmed : '',
  ]
    .filter(Boolean)
    .join(' ');

  const handleCopyWeek = async () => {
    const text = formatSlackShare(week, weekNumber, hostMap);
    try {
      await navigator.clipboard.writeText(text);
      onCopySlack?.('슬랙 공유용 텍스트가 복사되었습니다.');
    } catch {
      onCopySlack?.('클립보드 복사에 실패했습니다.');
    }
  };

  return (
    <article className={cardClassName}>
      <header className={styles.header}>
        <div>
          <div className={styles.badges}>
            <span className={styles.weekBadge}>Week {weekNumber}</span>
            {week.confirmed && (
              <span className={styles.confirmedBadge}>확정</span>
            )}
            {week.isLocked && (
              <span className={styles.lockedBadge}>잠금</span>
            )}
          </div>
          <h3 className={styles.title}>
            {formatDate(week.startDate)} ~ {formatDate(week.endDate)}
          </h3>
          <p className={styles.days}>{daySummary}</p>
        </div>
      </header>

      <AttendanceTable
        week={week}
        hosts={weekHosts}
        onToggle={(hostId, day, present) =>
          onUpdateAttendance(week.id, hostId, day, present)
        }
      />

      {week.confirmed && (
        <AssignmentResult week={week} hostMap={hostMap} />
      )}
      <div className={styles.actions}>
        {!week.confirmed ? (
          <ConfirmButton
            disabled={week.isLocked}
            onClick={() => onConfirm(week.id)}
          />
        ) : (
          <>
            {canSwap && (
              <button
                type="button"
                className={styles.swapButton}
                onClick={() => setIsSwapOpen(true)}
              >
                교체 / 맞교환
              </button>
            )}
            <button
              type="button"
              className={styles.copyButton}
              onClick={handleCopyWeek}
            >
              📋 슬랙 공유용 복사
            </button>
          </>
        )}
      </div>

      {isSwapOpen && canSwap && (
        <SwapModal
          week={week}
          weeks={weeks}
          weekNumber={weekNumber}
          hosts={hosts}
          hostMap={hostMap}
          onClose={() => setIsSwapOpen(false)}
          onSwap={(day, targetHostId) => onSwap(week.id, day, targetHostId)}
        />
      )}
    </article>
  );
}
