import styles from './StatusBadge.module.scss';

/**
 * 웹소켓 연결 상태를 표시하는 뱃지.
 */
export function StatusBadge({ connected = false, reconnecting = false }) {
  const stateClass = connected
    ? styles.connected
    : reconnecting
      ? styles.reconnecting
      : styles.disconnected;
  const label = connected
    ? '실시간 연결됨'
    : reconnecting
      ? '재연결 중'
      : '연결 끊김';

  return (
    <span
      className={`${styles.badge} ${stateClass}`}
      role="status"
      aria-live="polite"
    >
      <span className={styles.dot} aria-hidden="true" />
      {label}
    </span>
  );
}
