import { useMemo, useState } from 'react';
import { DAY_LABELS } from '../../constants/hosts';
import {
  findAssignedDay,
  getAvailableDays,
} from '../../utils/scheduler';
import styles from './SwapModal.module.scss';

/**
 * 확정된 주차 교체/맞교환 모달.
 * - 요일 선택 + 상대 호스트 선택 (배정/미배정 모두 가능)
 * - 상대가 다른 요일 담당이면 맞교환, 미배정이면 해당 요일만 교체
 */
export function SwapModal({ week, hosts, hostMap, onClose, onSwap }) {
  const availableDays = useMemo(() => getAvailableDays(week), [week]);

  const weekHosts = useMemo(
    () =>
      hosts.filter((host) =>
        Object.prototype.hasOwnProperty.call(week.attendance.monday, host.id),
      ),
    [hosts, week],
  );

  const [day, setDay] = useState(availableDays[0]);
  const currentHostId = week.assignments[day];

  const candidates = useMemo(
    () => weekHosts.filter((host) => host.id !== currentHostId),
    [weekHosts, currentHostId],
  );

  const [targetHostId, setTargetHostId] = useState(
    () => candidates[0]?.id ?? '',
  );

  const resolveDayName = (d) => {
    const hostId = week.assignments[d];
    if (hostId === undefined) return '미배정';
    return hostMap.get(hostId)?.name ?? '미배정';
  };

  const describeCandidate = (host) => {
    const assignedDay = findAssignedDay(week, host.id);
    if (assignedDay) {
      return `${host.name} (${DAY_LABELS[assignedDay]} 담당)`;
    }
    return `${host.name} (미배정)`;
  };

  // 요일 변경 시 후보/선택이 어긋나면 보정
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
    if (effectiveTargetId == null) return;
    onSwap(day, effectiveTargetId);
    onClose();
  };

  const targetAssignedDay =
    effectiveTargetId != null
      ? findAssignedDay(week, effectiveTargetId)
      : null;

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
          선택한 요일의 담당자를 다른 호스트와 바꿉니다. 상대가 이미 다른
          요일 담당이면 맞교환, 미배정이면 해당 요일만 교체됩니다. 이후 큐는
          소급 재정렬되어 미확정 차주에 반영됩니다.
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span className={styles.label}>바꿀 요일</span>
            <select
              className={styles.select}
              value={day}
              onChange={(e) => handleDayChange(e.target.value)}
            >
              {availableDays.map((d) => (
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
              {targetAssignedDay
                ? `${DAY_LABELS[day]} ↔ ${DAY_LABELS[targetAssignedDay]} 맞교환`
                : `${DAY_LABELS[day]} 담당 → ${
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
      </div>
    </div>
  );
}
