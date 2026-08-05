import styles from './ConfirmButton.module.scss';

/**
 * 주차 자동 배정 및 최종 확정 버튼.
 */
export function ConfirmButton({ disabled = false, onClick }) {
  return (
    <button
      type="button"
      className={styles.button}
      disabled={disabled}
      onClick={onClick}
    >
      이 주차 자동 배정 및 최종 확정
    </button>
  );
}
