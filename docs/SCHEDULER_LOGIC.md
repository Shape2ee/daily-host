# Scheduler Logic

Daily Host Scheduler Pro의 핵심 도메인 로직 정리입니다.  
구현 위치는 주로 `src/utils/scheduler.js`, `src/hooks/useScheduler.js`, `src/utils/notionSync.js` 입니다.

Notion DB/셋업은 [NOTION.md](./NOTION.md)를 참고하세요.

---

## 1. 개요

시작일~종료일을 조회하면 **월~목 단위 Week**를 만들고, **Priority Queue(배열 순서)** 로 호스트를 자동 배정합니다.

| 개념 | 설명 |
|------|------|
| Priority | 숫자 점수가 아님. **큐 배열에서 앞일수록 1위** |
| 정렬 기준 | **`count` 오름차순** → 동률이면 **마지막 배정이 늦은 쪽이 뒤** |
| Round-robin | 배정되면 큐 **맨 뒤(Tail)** 로 이동 후 `count` 기준 재정렬 |
| 표시명 | `N주차` 대신 **날짜 구간** (`2026-08-03~2026-08-06`) |

---

## 2. 핵심 데이터 구조

### 2.1 Host

```js
{
  id,                 // 앱 내부 ID (Notion AppHostId와 매핑)
  name,
  count,              // 확정 배정 횟수 (화면 표시)
  baselineCount,      // 복귀/신규 당일 평균 횟수(고정). 순위는 max(count, 이 값)
  lastHostedAt,       // 마지막 진행일 YYYY-MM-DD
  totalWorkingDays,   // 출근 일수 (비율 계산용, 순위에는 미반영)
  active,             // true | false
  softResetPending,   // count < baselineCount 와 동일 (보정 중)
  notionPageId?,
  note?,
}
```

- 활성 최소 인원: **2명** (`MIN_HOST_COUNT`)
- 비활성 시 통계는 유지, 큐에서만 제외
- 출근 비율(`calcWorkRatio` = `count / totalWorkingDays`)은 **표시 전용 참고 지표**입니다.
  출근 일수가 다른 멤버끼리 절대 횟수만 비교하면 왜곡되므로 기회 대비 부담을 보여주지만,
  배정 알고리즘은 이 값을 사용하지 않습니다.

### 2.2 Priority Queues

| 큐 | 역할 |
|----|------|
| `priorityQueue` | **실제 배정**에 쓰는 현재 활성 멤버 순서. Front = 다음 배정 후보 |
| `basePriorityQueue` | **기준 순서**. Swap / 일정 재조회 / **Notion hydrate** 시 여기서 시작해 확정 이력을 Replay |

둘 다 **활성 멤버 ID만** 포함합니다. (비활성은 제거)

### 2.3 Week

```js
{
  id,                 // weekKey (Notion upsert 키)
  startDate, endDate, // Date (월~목 구간)
  attendance,         // { monday: { [hostId]: boolean }, ... } — Notion Attendance(JSON)로 동기화
  assignments,        // { monday: hostId, ... }
  passes,             // 교환 관련 보조 필드
  confirmed,          // 확정 여부
  isLocked,           // 직전 주 미확정 시 잠금
}
```

- 배정 대상 요일: **월·화·수·목**만
- 잠금 규칙: 직전 Week가 확정된 경우에만 다음 미확정 Week 개방

---

## 3. 배정 알고리즘 (핵심 순환)

### 3.1 요일 배정 (`assignDay`)

1. 큐 **Front부터** 순회
2. 당일 `attendance === true` 인 **첫 멤버** 선택
3. 직전 요일 배정 여부는 **보지 않음** (연속 배정 가드 없음 — 순수 Round-robin)
4. 출근자 0명이면 미배정 → 주차 확정 불가 (`EMPTY_ATTENDANCE`)

### 3.2 주차 확정 (`assignWeek`)

