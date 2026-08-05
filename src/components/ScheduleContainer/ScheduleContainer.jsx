import { WeekSection } from '../WeekSection/WeekSection';
import styles from './ScheduleContainer.module.scss';

/**
 * Week Card 리스트 컨테이너.
 */
export function ScheduleContainer({
  weeks,
  hosts,
  hostMap,
  isWeekFrozen,
  onUpdateAttendance,
  onConfirm,
  onSwap,
  onEmergencyPass,
  onCopySlack,
}) {
  if (weeks.length === 0) {
    return (
      <div className={styles.empty}>
        <h3 className={styles.emptyTitle}>일정이 없습니다</h3>
        <p className={styles.emptyText}>
          상단에서 시작일·종료일을 선택한 뒤 &quot;일정 조회&quot;를 눌러 주세요.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {weeks.map((week, index) => (
        <WeekSection
          key={week.id}
          week={week}
          weekNumber={index + 1}
          hosts={hosts}
          hostMap={hostMap}
          frozen={isWeekFrozen(week.id)}
          onUpdateAttendance={onUpdateAttendance}
          onConfirm={onConfirm}
          onSwap={onSwap}
          onEmergencyPass={onEmergencyPass}
          onCopySlack={onCopySlack}
        />
      ))}
    </div>
  );
}
