import { WeekSection } from '../WeekSection/WeekSection';
import styles from './ScheduleContainer.module.scss';

/**
 * Week Card 리스트 컨테이너.
 */
export function ScheduleContainer({
  weeks,
  hosts,
  hostMap,
  loading = false,
  onUpdateAttendance,
  onConfirm,
  onSwap,
  onCopySlack,
}) {
  if (loading) {
    return (
      <div className={styles.empty}>
        <h3 className={styles.emptyTitle}>Notion 기록 확인 중…</h3>
        <p className={styles.emptyText}>
          이번 달 확정 호스트 기록이 있는지 불러오고 있습니다.
        </p>
      </div>
    );
  }

  if (weeks.length === 0) {
    return (
      <div className={styles.empty}>
        <h3 className={styles.emptyTitle}>일정이 없습니다</h3>
        <p className={styles.emptyText}>
          이번 달 Notion 확정 기록이 없습니다. <br/>상단에서 시작일·종료일을 선택한 뒤
          &quot;일정 조회&quot;로 새 주차를 만들어 주세요.
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
          weeks={weeks}
          weekNumber={index + 1}
          hosts={hosts}
          hostMap={hostMap}
          onUpdateAttendance={onUpdateAttendance}
          onConfirm={onConfirm}
          onSwap={onSwap}
          onCopySlack={onCopySlack}
        />
      ))}
    </div>
  );
}
