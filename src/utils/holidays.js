/**
 * 관공서의 공휴일에 관한 규정 기준 법정 공휴일.
 * 양력 고정일 + 음력 명절(korean-lunar-calendar) + 대체공휴일 규칙.
 */
import KoreanLunarCalendar from 'korean-lunar-calendar';

const holidayCache = new Map();
const lunarToSolarCache = new Map();

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function shiftDate(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function lunarToSolar(year, month, day) {
  const cacheKey = `${year}-${month}-${day}`;
  if (lunarToSolarCache.has(cacheKey)) {
    return lunarToSolarCache.get(cacheKey);
  }

  const calendar = new KoreanLunarCalendar();
  if (!calendar.setLunarDate(year, month, day, false)) {
    lunarToSolarCache.set(cacheKey, null);
    return null;
  }

  const solar = calendar.getSolarCalendar();
  const date = new Date(solar.year, solar.month - 1, solar.day);
  lunarToSolarCache.set(cacheKey, date);
  return date;
}

function strongerSubstitute(left, right) {
  if (left === 'weekend' || right === 'weekend') return 'weekend';
  if (left === 'sunday' || right === 'sunday') return 'sunday';
  return null;
}

function addHoliday(map, date, name, substitute) {
  if (!date) return;

  const key = toKey(date);
  const prev = map.get(key);
  if (!prev) {
    map.set(key, { name, substitute });
    return;
  }

  const names = new Set([...prev.name.split('·'), name]);
  map.set(key, {
    name: [...names].join('·'),
    substitute: strongerSubstitute(prev.substitute, substitute),
  });
}

function addFestival(map, center, labels, substitute) {
  if (!center) return;
  addHoliday(map, shiftDate(center, -1), labels[0], substitute);
  addHoliday(map, center, labels[1], substitute);
  addHoliday(map, shiftDate(center, 1), labels[2], substitute);
}

function addBaseHolidays(map, year) {
  const nationalSub = year >= 2023 ? 'weekend' : null;

  addHoliday(map, new Date(year, 0, 1), '신정', null);
  addHoliday(map, new Date(year, 2, 1), '삼일절', nationalSub);
  addHoliday(map, new Date(year, 4, 5), '어린이날', 'weekend');
  addHoliday(map, new Date(year, 5, 6), '현충일', null);
  addHoliday(map, new Date(year, 7, 15), '광복절', nationalSub);
  addHoliday(map, new Date(year, 9, 3), '개천절', nationalSub);
  addHoliday(map, new Date(year, 9, 9), '한글날', nationalSub);
  addHoliday(map, new Date(year, 11, 25), '크리스마스', null);

  addFestival(
    map,
    lunarToSolar(year, 1, 1),
    ['설날 전날', '설날', '설날 다음날'],
    'sunday',
  );
  addFestival(
    map,
    lunarToSolar(year, 8, 15),
    ['추석 전날', '추석', '추석 다음날'],
    'sunday',
  );
  addHoliday(map, lunarToSolar(year, 4, 8), '부처님오신날', null);
}

function isSunday(date) {
  return date.getDay() === 0;
}

function isSaturday(date) {
  return date.getDay() === 6;
}

function needsSubstitute(date, info) {
  if (!info.substitute) return false;

  const sundayOrOther = isSunday(date) || info.name.includes('·');

  if (info.substitute === 'sunday') {
    return sundayOrOther;
  }

  return isSaturday(date) || sundayOrOther;
}

function nextNonHoliday(date, map) {
  let cursor = shiftDate(date, 1);
  while (isSunday(cursor) || map.has(toKey(cursor))) {
    cursor = shiftDate(cursor, 1);
  }
  return cursor;
}

function addSubstitutes(map) {
  const baseEntries = [...map.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );

  for (const [key, info] of baseEntries) {
    const date = parseKey(key);
    if (!needsSubstitute(date, info)) continue;

    const substitute = nextNonHoliday(date, map);
    const subKey = toKey(substitute);
    if (map.has(subKey)) continue;

    map.set(subKey, {
      name: `대체공휴일(${info.name})`,
      substitute: null,
    });
  }
}

function buildHolidayMap(year) {
  const map = new Map();
  for (const y of [year - 1, year, year + 1]) {
    addBaseHolidays(map, y);
  }
  addSubstitutes(map);
  return map;
}

function holidayMapFor(year) {
  let map = holidayCache.get(year);
  if (!map) {
    map = buildHolidayMap(year);
    holidayCache.set(year, map);
  }
  return map;
}

/**
 * 해당 날짜의 공휴일 이름. 아니면 null.
 */
export function getPublicHoliday(date) {
  if (!date || Number.isNaN(date.getTime())) return null;
  const info = holidayMapFor(date.getFullYear()).get(toKey(date));
  return info?.name ?? null;
}

export function isPublicHoliday(date) {
  return getPublicHoliday(date) != null;
}

/**
 * start~end(포함) 구간의 공휴일 목록.
 */
export function listHolidaysBetween(startDate, endDate) {
  if (!startDate || !endDate) return [];

  const items = [];
  const cursor = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
  );
  const end = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate(),
  );

  while (cursor <= end) {
    const name = getPublicHoliday(cursor);
    if (name) {
      items.push({ date: toKey(cursor), name });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return items;
}
