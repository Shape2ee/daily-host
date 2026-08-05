import { useState } from 'react';
import { DAY_LABELS } from '../../constants/hosts';
import {
  formatDate,
  formatSlackShare,
  getAvailableDays,
} from '../../utils/scheduler';
import { AttendanceTable } from '../AttendanceTable/AttendanceTable';
import { AssignmentResult } from '../AssignmentResult/AssignmentResult';
import { ConfirmButton } from '../ConfirmButton/ConfirmButton';
import { SwapModal } from '../SwapModal/SwapModal';
import styles from './WeekSection.module.scss';

/**
 * 주차 카드: 출근표 / 배정 / 확정 / Swap / Emergency Pass.
 * Freeze Rule: 이후 확정 주차가 있으면 과거 확정 주차는 편집 불가.
 */
export function WeekSection({
  week,
  weekNumber,
  hosts,
  hostMap,
  frozen,
  onUpdateAttendance,
  onConfirm,
  onSwap,
  onEmergencyPass,
  onCopySlack,
}) {
  const [isSwapOpen, setIsSwapOpen] = useState(false);
  const availableDays = getAvailableDays(week);
  const daySummary = availableDays.map((d) => DAY_LABELS[d]).join(' · ');

  const weekHosts = hosts.filter((host) =>
    Object.prototype.hasOwnProperty.call(week.attendance.monday, host.id),
  );

  const cardClassName = [
    styles.card,
    week.isLocked ? styles.locked : '',
    week.confirmed ? styles.confirmed : '',
    frozen ? styles.frozen : '',
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
            {frozen && <span className={styles.frozenBadge}>동결</span>}
          </div>
          <h3 className={styles.title}>
            {formatDate(week.startDate)} ~ {formatDate(week.endDate)}
          </h3>
          <p className={styles.days}>{daySummary}</p>
          {frozen && (
            <p className={styles.freezeHint}>
              Freeze Rule: 과거 확정 주차는 고정됩니다. 큐 재정렬은 미확정
              차주에만 반영됩니다.
            </p>
          )}
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
        <AssignmentResult
          week={week}
          hostMap={hostMap}
          frozen={frozen}
          onEmergencyPass={(day) => onEmergencyPass(week.id, day)}
        />
      )}

      <div className={styles.actions}>
        {!week.confirmed ? (
          <ConfirmButton
            disabled={week.isLocked}
            onClick={() => onConfirm(week.id)}
          />
        ) : (
          <>
            {!frozen && (
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

      {isSwapOpen && week.confirmed && !frozen && (
        <SwapModal
          week={week}
          hosts={hosts}
          hostMap={hostMap}
          onClose={() => setIsSwapOpen(false)}
          onSwap={(day, targetHostId) => onSwap(week.id, day, targetHostId)}
        />
      )}
    </article>
  );
}
