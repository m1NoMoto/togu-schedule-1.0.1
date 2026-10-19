// ============================================================================
// МОДУЛЬ ВЗАИМОДЕЙСТВИЯ С ОФИЦИАЛЬНЫМ ИСТОЧНИКОМ РАСПИСАНИЯ ТОГУ
// Источник: https://togudv.ru/rasp/groups/ и https://togudv.ru/rasp/groups/<id>/
// ============================================================================

export type OfficialLessonType = 'lecture' | 'practice' | 'lab' | 'seminar' | 'project';
export type OfficialWeekParity = 'odd' | 'even';

export interface ParsedCalendarEvent {
  id: string;
  dateTitle: string;
  timeRange: string;
  eventTypeShort: string;
  subject: string;
  sessionCategory: string;
  isOnline: boolean;
  room: string;
  roomUrl: string;
  teacher: string;
  teacherTitle: string;
  teacherUrl: string;
  isPast: boolean;
}

export interface ParsedLessonSlot {
  id: string;
  pairNumber: number;
  startTime: string;
  endTime: string;
  subject: string;
  type: OfficialLessonType;
  eventTypeShort: string;
  eventTypeFull: string;
  room: string;
  roomUrl: string;
  building: string;
  teacher: string;
  teacherTitle: string;
  teacherUrl: string;
  subgroup: 'all' | '1' | '2';
  weekParity: 'both' | OfficialWeekParity;
  dayOfWeek: number;
  dateRange: string;
  isOnline: boolean;
}

export interface ParsedGroupCatalogItem {
  id: string;
  code: string;
  name: string;
  specializationCode: string;
  instituteShort: string;
  instituteFull: string;
  course: number;
  degree: 'Бакалавриат' | 'Специалитет' | 'Магистратура' | 'Аспирантура';
  form: 'Очная' | 'Заочная' | 'Очно-заочная';
}

export interface ParsedScheduleDocument {
  groupId: string;
  groupCode: string;
  semester: string;
  serverDateText: string;
  serverWeekParity: OfficialWeekParity;
  serverWeekLabel: string;
  examsUrl: string;
  lessons: ParsedLessonSlot[];
  calendarEvents: ParsedCalendarEvent[];
  fetchedAtIso: string;
  sourceKind: 'official_live' | 'official_snapshot' | 'user_imported_html' | 'cached_official' | 'test_html_fixture' | 'demo_fallback';
  sourceUrl: string;
  contentHash: string;
}

export interface ScheduleDiffItem {
  key: string;
  changeType: 'added' | 'removed' | 'modified';
  description: string;
}

const PAIR_END_TIMES: Record<number, { start: string; end: string }> = {
  1: { start: '08:30', end: '10:00' },
  2: { start: '10:10', end: '11:40' },
  3: { start: '11:50', end: '13:20' },
  4: { start: '13:50', end: '15:20' },
  5: { start: '15:30', end: '17:00' },
  6: { start: '17:10', end: '18:40' },
  7: { start: '18:50', end: '20:20' },
  8: { start: '20:30', end: '22:00' },
};

const WEEKDAY_MAP: Record<string, number> = {
  'понедельник': 1,
  'вторник': 2,
  'среда': 3,
  'четверг': 4,
  'пятница': 5,
  'суббота': 6,
  'воскресенье': 7,
};

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveBuildingByRoom(room: string, isOnline: boolean): string {
  if (isOnline || room.toUpperCase().includes('ДИСТАН')) {
    return 'ЭИОС ТОГУ (Дистанционный формат)';
  }
  const r = room.toLowerCase();
  if (r.endsWith('ца')) return 'Центрально-административный корпус, Тихоокеанская, 136';
  if (r.endsWith('ц')) return 'Главный корпус (Центр), Тихоокеанская, 136';
  if (r.endsWith('л')) return 'Главный корпус (Левое крыло), Тихоокеанская, 136';
  if (r.endsWith('п')) return 'Главный корпус (Правое крыло), Тихоокеанская, 136';
  if (r.endsWith('с')) return 'Главный корпус (Северное крыло), Тихоокеанская, 136';
  if (r.includes('корп. 6') || r.includes('к.6')) return 'Педагогический институт (корп. 6), ул. Карла Маркса, 68';
  return 'Учебный корпус ТОГУ, Тихоокеанская, 136';
}

