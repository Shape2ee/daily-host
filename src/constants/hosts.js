/** 삭제/비활성 시 유지해야 하는 최소 활성 호스트 수 */
export const MIN_HOST_COUNT = 2;

/** localStorage 키 */
export const STORAGE_KEY = 'daily-host-scheduler-pro';

/** Notion 미동기화 변경사항 플래그 */
export const NOTION_PENDING_KEY = 'daily-host-notion-pending';

/** 초기 호스트 샘플 데이터 */
export const INITIAL_HOSTS = [
  { id: 1, name: '홍길동', count: 0, totalWorkingDays: 0, active: true, notionPageId: null },
  { id: 2, name: '김철수', count: 0, totalWorkingDays: 0, active: true, notionPageId: null },
  { id: 3, name: '이영희', count: 0, totalWorkingDays: 0, active: true, notionPageId: null },
  { id: 4, name: '박민수', count: 0, totalWorkingDays: 0, active: true, notionPageId: null },
  { id: 5, name: '최선생', count: 0, totalWorkingDays: 0, active: true, notionPageId: null },
];

/** 초기 Priority Queue — 앞이 가장 높은 우선순위 */
export const INITIAL_PRIORITY_QUEUE = [1, 2, 3, 4, 5];

export const DAY_LABELS = {
  monday: '월',
  tuesday: '화',
  wednesday: '수',
  thursday: '목',
};

export const createInitialState = () => ({
  hosts: INITIAL_HOSTS.map((h) => ({ ...h })),
  priorityQueue: [...INITIAL_PRIORITY_QUEUE],
  basePriorityQueue: [...INITIAL_PRIORITY_QUEUE],
  weeks: [],
});
