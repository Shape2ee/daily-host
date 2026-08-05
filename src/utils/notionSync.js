import { DAY_KEYS, formatDate, formatSlackShare, getAvailableDays } from './scheduler.js';

/**
 * 확정 주차를 Notion upsert 페이로드로 변환한다.
 */
export function buildSchedulePayload(weeks, hostMap) {
  return weeks
    .map((week, index) => {
      if (!week.confirmed) return null;

      const weekNumber = index + 1;
      const dayNames = {};
      for (const day of DAY_KEYS) {
        const hostId = week.assignments[day];
        dayNames[day] =
          hostId !== undefined
            ? hostMap.get(hostId)?.name ?? ''
            : '';
      }

      const available = getAvailableDays(week);
      const hasAny = available.some((d) => week.assignments[d] !== undefined);
      if (!hasAny) return null;

      return {
        weekKey: week.id,
        weekNumber,
        name: `${weekNumber}주차 ${formatDate(week.startDate)}~${formatDate(week.endDate)}`,
        startDate: formatDate(week.startDate),
        endDate: formatDate(week.endDate),
        monday: dayNames.monday,
        tuesday: dayNames.tuesday,
        wednesday: dayNames.wednesday,
        thursday: dayNames.thursday,
        slackText: formatSlackShare(week, weekNumber, hostMap),
      };
    })
    .filter(Boolean);
}