export function mapEventType(shortCode: string, fullTitle: string): OfficialLessonType {
  const s = shortCode.toLowerCase();
  const t = fullTitle.toLowerCase();
  if (s === 'лк' || t.includes('лекц')) return 'lecture';
  if (s === 'лб' || s === 'лаб' || t.includes('лаборатор')) return 'lab';
  if (s === 'пр' || t.includes('практич')) return 'practice';
  if (s.includes('зач') || s.includes('экз') || t.includes('семинар')) return 'seminar';
  return 'practice';
}

export function inferGroupMetadata(
  id: string,
  code: string,
  instituteShort: string,
  instituteFull: string,
  course: number
): ParsedGroupCatalogItem {
  let degree: ParsedGroupCatalogItem['degree'] = 'Бакалавриат';
  if (code.includes('(с)')) degree = 'Специалитет';
  else if (code.includes('(м)')) degree = 'Магистратура';
  else if (code.includes('(а)')) degree = 'Аспирантура';

  let form: ParsedGroupCatalogItem['form'] = 'Очная';
  if (code.includes('оз')) form = 'Очно-заочная';
  else if (/\)[з]/.test(code)) form = 'Заочная';

  const prefix = code.split('(')[0].trim();
  const specDescriptions: Record<string, { name: string; specCode: string }> = {
    'СУЗ': { name: 'Строительство уникальных зданий и сооружений', specCode: '08.05.01' },
    'ПГС': { name: 'Промышленное и гражданское строительство', specCode: '08.03.01' },
    'А': { name: 'Архитектура и архитектурное проектирование', specCode: '07.03.01' },
    'ДАС': { name: 'Дизайн архитектурной среды', specCode: '07.03.03' },
    'ПО': { name: 'Программное обеспечение и программная инженерия', specCode: '09.03.04' },
    'ИС': { name: 'Информационные системы и технологии', specCode: '09.03.02' },
    'КБ': { name: 'Компьютерная безопасность', specCode: '10.05.01' },
    'ПИЭ': { name: 'Прикладная информатика в экономике', specCode: '09.03.03' },
    'Ю': { name: 'Юриспруденция', specCode: '40.03.01' },
    'ПОНБ': { name: 'Правовое обеспечение национальной безопасности', specCode: '40.05.01' },
    'Ж': { name: 'Журналистика и медиакоммуникации', specCode: '42.03.02' },
    'РСО': { name: 'Реклама и связи с общественностью', specCode: '42.03.01' },
    'Лин': { name: 'Лингвистика и межкультурная коммуникация', specCode: '45.03.02' },
    'ЭБ': { name: 'Экономическая безопасность', specCode: '38.05.01' },
    'ГМУ': { name: 'Государственное и муниципальное управление', specCode: '38.03.04' },
  };

  const found = specDescriptions[prefix] || {
    name: `Образовательная программа ${prefix} (${instituteShort})`,
    specCode: degree === 'Специалитет' ? 'Специалитет ТОГУ' : degree === 'Магистратура' ? 'Магистратура ТОГУ' : 'Бакалавриат ТОГУ',
  };

  return {
    id,
    code,
    name: found.name,
    specializationCode: found.specCode,
    instituteShort,
    instituteFull,
    course,
    degree,
    form,
  };
}