1. 빈 출근 요일 검사
2. 월→목 순으로 `assignDay`
3. 배정될 때마다 `moveHostToQueueTail` → `sortQueueByCount` → `priorityQueue` 갱신
4. `count` / `totalWorkingDays` 갱신
5. `confirmed: true`, 다음 Week 잠금 해제
6. 보정 중이던 멤버의 `count`가 `baselineCount`에 도달하면 `softResetPending = false`

예시:

```
큐: [A, B, C, D]
월 A 배정 → [B, C, D, A]
화 B 배정 → [C, D, A, B]
수 C 배정 → [D, A, B, C]
목 D 배정 → [A, B, C, D]
```

> **활성 4명 + 월~목 전원 출근**이면 4번 Tail 이동 후 큐가 **원점**으로 돌아온다.  
> 월요일 배정자(A)가 다시 1위처럼 보이는 것은 버그가 아니라 Round-robin 결과다.  
> 활성 5명이면 예: `[E, A, B, C, D]` — A는 2위.

---

## 4. 멤버 Active / InActive

### 4.1 비활성화

- `count`, `totalWorkingDays`, `baselineCount` **유지**
- `priorityQueue`, `basePriorityQueue`에서 **제거**
- Notion Members `Active` 체크박스 **false** 로 동기화

### 4.2 재활성화 / 신규 추가 (평균 기준선)

휴면·신규로 0회가 되어 1위를 독식하는 것을 막습니다.

1. 현재 Active 멤버(본인 제외)의 **실제 진행 횟수 평균** (`Math.round`) → `baselineCount`
2. 순위 점수 = `max(count, baselineCount)`
3. `lastHostedAt = 당일` → 동률이면 복귀자/신규가 뒤
4. 화면에는 실제 `N회`와 **보정 중** 배지, 순위용 점수를 함께 표시
5. Notion `Active` + `BaselineCount` + `LastHostedAt` + `SoftResetPending` 동기화

신규 추가도 **같은 규칙**입니다. 기존 멤버가 없으면 기준선 0입니다.
이미 기준선 이상 횟수가 있으면 점수에 영향이 없고, 마지막 진행일만 당일로 갱신됩니다.

### 4.3 보정 해제 시점

기준선은 지우지 않아도 됩니다. 복귀자가 실제로 진행해서 `count`가 `baselineCount`에 도달하는 순간
`max(count, baselineCount) === count`가 되어 보정이 자연히 사라지고 **보정 중** 배지도 없어집니다.

```
복귀 시 baselineCount = 3, count = 0  → 점수 3 (보정 중)
1회 진행                 count = 1  → 점수 3 (보정 중)
3회 진행                 count = 3  → 점수 3 (보정 해제)
5회 진행                 count = 5  → 점수 5
```

기준선은 고정값이라 Replay/재조회로 `count`를 다시 세도 흔들리지 않습니다.
복귀 당일 `lastHostedAt`은 유지하고, 배정일과 비교해 더 늦은 쪽을 씁니다.

정렬: **점수(오름차순) → 마지막 진행일(오름차순, 늦은 쪽이 뒤)**

---

## 5. 일정 조회

### 5.1 생성 (`generateWeeks`)

- 시작일~종료일의 월~목만 모아 Week 골격 생성
- 첫 Week만 잠금 해제, 이후는 잠금

### 5.2 확정 기록 병합 (`mergeConfirmedIntoWeeks`)

같은 캘린더 주(해당 주 **월요일** 키)에 확정 기록이 있으면 **새 골격 대신 확정 Week를 유지**합니다.

소스 우선순위:

1. 로컬 `prev.weeks` 확정분
2. Notion Schedule History (조회 기간과 겹치는 항목)

### 5.3 횟수 / 큐 재계산

조회 후 `replayQueueAndCounts(basePriorityQueue, 확정 weeks)` 로  
`count` / `totalWorkingDays` / `lastHostedAt` / `priorityQueue` 를 다시 맞춥니다.  
(`baselineCount`는 유지)

---

## 6. Replay (`replayQueueAndCounts`)

사용 시점: **Swap**, **일정 재조회**, **Notion hydrate(멤버 로드)** 등.

