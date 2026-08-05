import styles from './HistoryModal.module.scss';

/**
 * Notion 확정 주차 히스토리 모달.
 */
export function HistoryModal({ items = [], loading = false, onClose, onRefresh }) {
  return (
    <div className={styles.overlay} role="presentation" onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <div>
            <h3 id="history-modal-title" className={styles.title}>
              Notion Schedule History
            </h3>
            <p className={styles.subtitle}>
              확정·수정된 주차 기록 ({items.length}건)
            </p>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.refresh}
              disabled={loading}
              onClick={onRefresh}
            >
              새로고침
            </button>
            <button
              type="button"
              className={styles.close}
              onClick={onClose}
              aria-label="닫기"
            >
              ×
            </button>
          </div>
        </header>

        {loading && items.length === 0 ? (
          <p className={styles.empty}>불러오는 중…</p>
        ) : items.length === 0 ? (
          <p className={styles.empty}>확정 주차 히스토리가 없습니다.</p>
        ) : (
          <ul className={styles.list}>
            {items.map((item) => (
              <li key={item.notionPageId} className={styles.item}>
                <div className={styles.itemTop}>
                  <strong>{item.name || item.weekKey}</strong>
                  <em>{item.status ?? ''}</em>
                </div>
                <span className={styles.hosts}>
                  {[item.monday, item.tuesday, item.wednesday, item.thursday]
                    .filter(Boolean)
                    .join(' / ') || '—'}
                </span>
                {(item.startDate || item.endDate) && (
                  <span className={styles.period}>
                    {item.startDate}
                    {item.endDate && item.endDate !== item.startDate
                      ? ` ~ ${item.endDate}`
                      : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
