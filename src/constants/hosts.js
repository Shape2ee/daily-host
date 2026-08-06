/** 삭제/비활성 시 유지해야 하는 최소 활성 호스트 수 */
export const MIN_HOST_COUNT = 2;

/** localStorage 키 */
export const STORAGE_KEY = 'daily-host-scheduler-pro';

/** Notion 미동기화 변경사항 플래그 */
export const NOTION_PENDING_KEY = 'daily-host-notion-pending';

/** 초기 호스트 — 비어 있음. 멤버는 Notion에서 hydrate */
export const INITIAL_HOSTS = [];

/** 초기 Priority Queue — 앞이 가장 높은 우선순위 */
export const INITIAL_PRIORITY_QUEUE = [];

export const DAY_LABELS = {
  monday: '월',
  tuesday: '화',
  wednesday: '수',
  thursday: '목',
};

export const createInitialState = () => ({
  hosts: [],
  priorityQueue: [],
  basePriorityQueue: [],
  weeks: [],
});
