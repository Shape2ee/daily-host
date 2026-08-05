/**
 * Notion DB property helpers
 *
 * 권장 구조 (DB 2개):
 * 1) Members  — Name, Active, AppHostId, Priority(Number), BasePriority(Number), Note
 * 2) Schedule History — Name, WeekKey, WeekNumber, Period,
 *    Monday~Thursday, SlackText, Status
 */

export function plainText(prop) {
  if (!prop) return '';
  if (prop.type === 'title') {
    return (prop.title ?? []).map((t) => t.plain_text).join('').trim();
  }
  if (prop.type === 'rich_text') {
    return (prop.rich_text ?? []).map((t) => t.plain_text).join('').trim();
  }
  return '';
}

export function titleProp(content) {
  return {
    title: [{ type: 'text', text: { content: String(content ?? '').slice(0, 2000) } }],
  };
}

export function richTextProp(content) {
  return {
    rich_text: [
      { type: 'text', text: { content: String(content ?? '').slice(0, 2000) } },
    ],
  };
}

export function numberProp(value) {
  return { number: value == null || value === '' ? null : Number(value) };
}

export function checkboxProp(value) {
  return { checkbox: Boolean(value) };
}

export function dateProp(start, end) {
  if (!start) return { date: null };
  return {
    date: {
      start,
      ...(end && end !== start ? { end } : {}),
    },
  };
}

export function selectProp(name) {
  return { select: name ? { name } : null };
}
