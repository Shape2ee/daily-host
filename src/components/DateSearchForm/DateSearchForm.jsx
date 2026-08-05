import { useState } from 'react';
import styles from './DateSearchForm.module.scss';

function todayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function monthEndStr() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const y = end.getFullYear();
  const m = String(end.getMonth() + 1).padStart(2, '0');
  const d = String(end.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 시작일/종료일(HTML5 date) 입력 후 일정 조회를 트리거한다.
 */
export function DateSearchForm({ onSearch }) {
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(monthEndStr());
  const [error, setError] = useState(null);

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!startDate || !endDate) {
      setError('시작일과 종료일을 모두 선택하세요.');
      return;
    }

    if (endDate < startDate) {
      setError('종료일은 시작일 이후여야 합니다.');
      return;
    }

    setError(null);
    onSearch(startDate, endDate);
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.label}>시작일</span>
          <input
            className={styles.input}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>종료일</span>
          <input
            className={styles.input}
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
      </div>

      <div className={styles.actions}>
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.submit} type="submit">
          일정 조회
        </button>
      </div>
    </form>
  );
}
