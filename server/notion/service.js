import { Client } from '@notionhq/client';
import {
  checkboxProp,
  dateProp,
  numberProp,
  plainText,
  richTextProp,
  selectProp,
  titleProp,
} from './schema.js';

export function createNotionClient(token) {
  return new Client({ auth: token });
}

export function getConfig() {
  return {
    token: process.env.NOTION_TOKEN ?? '',
    membersDbId: process.env.NOTION_MEMBERS_DB_ID ?? '',
    scheduleDbId: process.env.NOTION_SCHEDULE_DB_ID ?? '',
  };
}

export function assertConfigured(need = 'all') {
  const config = getConfig();
  if (!config.token) {
    const err = new Error('NOTION_TOKEN 이 설정되지 않았습니다.');
    err.status = 503;
    throw err;
  }
  if ((need === 'all' || need === 'members') && !config.membersDbId) {
    const err = new Error('NOTION_MEMBERS_DB_ID 가 설정되지 않았습니다.');
    err.status = 503;
    throw err;
  }
  if ((need === 'all' || need === 'schedule') && !config.scheduleDbId) {
    const err = new Error('NOTION_SCHEDULE_DB_ID 가 설정되지 않았습니다.');
    err.status = 503;
    throw err;
  }
  return config;
}

async function queryAll(notion, databaseId, filter) {
  const results = [];
  let cursor;

  do {
    const response = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
      ...(filter ? { filter } : {}),
    });
    results.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return results;
}

function mapMemberPage(page) {
  const props = page.properties ?? {};
  return {
    notionPageId: page.id,
    name: plainText(props.Name),
    active: props.Active?.checkbox !== false,
    appHostId: props.AppHostId?.number ?? null,
    priority: props.Priority?.number ?? null,
    basePriority: props.BasePriority?.number ?? null,
    note: plainText(props.Note),
  };
}

export async function listMembers(notion, membersDbId) {
  const pages = await queryAll(notion, membersDbId);
  return pages
    .map(mapMemberPage)
    .filter((m) => Boolean(m.name))
    .sort((a, b) => {
      const aPri =
        a.priority ?? a.basePriority ?? a.appHostId ?? Number.MAX_SAFE_INTEGER;
      const bPri =
        b.priority ?? b.basePriority ?? b.appHostId ?? Number.MAX_SAFE_INTEGER;
      if (aPri !== bPri) return aPri - bPri;
      return a.name.localeCompare(b.name, 'ko');
    });
}

function mapSchedulePage(page) {
  const props = page.properties ?? {};
  const period = props.Period?.date;
  return {
    notionPageId: page.id,
    name: plainText(props.Name),
    weekKey: plainText(props.WeekKey),
    weekNumber: props.WeekNumber?.number ?? null,
    startDate: period?.start ?? null,
    endDate: period?.end ?? period?.start ?? null,
    monday: plainText(props.Monday),
    tuesday: plainText(props.Tuesday),
    wednesday: plainText(props.Wednesday),
    thursday: plainText(props.Thursday),
    attendance: plainText(props.Attendance),
    slackText: plainText(props.SlackText),
    status: props.Status?.select?.name ?? null,
  };
}

export async function upsertMember(notion, membersDbId, member) {
  const existing = await queryAll(notion, membersDbId, {
    or: [
      ...(member.appHostId != null
        ? [
            {
              property: 'AppHostId',
              number: { equals: Number(member.appHostId) },
            },
          ]
        : []),
      {
        property: 'Name',
        title: { equals: member.name },
      },
    ],
  });

  const properties = {
    Name: titleProp(member.name),
    Active: checkboxProp(member.active !== false),
    AppHostId: numberProp(member.appHostId),
    Priority: numberProp(member.priority),
    BasePriority: numberProp(member.basePriority),
    Note: richTextProp(member.note ?? ''),
  };

  if (existing[0]) {
    const page = await notion.pages.update({
      page_id: existing[0].id,
      properties,
    });
    return mapMemberPage(page);
  }

  const page = await notion.pages.create({
    parent: { database_id: membersDbId },
    properties,
  });
  return mapMemberPage(page);
}

