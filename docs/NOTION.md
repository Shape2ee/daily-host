# Notion 연동 가이드

앱은 빠른 UI 상태를 localStorage에 보관하고, Notion은 **공유 멤버·주차·출근 상태**의 원격 저장소로 사용합니다.

## 권장 DB 구조 (2개)

### 1) `Daily Host · Members` (인원)

| 속성 | 타입 | 설명 |
|------|------|------|
| Name | Title | 호스트 이름 |
| Active | Checkbox | 활성 여부 (꺼지면 앱 큐에서 제외) |
| AppHostId | Number | 앱 내부 ID (매핑/upsert 키) |
| Priority | **Number** | **현재** Priority Queue 순서 (0이 다음 배정). 앱→Notion 백업용. **hydrate 시에는 사용하지 않음** |
| BasePriority | **Number** | 기준 큐 순서 (Swap / 재조회 / **hydrate Replay** 시작점) |
| Note | Rich text | 메모 (선택) |

### 2) `Daily Host · Schedule History` (공유 주차)

| 속성 | 타입 | 설명 |
|------|------|------|
| Name | Title | 예: `2026-08-03~2026-08-06` (날짜 구간) |
| WeekKey | Rich text | 앱 week.id (upsert 고유키) |
| WeekNumber | Number | (선택) 조회 구간 내 순서 — 표시명에는 사용하지 않음 |
| Period | Date | 시작~종료 |
| Monday | Rich text | 월요일 호스트 |
| Tuesday | Rich text | 화요일 호스트 |
| Wednesday | Rich text | 수요일 호스트 |
| Thursday | Rich text | 목요일 호스트 |
| Attendance | Rich text | 요일별 출근자 JSON (`{"monday":["홍길동"],...}`) |
| SlackText | Rich text | 슬랙 공유 문구 |
| Status | Select | `Draft`(출근 체크 중) / `Confirmed`(배정 확정) |

> `Priority` / `BasePriority` 는 반드시 **Number** 타입이어야 합니다. (텍스트면 API 오류)
>
> `Attendance` 가 비어 있는 레거시 행은 불러올 때 전원 출근으로 처리합니다.


## 셋업 순서

1. [Notion Integrations](https://www.notion.so/my-integrations) 에서 Integration 생성 → Secret 복사
2. Notion에 위 스키마로 Members / Schedule History DB 생성
3. 각 DB `⋯` → Connections 에서 Integration 연결
4. 프로젝트 루트 `.env`에 `NOTION_TOKEN`, `NOTION_MEMBERS_DB_ID`, `NOTION_SCHEDULE_DB_ID` 입력 (`.env.example` 참고)
5. `npm run dev` 실행 (웹 + API 서버)

### Vercel 배포 시

같은 변수를 Vercel Project Environment Variables에 넣고 Redeploy 합니다.  
API는 `api/index.js` → Express(`server/app.js`)로 동작하며, 프론트와 동일 도메인의 `/api/*`로 호출됩니다.

## 동기화 동작

| 버튼/이벤트 | 방향 | 내용 |
|-------------|------|------|
| 멤버·Active·우선순위 반영 | 앱 → Notion | Active 체크박스 + AppHostId + Priority/BasePriority upsert |
| 활성/비활성 토글 | 앱 → Notion | Active·큐 순서 즉시 자동 반영 |
| 멤버·Active 불러오기 / 앱 첫 진입 | Notion → 앱 hosts | Members(Active·**BasePriority**) + 확정 Schedule **Replay** → `priorityQueue` 재구성 (`Priority` 필드는 무시) |
| 일정 조회 | 양방향 | Notion Draft/확정 주차를 먼저 병합하고, 없는 미확정 주차를 `Draft`로 생성 |
| 출근 체크 | 앱 → Notion | 해당 주차의 최신 Attendance를 읽어 **한 체크 항목만 병합 저장** |
| 주차 확정 / 맞교환 / 멤버 변경 | 앱 → Notion | 스케줄 upsert(배정 + **요일별 출근자**) + Active·우선순위 자동 동기화 |
| 주차 업로드 (상단/패널) | 앱 → Notion | Draft 생성 + 확정 주차 일괄 upsert |
| 히스토리 조회 | Notion → 앱 모달 | 확정 이력 열람 |
| 앱 첫 진입 | Notion → 앱 weeks | **당월** Period와 겹치는 Draft/확정 주차 hydrate. 큐는 전체 확정 이력만 Replay |
| 일정/횟수 초기화 | 앱 + Notion | 로컬 weeks/횟수 초기화 + **당월** Schedule History 아카이브 |

### 브라우저 간 일치

- 출근 체크는 즉시 push되며, 같은 브라우저의 연속 변경은 주차별로 순차 처리한다.
- 다른 탭/PC의 변경은 **열기·새로고침·일정 조회** 때 가져온다(실시간 구독은 아님).
- Attendance는 Notion의 단일 JSON 필드이므로 서버에서 최신 값을 읽어 변경 항목만 병합하고, 저장 후 검증·재시도한다. Notion API가 조건부 원자 업데이트를 제공하지 않아 서로 다른 서버리스 인스턴스에서 완전히 동시에 쓰는 극단적 경합까지 100% 보장하지는 않는다.
- Sync 성공 시 일반적으로 동일 Priority가 보인다 (Base + 확정 이력 Replay).
- `softResetPending`은 Notion에 없음 → **재활성 Soft Reset 직후** 다른 브라우저에서는 복귀자 순위가 어긋날 수 있다. 상세는 [SCHEDULER_LOGIC.md §4.3](./SCHEDULER_LOGIC.md).

## 보안

`NOTION_TOKEN` 은 서버(`.env` / Vercel Environment Variables)에만 둡니다. 프론트엔드에 노출하지 마세요.
