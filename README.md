# Daily Host Scheduler Pro

데일리 호스트 자동 배정 시스템입니다. 시작일~종료일을 조회하면 주차별 스케줄을 생성하고, Priority Queue 기반으로 호스트를 자동 배정합니다.

## 기술 스택

- React 19 (JavaScript / JSX)
- SCSS Modules
- Vite
- localStorage 영속성
- Notion API (멤버/확정 주차 히스토리 동기화, Express 프록시)

## 실행 방법

Node.js **20.19+** 필요.

```bash
cp .env.example .env   # Notion 토큰/DB ID 입력
npm install
npm run dev            # 웹(5173) + API(3001)
```

Notion 연동은 [docs/NOTION.md](./docs/NOTION.md) 참고.

## Vercel 배포 (프론트 + API 한곳)

이 프로젝트는 Vite 프론트와 Notion API(`api/`)를 **Vercel 하나**에서 같이 돌립니다.

1. GitHub에 푸시 후 [Vercel](https://vercel.com)에서 Import
2. Framework Preset: **Vite** (자동 감지)
3. Project → Settings → Environment Variables 에 아래 등록 후 Redeploy

| 변수 | 설명 |
|------|------|
| `NOTION_TOKEN` | Integration Secret |
| `NOTION_MEMBERS_DB_ID` | Members DB ID |
| `NOTION_SCHEDULE_DB_ID` | Schedule History DB ID |

4. 배포 URL에서 Notion 동기화 상태(연결됨) 확인

로컬은 기존처럼 `npm run dev`(Vite 프록시 → `localhost:3001`)를 사용합니다.

## 주요 기능

1. 호스트 관리 / Priority Queue / 수행 비율
2. 일정 조회 · 출근 체크 · 자동 배정 확정
3. Freeze Rule · InActive · Emergency Pass · Swap(+미배정 교체)
4. JSON 백업 · 슬랙 공유 복사
5. **Notion**: 멤버 push, 확정 주차 히스토리 upsert

## Notion DB 권장 구조

- **Members**: Name, Active, AppHostId
- **Schedule History**: WeekKey, Period, Mon~Thu, SlackText, Status

자세한 스키마와 셋업은 `docs/NOTION.md`에 있습니다.

## 예외 처리 및 백업 (Essential Safety Rules)

1. **Freeze Rule** — 이후 주차가 확정되면 과거 확정 주차는 동결(Swap/Pass 불가). 큐 재정렬은 미확정 차주 배정에만 영향.
2. **Member Status** — 비활성화 시 통계 유지, Priority Queue에서 제외. 활성 최소 2명.
3. **Data Backup** — localStorage 자동 저장 + JSON 내보내기/불러오기.
4. **Emergency Pass** — 확정 주차에서 당일 호스트를 큐 순위 유지한 채 2순위 출근자에게 이관.