1. `basePriorityQueue`의 활성 멤버로 시작
2. 확정 Week를 시간순으로 돌며 실제 `count`와 `lastHostedAt`을 재계산
3. 저장된 `baselineCount`와 비교해 점수 `max(count, baselineCount)`를 만들고, `lastHostedAt`은 저장된 값과 배정일 중 늦은 쪽
4. 점수 오름차순, 동률이면 마지막 진행일이 늦은 쪽이 뒤
5. 확정 배정 결과(assignments) 자체는 변경하지 않음 — **다음 미확정 배정용 큐만** 재구성

> Notion hydrate: Members의 **BaselineCount·LastHostedAt·BasePriority** + 확정 Schedule History로
> `replayQueueAndCounts`가 최종 `priorityQueue`를 재구성한다.

---

## 7. Swap (교체 / 맞교환)

- **확정된** Week만 가능
- **지난 날짜** 요일은 교환 불가
- 상대가 다른 Week의 **미래** 배정이면 맞교환
- 상대 미래 배정이 없으면 해당 요일만 교체
- 이후 `replayQueueAndCounts`로 큐·통계 재계산 → Notion 동기화

---

## 8. Freeze / 잠금

| 규칙 | 내용 |
|------|------|
| Week 잠금 (`isLocked`) | 직전 Week 미확정 시 다음 Week 확정 불가 |
| Freeze 표시 | 이후 확정 Week가 있으면 과거 확정 Week로 표시 |
| 교환 가능 여부 | Freeze와 무관. **캘린더상 지난 요일만** 불가, 미래는 주차 간 맞교환 가능 |

---

## 9. 공유 문구 / Notion 표시

주차 번호(`N주차`)는 사용하지 않습니다. **날짜 구간**만 씁니다.

슬랙 공유 예시:

```text
📢 [2026-08-03~2026-08-06 호스트] 월: 홍길동 | 화: 김철수 | 수: 이영희 | 목: 박민수
```

Notion Schedule `Name` 예시: `2026-08-03~2026-08-06`  
(`WeekNumber` 필드는 선택적으로 순서만 보관, 표시명에는 미사용)

---

## 10. Notion 동기화 (요약)

상세 스키마·셋업: [NOTION.md](./NOTION.md)

| 방향 | 시점 | 내용 |
|------|------|------|
| 앱 → Notion | 일정 조회, 출근 체크, Active 토글, 확정, Swap | Draft 주차 생성, 출근 단건 병합, Active, Priority, 확정 스케줄 |
| Notion → 앱 | 첫 진입, 멤버 불러오기, 일정 조회 | Draft/확정 출근 복원 + **BasePriority와 확정 스케줄만 Replay** |
| 영속 | 항상 | localStorage 자동 저장 (앱 원본에 가깝게 동작) |
| 실패 시 | Sync 실패 | 로컬 유지 + 미동기화 뱃지 + 재동기화 버튼 |

Active는 로컬 전용이 아닙니다. 토글 시 Notion `Active` 체크박스에 반영되고,  
불러오기/첫 진입 시 Notion 상태가 페이지에 반영됩니다.

**실시간 동기화는 아니다.**  
확정·토글 시 해당 브라우저는 Notion에 **즉시 push**하지만,  
이미 열린 다른 탭/PC는 자동 갱신되지 않는다.  
**페이지 열기 · 새로고침 · 멤버 불러오기 · 일정 조회** 시점에 Base+Replay로 맞춘다.  
Sync가 성공하면 Soft Reset 직후에도 서로 다른 브라우저에서 같은 Priority 순위가 나와야 한다.

---

## 11. 백업

- **localStorage**: 상태 변경 시 자동 저장
- **JSON 내보내기/불러오기**: `serializeBackup` / `parseBackup`  
  (`hosts`, 두 큐, `weeks`, `softResetPending` 포함)

---

## 12. 주요 파일 맵