export async function listSchedules(notion, scheduleDbId) {
  const pages = await queryAll(notion, scheduleDbId);
  return pages
    .map(mapSchedulePage)
    .filter((s) => s.weekKey || s.name)
    .sort((a, b) => String(b.startDate ?? '').localeCompare(String(a.startDate ?? '')));
}

const WEEKDAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/** Asia/Seoul 기준 오늘 날짜(YYYY-MM-DD)와 요일 키 */
export function getSeoulToday() {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const weekdayLong = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    weekday: 'long',
  })
    .format(now)
    .toLowerCase();
  return { date, day: weekdayLong };
}

/**
 * 지정 날짜가 Period에 포함된 확정 주차에서 해당 요일 호스트를 반환한다.
 * 월~목만 배정. 해당 주차/호스트 없으면 hostName: null.
 */
export async function getHostForDate(notion, scheduleDbId, dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const seoulNoon = new Date(Date.UTC(y, m - 1, d, 3, 0, 0)); // UTC 03:00 = KST 12:00
  const day = WEEKDAY_KEYS[seoulNoon.getUTCDay()];

  const base = { date: dateStr, day, hostName: null, startDate: null, endDate: null };

  if (!['monday', 'tuesday', 'wednesday', 'thursday'].includes(day)) {
    return base;
  }

  const pages = await queryAll(notion, scheduleDbId, {
    and: [
      { property: 'Period', date: { on_or_before: dateStr } },
      { property: 'Period', date: { on_or_after: dateStr } },
    ],
  });

  const schedule = pages
    .map(mapSchedulePage)
    .find((item) => item.status !== 'Draft');
  if (!schedule) return base;

  const hostName = schedule[day] || null;

  return {
    date: dateStr,
    day,
    hostName,
    startDate: schedule.startDate,
    endDate: schedule.endDate,
  };
}

/**
 * Period가 [rangeStart, rangeEnd]와 겹치는 스케줄 페이지를 아카이브한다.
 * 범위가 없으면 Schedule History 전체 아카이브.
 */
export async function archiveSchedules(
  notion,
  scheduleDbId,
  { start: rangeStart, end: rangeEnd } = {},
) {
  const pages = await queryAll(notion, scheduleDbId);
  let archived = 0;

  for (const page of pages) {
    const schedule = mapSchedulePage(page);
    if (!schedule.weekKey && !schedule.name) continue;

    if (rangeStart && rangeEnd) {
      const start = schedule.startDate || schedule.endDate;
      const end = schedule.endDate || schedule.startDate;
      if (!start) continue;
      if (!(start <= rangeEnd && end >= rangeStart)) continue;
    }

    await notion.pages.update({
      page_id: page.id,
      archived: true,
    });
    archived += 1;
  }

  return { archived };
}

async function findSchedulePages(notion, scheduleDbId, week) {
  let existing = await queryAll(notion, scheduleDbId, {
    property: 'WeekKey',
    rich_text: { equals: week.weekKey },
  });

  // 레거시 weekKey(week-N-YYYY-MM-DD) → 월요일 키 마이그레이션:
  // WeekKey 미스 시 동일 Period 시작일로 기존 페이지를 찾아 갱신한다.
  if (!existing[0] && week.startDate) {
    const byPeriod = await queryAll(notion, scheduleDbId, {
      property: 'Period',
      date: { equals: week.startDate },
    });
    existing = byPeriod.filter((page) => {
      const period = page.properties?.Period?.date;
      return period?.start === week.startDate;
    });
  }
  return existing;
}

