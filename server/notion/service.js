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

export async function upsertSchedule(notion, scheduleDbId, week) {
  const existing = await queryAll(notion, scheduleDbId, {
    property: 'WeekKey',
    rich_text: { equals: week.weekKey },
  });

  const properties = {
    Name: titleProp(week.name),
    WeekKey: richTextProp(week.weekKey),
    WeekNumber: numberProp(week.weekNumber),
    Period: dateProp(week.startDate, week.endDate),
    Monday: richTextProp(week.monday ?? ''),
    Tuesday: richTextProp(week.tuesday ?? ''),
    Wednesday: richTextProp(week.wednesday ?? ''),
    Thursday: richTextProp(week.thursday ?? ''),
    SlackText: richTextProp(week.slackText ?? ''),
    Status: selectProp(existing[0] ? 'Updated' : 'Confirmed'),
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