| 파일 | 역할 |
|------|------|
| `src/utils/scheduler.js` | 배정, 큐, Active Soft Reset, Replay, Swap, 공유 문구 |
| `src/hooks/useScheduler.js` | 상태/액션, localStorage, 일정 조회 병합, Notion hydrate |
| `src/utils/notionSync.js` | Members/Schedule 페이로드 변환, 기간 필터 |
| `src/components/Dashboard/Dashboard.jsx` | UI 오케스트레이션, Notion push/pull 트리거 |
| `src/api/notion.js` | `/api/notion/*` 클라이언트 |
| `server/notion/service.js` | Notion API upsert/query |

---

## 13. 검증 체크리스트

- [x] `assignDay`에서 연속 배정 가드가 없고 큐 Front 순서만 따르는가?
- [x] Active 2명일 때 비활성 토글이 토스트와 함께 차단되는가?
- [x] Soft Reset 복귀자가 Active 평균 인덱스에 삽입되는가?
- [x] Active 1명일 때 Soft Reset 복귀자가 최소 2위(index ≥ 1)인가?
- [x] Soft Reset 다중 복귀 시 복귀 처리 순서로 순차 삽입되는가?
- [x] Swap / 일정 재조회 Replay 후에도 Soft Reset 위치가 유지되는가?
- [x] Notion 실패 시 로컬 유지 + 미동기화 뱃지 + 재동기화 버튼이 있는가?
- [x] 공유/Notion Name에 `N주차` 없이 날짜 구간만 사용되는가?
- [x] `count`가 많은 멤버가 큐 뒤로 밀리고, 동률이면 마지막 배정자가 뒤인가?
- [x] 일정 재조회 시 같은 기간 확정 기록이 유지되는가?
- [x] Notion hydrate가 Notion `Priority`가 아니라 **BasePriority + 확정 Schedule Replay**로 `priorityQueue`를 만드는가?
- [x] 활성 4명·월~목 전원 배정 후 큐가 원점으로 돌아오는 것이 Round-robin으로 설명되는가?

---

## 14. 한 줄 요약

**앞사람부터 배정 → 배정되면 뒤로.** (연속 배정 가드 없음)  
재활성·신규는 **활성 멤버 평균 횟수(round) 보정**,  
Swap / 재조회 / **Notion hydrate**는 **실제 횟수 + 보정 + 마지막 진행일**,  
Notion 실패 시에도 **로컬 우선** + 재동기화 UI,  
표시·공유·Notion Name은 **날짜 구간**만 사용합니다.  
브라우저 간 순위는 **열기/새로고침 시점**에 맞춘다(실시간 X).

---

## 15. 추가 예외 처리 & Edge Cases

1. **연속 배정 가드 제거**  
   직전 요일과 무관하게 큐 Front부터 출근 가능 멤버를 배정한다.

2. **복귀/신규 다중 적용**  
   각자 당시 활성 멤버 평균 횟수(`round`)를 기준선으로 잡고 당일을 마지막 진행일로 둔다.

3. **최소 활성 인원**  
   Active가 `MIN_HOST_COUNT`(2)명일 때 비활성 시도 → 토스트로 차단 (`MIN_HOSTS`).

4. **Notion Sync 실패 / Retry**  
   로컬(`localStorage`) 먼저 반영. 실패 시 상단 **미동기화 변경사항 존재** 뱃지 + **[Notion 재동기화]** 버튼.  
   플래그는 `NOTION_PENDING_KEY`로 브라우저에 유지된다.

5. **기준선 Replay 유지**  
   실제 `count`는 확정 이력으로 다시 세고, `baselineCount`와 복귀/신규 당일 `lastHostedAt`은 Notion에서 복원한다.
   `count`가 기준선을 넘어서면 보정은 자동으로 사라진다.

6. **활성 N명 = 배정 요일 수**  
   전원 출근으로 한 주를 확정하면 큐가 확정 전과 같아 보일 수 있다 (횟수 정렬 결과).

7. **크로스 브라우저 / 실시간**  
   Notion push는 즉시, 다른 클라이언트 반영은 hydrate·조회 시점. 이미 열린 탭은 자동 갱신 없음.

---

## 16. 구현 전 최종 검증 체크리스트

§13과 동일. 현재 구현 기준 모두 반영됨.