export async function upsertSchedule(notion, scheduleDbId, week) {
  const existing = await findSchedulePages(notion, scheduleDbId, week);
  const existingSchedule = existing[0]
    ? mapSchedulePage(existing[0])
    : null;

  // Draft 전체 upsert는 생성 전용이다. 기존 주차의 Attendance는 반드시
  // 단일 체크 병합 API로만 바꿔 stale 브라우저의 일괄 덮어쓰기를 막는다.
  if (existingSchedule && week.confirmed === false) {
    return { action: 'skipped', schedule: existingSchedule };
  }

  const properties = {
    Name: titleProp(week.name),
    WeekKey: richTextProp(week.weekKey),
    WeekNumber: numberProp(week.weekNumber),
    Period: dateProp(week.startDate, week.endDate),
    Monday: richTextProp(week.monday ?? ''),
    Tuesday: richTextProp(week.tuesday ?? ''),
    Wednesday: richTextProp(week.wednesday ?? ''),
    Thursday: richTextProp(week.thursday ?? ''),
    Attendance: richTextProp(week.attendance ?? ''),
    SlackText: richTextProp(week.slackText ?? ''),
    Status: selectProp(week.confirmed === false ? 'Draft' : 'Confirmed'),
  };

  if (existing[0]) {
    const page = await notion.pages.update({
      page_id: existing[0].id,
      properties,
    });
    return { action: 'updated', schedule: mapSchedulePage(page) };
  }

  const page = await notion.pages.create({
    parent: { database_id: scheduleDbId },
    properties,
  });
  return { action: 'created', schedule: mapSchedulePage(page) };
}

function parseAttendanceNames(text) {
  try {
    const parsed = JSON.parse(String(text ?? ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Draft 주차의 Attendance JSON에서 한 체크 항목만 read-modify-write 한다.
 * 저장 후 요청한 값이 유지됐는지 확인하고, 경합이 감지되면 최신 값 위에서 재시도한다.
 */
export async function patchScheduleAttendance(
  notion,
  scheduleDbId,
  { week, day, hostName, present },
) {
  if (!week?.weekKey || !hostName) {
    const error = new Error('week.weekKey와 hostName이 필요합니다.');
    error.status = 400;
    throw error;
  }
  if (!['monday', 'tuesday', 'wednesday', 'thursday'].includes(day)) {
    const error = new Error('유효하지 않은 요일입니다.');
    error.status = 400;
    throw error;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let pages = await findSchedulePages(notion, scheduleDbId, week);
    if (!pages[0]) {
      await upsertSchedule(notion, scheduleDbId, {
        ...week,
        confirmed: false,
      });
      pages = await findSchedulePages(notion, scheduleDbId, week);
    }

    const current = pages[0] ? mapSchedulePage(pages[0]) : null;
    if (!current) {
      const error = new Error('Draft 주차를 생성하지 못했습니다.');
      error.status = 500;
      throw error;
    }
    if (current.status !== 'Draft') {
      const error = new Error('확정된 주차의 출근 정보는 변경할 수 없습니다.');
      error.status = 409;
      throw error;
    }

    const attendance = parseAttendanceNames(current.attendance);
    const names = new Set(Array.isArray(attendance[day]) ? attendance[day] : []);
    if (present) names.add(hostName);
    else names.delete(hostName);
    attendance[day] = [...names];

    await notion.pages.update({
      page_id: pages[0].id,
      properties: {
        Attendance: richTextProp(JSON.stringify(attendance)),
      },
    });

    const verifiedPages = await findSchedulePages(notion, scheduleDbId, week);
    const verified = verifiedPages[0]
      ? mapSchedulePage(verifiedPages[0])
      : null;
    const verifiedAttendance = parseAttendanceNames(verified?.attendance);
    const isPresent = Array.isArray(verifiedAttendance[day])
      ? verifiedAttendance[day].includes(hostName)
      : false;

    if (isPresent === Boolean(present)) {
      return { schedule: verified, attempts: attempt + 1 };
    }
  }

  const error = new Error('동시 수정 충돌로 출근 정보를 저장하지 못했습니다.');
  error.status = 409;
  throw error;
}