// Хэширование нормализованного расписания для обнаружения изменений (FNV-1a 32-bit hex)
export function computeScheduleHash(lessons: ParsedLessonSlot[], calEvents: ParsedCalendarEvent[]): string {
  const payload = JSON.stringify({
    l: lessons.map((x) => [x.dayOfWeek, x.pairNumber, x.weekParity, x.subgroup, x.subject, x.type, x.room, x.teacher]),
    c: calEvents.map((c) => [c.dateTitle, c.timeRange, c.eventTypeShort, c.subject, c.room, c.teacher]),
  });
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// Сравнение старой и новой версий расписания группы
export function diffSchedules(prevLessons: ParsedLessonSlot[], nextLessons: ParsedLessonSlot[]): ScheduleDiffItem[] {
  const diffs: ScheduleDiffItem[] = [];
  const makeKey = (l: ParsedLessonSlot) => `${l.dayOfWeek}-${l.pairNumber}-${l.weekParity}-${l.subgroup}`;

  const prevMap = new Map<string, ParsedLessonSlot>();
  for (const p of prevLessons) prevMap.set(makeKey(p), p);

  const nextMap = new Map<string, ParsedLessonSlot>();
  for (const n of nextLessons) nextMap.set(makeKey(n), n);

  for (const [key, nextItem] of nextMap.entries()) {
    const prevItem = prevMap.get(key);
    if (!prevItem) {
      diffs.push({
        key,
        changeType: 'added',
        description: `Добавлена ${nextItem.pairNumber} пара: «${nextItem.subject}» (${nextItem.room || 'ДИСТАН.'})`,
      });
    } else if (
      prevItem.room !== nextItem.room ||
      prevItem.teacher !== nextItem.teacher ||
      prevItem.subject !== nextItem.subject
    ) {
      const details: string[] = [];
      if (prevItem.subject !== nextItem.subject) details.push(`предмет: «${prevItem.subject}» → «${nextItem.subject}»`);
      if (prevItem.room !== nextItem.room) details.push(`ауд.: ${prevItem.room || '—'} → ${nextItem.room || '—'}`);
      if (prevItem.teacher !== nextItem.teacher) details.push(`преп.: ${prevItem.teacher} → ${nextItem.teacher}`);
      diffs.push({
        key,
        changeType: 'modified',
        description: `Изменена ${nextItem.pairNumber} пара (${nextItem.subject}): ${details.join(', ')}`,
      });
    }
  }

  for (const [key, prevItem] of prevMap.entries()) {
    if (!nextMap.has(key)) {
      diffs.push({
        key,
        changeType: 'removed',
        description: `Отменена/удалена ${prevItem.pairNumber} пара: «${prevItem.subject}»`,
      });
    }
  }

  return diffs;
}

// Парсер HTML страницы каталога групп https://togudv.ru/rasp/groups/
export function parseOfficialGroupsHtml(html: string): ParsedGroupCatalogItem[] {
  if (!html || (!html.includes('rasp-group-list') && !html.includes('inst_name'))) {
    throw new Error('SCHEMA_CHANGED_ERROR: В HTML-документе каталога не найдена таблица .rasp-group-list');
  }

  const results: ParsedGroupCatalogItem[] = [];
  const instBlocks = html.split(/<p[^>]*class=["'][^"']*inst_name[^"']*["'][^>]*>/i).slice(1);

  for (const block of instBlocks) {
    const pEndIdx = block.indexOf('</p>');
    const instHeaderHtml = pEndIdx >= 0 ? block.slice(0, pEndIdx) : '';
    const bMatch = instHeaderHtml.match(/<b>(.*?)<\/b>/i);
    const instShort = bMatch ? stripTags(bMatch[1]) : 'ТОГУ';
    const instFullClean = stripTags(instHeaderHtml.replace(/\(<b>.*?<\/b>\)/i, '')).trim() || instShort;

    const tableMatch = block.match(/<table[^>]*class=["'][^"']*rasp-group-list[^"']*["'][^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) continue;
    const tableHtml = tableMatch[1];

    // Извлекаем заголовки курсов <th>1 курс</th>
    const thMatches = [...tableHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)];
    const courses = thMatches.map((m) => {
      const numMatch = stripTags(m[1]).match(/\d+/);
      return numMatch ? Number(numMatch[0]) : 1;
    });

    // Извлекаем ячейки <td> со списками групп по курсам
    const tdMatches = [...tableHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    tdMatches.forEach((tdMatch, colIdx) => {
      const course = courses[colIdx] || colIdx + 1;
      const tdHtml = tdMatch[1];
      const linkMatches = [...tdHtml.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
      for (const lm of linkMatches) {
        const rawHref = lm[1].replace(/^\/+|\/+$/g, '');
        const idMatch = rawHref.match(/(\d+)$/);
        const groupId = idMatch ? idMatch[1] : rawHref;
        const code = stripTags(lm[2]);
        if (groupId && code) {
          results.push(inferGroupMetadata(groupId, code, instShort, instFullClean, course));
        }
      }
    });
  }

  if (results.length === 0) {
    throw new Error('SCHEMA_CHANGED_ERROR: Не удалось извлечь ни одной учебной группы из HTML');
  }

  return results;
}

// Парсер HTML страницы расписания конкретной группы https://togudv.ru/rasp/groups/<id>/
export function parseOfficialScheduleHtml(
  html: string,
  fallbackGroupId = '68805',
  sourceKind: ParsedScheduleDocument['sourceKind'] = 'official_snapshot'
): ParsedScheduleDocument {
  if (!html || (!html.includes('id="all_weeks"') && !html.includes("id='all_weeks'") && !html.includes('class="rasp"'))) {
    throw new Error('SCHEMA_CHANGED_ERROR: HTML не соответствует структуре расписания ТОГУ (отсутствует #all_weeks / table.rasp)');
  }

  // 1. Название группы из <h1>Расписание занятий группы СУЗ(с) - 51</h1>
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1Text = h1Match ? stripTags(h1Match[1]) : '';
  const groupCode = h1Text.replace(/^Расписание занятий группы\s*/i, '').trim() || `Группа #${fallbackGroupId}`;

  // 2. ID группы из ссылки на экзамены /exams/68805/ или языковой ссылки
  const examsMatch = html.match(/href=["'](\/exams\/(\d+)\/?)["']/i);
  const examsUrl = examsMatch ? examsMatch[1] : `/exams/${fallbackGroupId}/`;
  const groupId = examsMatch ? examsMatch[2] : fallbackGroupId;

  // 3. Семестр из <p class="semester">
  const semMatch = html.match(/<p[^>]*class=["'][^"']*semester[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
  const semester = semMatch ? stripTags(semMatch[1]) : '2026 - 2027 учебный год, осенний семестр';

  // 4. Текущая дата и неделя сервера из .block_weektype
  let serverDateText = '18 октября, воскресенье';
  let serverWeekParity: OfficialWeekParity = 'odd';
  let serverWeekLabel = 'неделя по числителю';

  const blockWtMatch = html.match(/<div[^>]*class=["'][^"']*block_weektype[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (blockWtMatch) {
    const wtHtml = blockWtMatch[1];
    if (wtHtml.includes('weektype-2') || wtHtml.toLowerCase().includes('знаменател')) {
      serverWeekParity = 'even';
      serverWeekLabel = 'неделя по знаменателю';
    }
    const spans = [...wtHtml.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)]
      .map((m) => stripTags(m[1]))
      .filter((t) => t.length > 3 && !t.includes('неделя'));
    if (spans.length > 0) {
      serverDateText = spans[0];
    }
  }

  const lessons: ParsedLessonSlot[] = [];
  const calendarEvents: ParsedCalendarEvent[] = [];

  // 5. Извлечение блока #all_weeks (регулярное еженедельное расписание)
  const calWeekIdx = html.search(/<div[^>]*id=["']cal_week["']/i);
  const allWeeksStart = html.search(/<div[^>]*id=["']all_weeks["']/i);
  const allWeeksHtml =
    allWeeksStart >= 0
      ? html.slice(allWeeksStart, calWeekIdx > allWeeksStart ? calWeekIdx : html.length)
      : html;

  // Разбиваем #all_weeks по заголовкам дней недели <h3 class="rasp-weekday-title">День</h3>
  const daySegments = allWeeksHtml.split(/<h3[^>]*class=["'][^"']*rasp-weekday-title[^"']*["'][^>]*>/i).slice(1);

  for (const segment of daySegments) {
    const h3End = segment.indexOf('</h3>');
    if (h3End < 0) continue;
    const dayTitle = stripTags(segment.slice(0, h3End));
    const dayOfWeek = WEEKDAY_MAP[dayTitle.toLowerCase()] || 1;

    const tableMatch = segment.slice(h3End).match(/<table[^>]*class=["'][^"']*rasp[^"']*["'][^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) continue;
    const tableBodyHtml = tableMatch[1];

    const trMatches = [...tableBodyHtml.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/gi)];
    let currentPairNumber = 1;
    let currentStartTime = '08:30';
    let rowCounter = 0;

    for (const trMatch of trMatches) {
      const trAttrs = trMatch[1];
      const trInner = trMatch[2];
      rowCounter++;

      // Проверяем наличие td.time-hour (с учётом rowspan)
      const hourTdMatch = trInner.match(/<td[^>]*class=["'][^"']*time-hour[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
      if (hourTdMatch) {
        const hourText = stripTags(hourTdMatch[1]);
        const pairNumMatch = hourText.match(/(\d+)\s*пара/i);
        if (pairNumMatch) currentPairNumber = Number(pairNumMatch[1]);
        const timeMatch = hourText.match(/(\d{2}:\d{2})/);
        if (timeMatch) {
          currentStartTime = timeMatch[1];
        } else if (PAIR_END_TIMES[currentPairNumber]) {
          currentStartTime = PAIR_END_TIMES[currentPairNumber].start;
        }
      }

      const endTime = PAIR_END_TIMES[currentPairNumber]?.end || '10:00';

      // Определяем чётность недели из td.time-weektype или атрибутов tr
      let weekParity: 'both' | OfficialWeekParity = 'both';
      const wtTdMatch = trInner.match(/<td[^>]*class=["']([^"']*time-weektype[^"']*)["'][^>]*>([\s\S]*?)<\/td>/i);
      const wtClasses = (wtTdMatch ? wtTdMatch[1] : '') + ' ' + trAttrs;
      const wtContent = wtTdMatch ? stripTags(wtTdMatch[2]) : '';
      if (wtClasses.includes('weektype-1') || wtContent === 'Ч') {
        weekParity = 'odd';
      } else if (wtClasses.includes('weektype-2') || wtContent === 'З') {
        weekParity = 'even';
      }

      // Извлекаем ячейку дисциплины td.time-discipline
      const discTdMatch = trInner.match(/<td[^>]*class=["'][^"']*time-discipline[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
      if (!discTdMatch) continue;
      const discHtml = discTdMatch[1];

      // Подгруппа
      let subgroup: 'all' | '1' | '2' = 'all';
      const subgMatch = discHtml.match(/<span[^>]*class=["'][^"']*event-subgroup[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
      if (subgMatch) {
        const sgText = stripTags(subgMatch[1]);
        if (sgText.includes('1')) subgroup = '1';
        else if (sgText.includes('2')) subgroup = '2';
      }

      // Тип занятия
      const evTypeMatch = discHtml.match(/<span[^>]*class=["'][^"']*event-type[^"']*["']([^>]*)>([\s\S]*?)<\/span>/i);
      const evTypeAttrs = evTypeMatch ? evTypeMatch[1] : '';
      const eventTypeShort = evTypeMatch ? stripTags(evTypeMatch[2]) : 'пр';
      const titleAttrMatch = evTypeAttrs.match(/title=["']([^"']+)["']/i);
      const eventTypeFull = titleAttrMatch ? decodeHtmlEntities(titleAttrMatch[1]) : eventTypeShort;
      const lessonType = mapEventType(eventTypeShort, eventTypeFull);

      // Период дат (<strong>01.09.2026 – 11.01.2027</strong>)
      const strongMatch = discHtml.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i);
      const dateRange = strongMatch ? stripTags(strongMatch[1]) : '';

      // Дистанционный признак (<span class="label label-danger">ДИСТАН.</span>)
      const isOnline = /label-danger|ДИСТАН/i.test(discHtml);

      // Очищаем discHtml от вложенного мобильного блока .visible-xs и служебных тегов для получения чистого названия предмета
      const cleanedDiscHtml = discHtml
        .replace(/<div[^>]*class=["'][^"']*visible-xs[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '')
        .replace(/<span[^>]*class=["'][^"']*event-subgroup[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '')
        .replace(/<span[^>]*class=["'][^"']*event-type[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '')
        .replace(/<span[^>]*class=["'][^"']*label[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '')
        .replace(/<strong[^>]*>[\s\S]*?<\/strong>/gi, '')
        .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '');

      const subject = stripTags(cleanedDiscHtml) || 'Дисциплина по выбору';

      // Извлекаем аудиторию из десктопной ячейки td.time-room (последней в tr)
      const roomTdMatches = [...trInner.matchAll(/<td[^>]*class=["'][^"']*time-room[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi)];
      const roomTdHtml = roomTdMatches.length > 0 ? roomTdMatches[roomTdMatches.length - 1][1] : '';
      const roomLinkMatch = roomTdHtml.match(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      const roomUrl = roomLinkMatch ? roomLinkMatch[1] : '';
      const rawRoom = roomLinkMatch ? stripTags(roomLinkMatch[2]).replace(/\s+/g, '') : stripTags(roomTdHtml);
      const room = rawRoom || (isOnline ? 'ДИСТАН. (ЭИОС)' : 'По расписанию кафедры');
      const building = resolveBuildingByRoom(room, isOnline);

      // Извлекаем преподавателя из десктопной ячейки td.time-prepod
      const prepTdMatches = [...trInner.matchAll(/<td[^>]*class=["'][^"']*time-prepod[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi)];
      const prepTdHtml = prepTdMatches.length > 0 ? prepTdMatches[prepTdMatches.length - 1][1] : '';
      const prepTitleMatch = prepTdHtml.match(/<span[^>]*class=["'][^"']*prepod-title[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
      const teacherTitle = prepTitleMatch ? stripTags(prepTitleMatch[1]) : '';
      const prepLinkMatch = prepTdHtml.match(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      const teacherUrl = prepLinkMatch ? prepLinkMatch[1] : '';
      const teacher = prepLinkMatch ? stripTags(prepLinkMatch[2]) : 'Преподаватель кафедры';

      lessons.push({
        id: `${groupId}-d${dayOfWeek}-p${currentPairNumber}-r${rowCounter}`,
        pairNumber: currentPairNumber,
        startTime: currentStartTime,
        endTime,
        subject,
        type: lessonType,
        eventTypeShort,
        eventTypeFull,
        room,
        roomUrl,
        building,
        teacher,
        teacherTitle,
        teacherUrl,
        subgroup,
        weekParity,
        dayOfWeek,
        dateRange,
        isOnline,
      });
    }
  }

  // 6. Извлечение блока #cal_week (календарное расписание: зачёты, экзамены, практики)
  if (calWeekIdx >= 0) {
    const calSectionHtml = html.slice(calWeekIdx);
    const calBlocks = calSectionHtml.split(/<div[^>]*class=["'][^"']*status-(past|active)[^"']*["'][^>]*>/i);
    // calBlocks чередует: [prefix, statusType1, blockContent1, statusType2, blockContent2, ...]
    for (let i = 1; i < calBlocks.length; i += 2) {
      const statusType = calBlocks[i];
      const blockContent = calBlocks[i + 1] || '';
      const h3Match = blockContent.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
      if (!h3Match) continue;
      const dateTitle = stripTags(h3Match[1]);

      const trMatches = [...blockContent.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
      let calRow = 0;
      for (const trMatch of trMatches) {
        const trInner = trMatch[1];
        calRow++;
        const hourTdMatch = trInner.match(/<td[^>]*class=["'][^"']*time-hour[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
        const timeRange = hourTdMatch ? stripTags(hourTdMatch[1]) : '';

        const discTdMatch = trInner.match(/<td[^>]*class=["'][^"']*time-discipline[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
        if (!discTdMatch) continue;
        const discHtml = discTdMatch[1];

        const evTypeMatch = discHtml.match(/<span[^>]*class=["'][^"']*event-type[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
        const eventTypeShort = evTypeMatch ? stripTags(evTypeMatch[1]) : 'зач';

        const supMatch = discHtml.match(/<sup[^>]*>([\s\S]*?)<\/sup>/i);
        const sessionCategory = supMatch ? stripTags(supMatch[1]) : '';

        const isOnline = /label-danger|ДИСТАН/i.test(discHtml);

        const cleanedDisc = discHtml
          .replace(/<div[^>]*class=["'][^"']*visible-xs[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '')
          .replace(/<span[^>]*class=["'][^"']*event-type[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '')
          .replace(/<span[^>]*class=["'][^"']*label[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '')
          .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '');

        const subject = stripTags(cleanedDisc);

        const roomTdMatches = [...trInner.matchAll(/<td[^>]*class=["'][^"']*time-room[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi)];
        const roomTdHtml = roomTdMatches.length > 0 ? roomTdMatches[roomTdMatches.length - 1][1] : '';
        const roomLinkMatch = roomTdHtml.match(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
        const roomUrl = roomLinkMatch ? roomLinkMatch[1] : '';
        const room = roomLinkMatch ? stripTags(roomLinkMatch[2]) : isOnline ? 'ДИСТАН.' : stripTags(roomTdHtml);

        const prepTdMatches = [...trInner.matchAll(/<td[^>]*class=["'][^"']*time-prepod[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi)];
        const prepTdHtml = prepTdMatches.length > 0 ? prepTdMatches[prepTdMatches.length - 1][1] : '';
        const prepTitleMatch = prepTdHtml.match(/<span[^>]*class=["'][^"']*prepod-title[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
        const teacherTitle = prepTitleMatch ? stripTags(prepTitleMatch[1]) : '';
        const prepLinkMatch = prepTdHtml.match(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
        const teacherUrl = prepLinkMatch ? prepLinkMatch[1] : '';
        const teacher = prepLinkMatch ? stripTags(prepLinkMatch[2]) : '';

        calendarEvents.push({
          id: `${groupId}-cal-${i}-${calRow}`,
          dateTitle,
          timeRange,
          eventTypeShort,
          subject,
          sessionCategory,
          isOnline,
          room,
          roomUrl,
          teacher,
          teacherTitle,
          teacherUrl,
          isPast: statusType.toLowerCase() === 'past',
        });
      }
    }
  }

  const contentHash = computeScheduleHash(lessons, calendarEvents);

  return {
    groupId,
    groupCode,
    semester,
    serverDateText,
    serverWeekParity,
    serverWeekLabel,
    examsUrl,
    lessons,
    calendarEvents,
    fetchedAtIso: new Date().toISOString(),
    sourceKind,
    sourceUrl: `https://togudv.ru/rasp/groups/${groupId}/`,
    contentHash,
  };
}
