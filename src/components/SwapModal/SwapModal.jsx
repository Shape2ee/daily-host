import { useMemo, useState } from 'react';
import { DAY_LABELS } from '../../constants/hosts';
import {
  findHostAssignment,
  formatDate,
  getDateForDay,
  getSwappableDays,
} from '../../utils/scheduler';
import styles from './SwapModal.module.scss';

/**
 * 확정된 주차 교체/맞교환 모달.
 * - 지나지 않은 요일만 선택 가능
 * - 다른 주차의 미래 배정자와도 맞교환 가능
 * - 상대가 미래 배정이 없으면 해당 요일만 교체
 */
export function SwapModal({
  week,
  weeks = [],
  weekNumber,
  hosts,
  hostMap,
  onClose,
  onSwap,
}) {
  const swappableDays = useMemo(() => getSwappableDays(week), [week]);

  const weekHosts = useMemo(
    () =>
      hosts.filter((host) =>
        Object.prototype.hasOwnProperty.call(week.attendance.monday, host.id),
      ),
    [hosts, week],
  );

  const weekIndexById = useMemo(() => {
    const list = weeks.length > 0 ? weeks : [week];
    const map = new Map();
    list.forEach((w, index) => map.set(w.id, index + 1));
    return map;
  }, [weeks, week]);

  const [day, setDay] = useState(swappableDays[0]);
  const currentHostId = day ? week.assignments[day] : undefined;

  const candidates = useMemo(() => {
    if (!day) return [];
    return weekHosts.filter((host) => host.id !== currentHostId);
  }, [weekHosts, currentHostId, day]);

  const [targetHostId, setTargetHostId] = useState(
    () => candidates[0]?.id ?? '',
  );

  const resolveDayName = (d) => {
    const hostId = week.assignments[d];
    if (hostId === undefined) return '미배정';
    return hostMap.get(hostId)?.name ?? '미배정';
  };

  const lookupWeeks = weeks.length > 0 ? weeks : [week];

  const describeSlot = (slot) => {
    if (!slot) return '미배정';
    const n = weekIndexById.get(slot.weekId) ?? '?';
    const date = getDateForDay(slot.week, slot.day);
    const dateLabel = date ? formatDate(date) : DAY_LABELS[slot.day];
    return `${n}주차 ${DAY_LABELS[slot.day]} (${dateLabel})`;
  };

  const describeCandidate = (host) => {
    const slot = findHostAssignment(lookupWeeks, host.id, { futureOnly: true });
    if (slot) {
      return `${host.name} — ${describeSlot(slot)} 담당`;
    }
    return `${host.name} (미래 배정 없음)`;
  };

  const effectiveTargetId = candidates.some((h) => h.id === Number(targetHostId))
    ? Number(targetHostId)
    : candidates[0]?.id;

  const handleDayChange = (nextDay) => {
    setDay(nextDay);
    const nextCurrent = week.assignments[nextDay];
    const nextCandidates = weekHosts.filter((h) => h.id !== nextCurrent);
    setTargetHostId(nextCandidates[0]?.id ?? '');
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!day || effectiveTargetId == null) return;
    onSwap(day, effectiveTargetId);
    onClose();
  };

  const targetSlot =
    effectiveTargetId != null
      ? findHostAssignment(lookupWeeks, effectiveTargetId, { futureOnly: true })
      : null;

  const sourceLabel = day
    ? `${weekNumber ?? weekIndexById.get(week.id) ?? '?'}주차 ${DAY_LABELS[day]}`
    : '';

  return (
    <div className={styles.overlay} role="presentation" onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="swap-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h3 id="swap-modal-title" className={styles.title}>
            교체 / 맞교환
          </h3>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="닫기"
          >
            ×
          </button>
        </header>

        <p className={styles.hint}>
          아직 지나지 않은 요일만 바꿀 수 있습니다. 다음 주차에 이미 배정된
          사람과도, 양쪽 날짜가 미래라면 맞교환할 수 있습니다.
        </p>

        {swappableDays.length === 0 ? (
          <p className={styles.hint}>교환 가능한 요일이 없습니다.</p>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.field}>
              <span className={styles.label}>바꿀 요일</span>
              <select
                className={styles.select}
                value={day}
                onChange={(e) => handleDayChange(e.target.value)}
              >
                {swappableDays.map((d) => (
                  <option key={d} value={d}>
                    {DAY_LABELS[d]} — {resolveDayName(d)}
                  </option>
                ))}
              </select>
            </label>

            <div className={styles.swapIcon} aria-hidden>
              ⇄
            </div>

            <label className={styles.field}>
              <span className={styles.label}>상대 호스트</span>
              <select
                className={styles.select}
                value={effectiveTargetId ?? ''}
                onChange={(e) => setTargetHostId(Number(e.target.value))}
              >
                {candidates.map((host) => (
                  <option key={host.id} value={host.id}>
                    {describeCandidate(host)}
                  </option>
                ))}
              </select>
            </label>

            {effectiveTargetId != null && (
              <p className={styles.preview}>
                {targetSlot
                  ? `${sourceLabel} ↔ ${describeSlot(targetSlot)} 맞교환`
                  : `${sourceLabel} 담당 → ${
                      hostMap.get(effectiveTargetId)?.name ?? ''
                    } 로 교체`}
              </p>
            )}

            <div className={styles.actions}>
              <button type="button" className={styles.cancel} onClick={onClose}>
                취소
              </button>
              <button
                type="submit"
                className={styles.confirm}
                disabled={effectiveTargetId == null || candidates.length === 0}
              >
                교환 확정
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
