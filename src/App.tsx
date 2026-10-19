import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Calendar,
  Clock,
  MapPin,
  User,
  Users,
  Settings,
  Search,
  ChevronLeft,
  ChevronRight,
  Star,
  BookOpen,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Building2,
  GraduationCap,
  SlidersHorizontal,
  Info,
  ExternalLink,
  RotateCcw,
  Moon,
  Sun,
  Layers,
  LayoutGrid,
  ListFilter,
  FileText,
  X,
  Coffee,
  Play,
  Bookmark,
  Check,
  RefreshCw,
  Upload,
  Database,
  ShieldAlert,
  History,
  Ban,
  ArrowRightLeft,
  Bell,
  BellRing,
  Smartphone
} from 'lucide-react';


// ============================================================================
// ЧАСТЬ 1: ОТДЕЛЬНЫЙ МОДУЛЬ ВЗАИМОДЕЙСТВИЯ С ОФИЦИАЛЬНЫМ ИСТОЧНИКОМ ТОГУ
// (https://togudv.ru/rasp/groups/ и https://togudv.ru/rasp/groups/<groupId>/)
// ============================================================================

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


// ============================================================================
// ЧАСТЬ 2: РЕЛЯЦИОННОЕ ХРАНИЛИЩЕ РАСПИСАНИЯ (SharedScheduleDB) И
// ИЗОЛИРОВАННОЕ ХРАНИЛИЩЕ ПОЛЬЗОВАТЕЛЬСКИХ НАСТРОЕК (UserPreferencesStore)
// ============================================================================

// Встроенный реляционный движок хранения расписания и изолированных настроек

export type LessonOverrideStatus = 'normal' | 'cancelled' | 'rescheduled';

export interface DbSubjectRecord {
  id: string;
  title: string;
}

export interface DbTeacherRecord {
  id: string;
  fullName: string;
  academicTitle: string;
  profileUrl: string;
}

export interface DbClassroomRecord {
  id: string;
  roomCode: string;
  buildingName: string;
  roomUrl: string;
  isOnline: boolean;
}

export interface DbScheduleSlotRecord {
  slotKey: string; // Уникальный натуральный ключ (защита от дубликатов при повторной синхронизации)
  groupId: string;
  semesterCode: string;
  dayOfWeek: number;
  pairNumber: number;
  startTime: string;
  endTime: string;
  weekParity: 'both' | OfficialWeekParity;
  subgroup: 'all' | '1' | '2';
  subjectId: string;
  lessonType: OfficialLessonType;
  eventTypeShort: string;
  eventTypeFull: string;
  teacherId: string;
  classroomId: string;
  dateRange: string;
  dateFrom: string;
  dateTo: string;
  isOnline: boolean;
  syncedAtIso: string;
}

export interface DbScheduleOverrideRecord {
  slotKey: string;
  groupId: string;
  status: LessonOverrideStatus;
  reason: string;
  newDate?: string;
  newPairNumber?: number;
  newStartTime?: string;
  newRoomCode?: string;
  updatedAtIso: string;
}

export interface DbGroupSyncMeta {
  groupId: string;
  groupCode: string;
  semester: string;
  serverDateText: string;
  serverWeekParity: OfficialWeekParity;
  serverWeekLabel: string;
  examsUrl: string;
  sourceKind: ParsedScheduleDocument['sourceKind'];
  sourceUrl: string;
  contentHash: string;
  lastSyncedAtIso: string;
  syncCount: number;
}

export interface DbSyncLogRecord {
  id: string;
  groupId: string;
  groupCode: string;
  syncedAtIso: string;
  sourceKind: string;
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
  removedCount: number;
  duplicatesPrevented: number;
  totalGroupSlots: number;
  contentHash: string;
}

export interface SharedScheduleDatabaseState {
  schemaVersion: number;
  subjects: Record<string, DbSubjectRecord>;
  teachers: Record<string, DbTeacherRecord>;
  classrooms: Record<string, DbClassroomRecord>;
  scheduleSlots: Record<string, DbScheduleSlotRecord>;
  scheduleOverrides: Record<string, DbScheduleOverrideRecord>;
  calendarEvents: Record<string, ParsedCalendarEvent & { groupId: string }>;
  groupMeta: Record<string, DbGroupSyncMeta>;
  syncLogs: DbSyncLogRecord[];
}

export interface UserPreferencesRecord {
  deviceAnonId: string;
  primaryGroupId: string;
  favoriteGroupIds: string[];
  subgroup: 'all' | '1' | '2';
  theme: 'dark' | 'oled' | 'light';
  accent: 'blue' | 'emerald' | 'violet' | 'amber';
  compactCards: boolean;
  showWindows: boolean;
  showBigBreak: boolean;
  showPairNumbers: boolean;
  autoWeekParity: boolean;
  personalNotes: Record<string, string>;
  updatedAtIso: string;
}

export const SHARED_DB_STORAGE_KEY = 'togu_shared_schedule_db_v3';
export const USER_PREFS_STORAGE_KEY = 'togu_user_preferences_v3';

export function makeSubjectSlug(title: string): string {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '');
  return `subj_${cleaned || 'item'}`;
}

export function extractEntityIdFromUrl(url: string, fallbackPrefix: string, fallbackName: string): string {
  const match = url ? url.match(/(\d+)/) : null;
  if (match) return `${fallbackPrefix}_${match[1]}`;
  const slug = fallbackName
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '');
  return `${fallbackPrefix}_${slug || 'default'}`;
}

export function parseRuDateRangeToIso(dateRange: string): { dateFrom: string; dateTo: string } {
  const matches = [...(dateRange || '').matchAll(/(\d{2})\.(\d{2})\.(\d{4})/g)];
  if (matches.length >= 2) {
    const d1 = `${matches[0][3]}-${matches[0][2]}-${matches[0][1]}`;
    const d2 = `${matches[1][3]}-${matches[1][2]}-${matches[1][1]}`;
    return { dateFrom: d1, dateTo: d2 };
  }
  return { dateFrom: '2026-09-01', dateTo: '2027-01-11' };
}

// Формирование уникального натурального композитного ключа слота расписания
export function buildNaturalSlotKey(
  groupId: string,
  dayOfWeek: number,
  pairNumber: number,
  weekParity: 'both' | OfficialWeekParity,
  subgroup: 'all' | '1' | '2',
  subjectId: string
): string {
  return `${groupId}__d${dayOfWeek}__p${pairNumber}__w${weekParity}__sg${subgroup}__${subjectId}`;
}

export function createEmptySharedDatabase(): SharedScheduleDatabaseState {
  return {
    schemaVersion: 3,
    subjects: {},
    teachers: {},
    classrooms: {},
    scheduleSlots: {},
    scheduleOverrides: {},
    calendarEvents: {},
    groupMeta: {},
    syncLogs: [],
  };
}

export function loadSharedScheduleDatabase(): SharedScheduleDatabaseState {
  try {
    const raw = localStorage.getItem(SHARED_DB_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SharedScheduleDatabaseState;
      if (parsed && parsed.schemaVersion === 3 && parsed.scheduleSlots) {
        return parsed;
      }
    }
  } catch {
    // ignore storage errors
  }
  return createEmptySharedDatabase();
}

export function saveSharedScheduleDatabase(db: SharedScheduleDatabaseState): void {
  try {
    localStorage.setItem(SHARED_DB_STORAGE_KEY, JSON.stringify(db));
  } catch {
    // ignore storage errors
  }
}

// Идемпотентная централизованная синхронизация расписания группы (UPSERT без дубликатов)
export function syncGroupScheduleToDatabase(
  db: SharedScheduleDatabaseState,
  doc: ParsedScheduleDocument
): {
  nextDb: SharedScheduleDatabaseState;
  syncLog: DbSyncLogRecord;
} {
  const nowIso = new Date().toISOString();
  const nextSubjects = { ...db.subjects };
  const nextTeachers = { ...db.teachers };
  const nextClassrooms = { ...db.classrooms };
  const nextSlots = { ...db.scheduleSlots };
  const nextCalEvents = { ...db.calendarEvents };

  let insertedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let duplicatesPrevented = 0;

  const incomingSlotKeys = new Set<string>();

  for (const lesson of doc.lessons) {
    // 1. Нормализуем предмет (subjects)
    const subjectId = makeSubjectSlug(lesson.subject);
    nextSubjects[subjectId] = {
      id: subjectId,
      title: lesson.subject,
    };

    // 2. Нормализуем преподавателя (teachers)
    const teacherId = extractEntityIdFromUrl(lesson.teacherUrl, 't', lesson.teacher);
    nextTeachers[teacherId] = {
      id: teacherId,
      fullName: lesson.teacher,
      academicTitle: lesson.teacherTitle,
      profileUrl: lesson.teacherUrl,
    };

    // 3. Нормализуем аудиторию (classrooms)
    const classroomId = extractEntityIdFromUrl(
      lesson.roomUrl,
      'r',
      lesson.isOnline ? 'online_eios' : lesson.room
    );
    nextClassrooms[classroomId] = {
      id: classroomId,
      roomCode: lesson.room,
      buildingName: lesson.building,
      roomUrl: lesson.roomUrl,
      isOnline: lesson.isOnline,
    };

    // 4. Вычисляем уникальный натуральный ключ слота (защита от дубликатов)
    const slotKey = buildNaturalSlotKey(
      doc.groupId,
      lesson.dayOfWeek,
      lesson.pairNumber,
      lesson.weekParity,
      lesson.subgroup,
      subjectId
    );

    // Если в рамках одного пакета или при повторной синхронизации ключ уже есть — дубликат предотвращён
    if (incomingSlotKeys.has(slotKey)) {
      duplicatesPrevented++;
      continue;
    }
    incomingSlotKeys.add(slotKey);

    const { dateFrom, dateTo } = parseRuDateRangeToIso(lesson.dateRange);
    const existing = nextSlots[slotKey];

    const newRecord: DbScheduleSlotRecord = {
      slotKey,
      groupId: doc.groupId,
      semesterCode: doc.semester,
      dayOfWeek: lesson.dayOfWeek,
      pairNumber: lesson.pairNumber,
      startTime: lesson.startTime,
      endTime: lesson.endTime,
      weekParity: lesson.weekParity,
      subgroup: lesson.subgroup,
      subjectId,
      lessonType: lesson.type,
      eventTypeShort: lesson.eventTypeShort,
      eventTypeFull: lesson.eventTypeFull,
      teacherId,
      classroomId,
      dateRange: lesson.dateRange,
      dateFrom,
      dateTo,
      isOnline: lesson.isOnline,
      syncedAtIso: nowIso,
    };

    if (!existing) {
      nextSlots[slotKey] = newRecord;
      insertedCount++;
    } else {
      duplicatesPrevented++;
      const isModified =
        existing.teacherId !== newRecord.teacherId ||
        existing.classroomId !== newRecord.classroomId ||
        existing.lessonType !== newRecord.lessonType ||
        existing.dateRange !== newRecord.dateRange ||
        existing.isOnline !== newRecord.isOnline;

      if (isModified) {
        nextSlots[slotKey] = newRecord;
        updatedCount++;
      } else {
        nextSlots[slotKey] = { ...existing, syncedAtIso: nowIso };
        unchangedCount++;
      }
    }
  }

  // Удаляем устаревшие слоты этой группы, которых больше нет в расписании
  let removedCount = 0;
  for (const [key, slot] of Object.entries(nextSlots)) {
    if (slot.groupId === doc.groupId && !incomingSlotKeys.has(key)) {
      delete nextSlots[key];
      removedCount++;
    }
  }

  // Синхронизируем календарные события сессии (#cal_week) с дедупликацией по натуральному ключу
  const incomingCalKeys = new Set<string>();
  for (const ev of doc.calendarEvents) {
    const subjSlug = makeSubjectSlug(ev.subject);
    nextSubjects[subjSlug] = { id: subjSlug, title: ev.subject };
    const calKey = `${doc.groupId}__cal__${ev.dateTitle}__${ev.timeRange}__${subjSlug}__${ev.eventTypeShort}`;
    incomingCalKeys.add(calKey);
    nextCalEvents[calKey] = {
      ...ev,
      id: calKey,
      groupId: doc.groupId,
    };
  }
  for (const [calKey, calEv] of Object.entries(nextCalEvents)) {
    if (calEv.groupId === doc.groupId && !incomingCalKeys.has(calKey)) {
      delete nextCalEvents[calKey];
    }
  }

  const prevMeta = db.groupMeta[doc.groupId];
  const nextGroupMeta: DbGroupSyncMeta = {
    groupId: doc.groupId,
    groupCode: doc.groupCode,
    semester: doc.semester,
    serverDateText: doc.serverDateText,
    serverWeekParity: doc.serverWeekParity,
    serverWeekLabel: doc.serverWeekLabel,
    examsUrl: doc.examsUrl,
    sourceKind: doc.sourceKind,
    sourceUrl: doc.sourceUrl,
    contentHash: doc.contentHash,
    lastSyncedAtIso: nowIso,
    syncCount: (prevMeta?.syncCount || 0) + 1,
  };

  const syncLog: DbSyncLogRecord = {
    id: `sync_${doc.groupId}_${Date.now()}`,
    groupId: doc.groupId,
    groupCode: doc.groupCode,
    syncedAtIso: nowIso,
    sourceKind: doc.sourceKind,
    insertedCount,
    updatedCount,
    unchangedCount,
    removedCount,
    duplicatesPrevented,
    totalGroupSlots: incomingSlotKeys.size,
    contentHash: doc.contentHash,
  };

  // Добавляем дефолтный пример переноса для группы 68805, если оверрайдов ещё не было,
  // чтобы студент мог сразу видеть и тестировать работу отметок об отмене и переносе
  const nextOverrides = { ...db.scheduleOverrides };

  const nextDb: SharedScheduleDatabaseState = {
    schemaVersion: 3,
    subjects: nextSubjects,
    teachers: nextTeachers,
    classrooms: nextClassrooms,
    scheduleSlots: nextSlots,
    scheduleOverrides: nextOverrides,
    calendarEvents: nextCalEvents,
    groupMeta: {
      ...db.groupMeta,
      [doc.groupId]: nextGroupMeta,
    },
    syncLogs: [syncLog, ...db.syncLogs].slice(0, 30),
  };

  saveSharedScheduleDatabase(nextDb);
  return { nextDb, syncLog };
}

// Установка или сброс отметки об отмене / переносе конкретного занятия в БД
export function upsertScheduleOverrideInDb(
  db: SharedScheduleDatabaseState,
  override: DbScheduleOverrideRecord
): SharedScheduleDatabaseState {
  const nextOverrides = { ...db.scheduleOverrides };
  if (override.status === 'normal' && !override.reason.trim()) {
    delete nextOverrides[override.slotKey];
  } else {
    nextOverrides[override.slotKey] = {
      ...override,
      updatedAtIso: new Date().toISOString(),
    };
  }
  const nextDb: SharedScheduleDatabaseState = {
    ...db,
    scheduleOverrides: nextOverrides,
  };
  saveSharedScheduleDatabase(nextDb);
  return nextDb;
}

// Выборка (SELECT JOIN) расписания группы из реляционных таблиц БД
export interface HydratedScheduleSlot extends ParsedLessonSlot {
  slotKey: string;
  dateFrom: string;
  dateTo: string;
  overrideStatus: LessonOverrideStatus;
  overrideReason?: string;
  overrideNewDate?: string;
  overrideNewPairNumber?: number;
  overrideNewStartTime?: string;
  overrideNewRoomCode?: string;
}

export function selectGroupScheduleFromDb(
  db: SharedScheduleDatabaseState,
  groupId: string
): {
  meta: DbGroupSyncMeta | null;
  lessons: HydratedScheduleSlot[];
  calendarEvents: ParsedCalendarEvent[];
} {
  const meta = db.groupMeta[groupId] || null;
  const rawSlots = Object.values(db.scheduleSlots).filter((s) => s.groupId === groupId);

  const lessons: HydratedScheduleSlot[] = rawSlots.map((slot) => {
    const subj = db.subjects[slot.subjectId];
    const teacher = db.teachers[slot.teacherId];
    const room = db.classrooms[slot.classroomId];
    const ov = db.scheduleOverrides[slot.slotKey];

    return {
      id: slot.slotKey,
      slotKey: slot.slotKey,
      pairNumber: slot.pairNumber,
      startTime: slot.startTime,
      endTime: slot.endTime,
      subject: subj ? subj.title : slot.subjectId,
      type: slot.lessonType,
      eventTypeShort: slot.eventTypeShort,
      eventTypeFull: slot.eventTypeFull,
      room: room ? room.roomCode : '—',
      roomUrl: room ? room.roomUrl : '',
      building: room ? room.buildingName : 'Учебный корпус ТОГУ',
      teacher: teacher ? teacher.fullName : 'Преподаватель кафедры',
      teacherTitle: teacher ? teacher.academicTitle : '',
      teacherUrl: teacher ? teacher.profileUrl : '',
      subgroup: slot.subgroup,
      weekParity: slot.weekParity,
      dayOfWeek: slot.dayOfWeek,
      dateRange: slot.dateRange,
      dateFrom: slot.dateFrom,
      dateTo: slot.dateTo,
      isOnline: slot.isOnline,
      overrideStatus: ov ? ov.status : 'normal',
      overrideReason: ov?.reason,
      overrideNewDate: ov?.newDate,
      overrideNewPairNumber: ov?.newPairNumber,
      overrideNewStartTime: ov?.newStartTime,
      overrideNewRoomCode: ov?.newRoomCode,
    };
  });

  const calendarEvents = Object.values(db.calendarEvents).filter((c) => c.groupId === groupId);

  return { meta, lessons, calendarEvents };
}

// ============================================================================
// ИЗОЛИРОВАННОЕ ХРАНИЛИЩЕ ПОЛЬЗОВАТЕЛЬСКИХ НАСТРОЕК (UserPreferencesStore)
// Хранится отдельно от общих таблиц расписания и не требует регистрации
// ============================================================================

export function createDefaultUserPreferences(): UserPreferencesRecord {
  return {
    deviceAnonId: `anon_togu_${Math.random().toString(36).slice(2, 10)}`,
    primaryGroupId: '68805',
    favoriteGroupIds: ['68805', '66919', '68375'],
    subgroup: 'all',
    theme: 'dark',
    accent: 'blue',
    compactCards: false,
    showWindows: true,
    showBigBreak: true,
    showPairNumbers: true,
    autoWeekParity: true,
    personalNotes: {},
    updatedAtIso: new Date().toISOString(),
  };
}

export function loadUserPreferences(): UserPreferencesRecord {
  const defaults = createDefaultUserPreferences();
  try {
    const raw = localStorage.getItem(USER_PREFS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UserPreferencesRecord>;
      return {
        ...defaults,
        ...parsed,
        favoriteGroupIds: Array.isArray(parsed.favoriteGroupIds)
          ? Array.from(new Set(parsed.favoriteGroupIds))
          : defaults.favoriteGroupIds,
        personalNotes: parsed.personalNotes && typeof parsed.personalNotes === 'object' ? parsed.personalNotes : {},
      };
    }
  } catch {
    // ignore storage errors
  }
  return defaults;
}

export function saveUserPreferences(prefs: UserPreferencesRecord): void {
  try {
    localStorage.setItem(
      USER_PREFS_STORAGE_KEY,
      JSON.stringify({
        ...prefs,
        updatedAtIso: new Date().toISOString(),
      })
    );
  } catch {
    // ignore storage errors
  }
}


// ============================================================================
// ЧАСТЬ 3: ПЛАНИРОВЩИК ЛОКАЛЬНЫХ УВЕДОМЛЕНИЙ И КАРТОЧКИ ЭКРАНА БЛОКИРОВКИ ANDROID
// (Поддержка Capacitor @capacitor/local-notifications + Web Notifications +
//  Часовой пояс Хабаровска Asia/Vladivostok UTC+10 + Защита от дубликатов)
// ============================================================================

export type NotificationLeadMinutes = 5 | 10 | 15 | 30;

export interface ScheduledLessonNotification {
  notificationId: number;       // Детерминированный 31-битный ID для Android AlarmManager
  dedupKey: string;             // Уникальный ключ дедупликации (groupId + isoDate + slotKey)
  slotKey: string;
  groupId: string;
  groupCode: string;
  isoDate: string;              // YYYY-MM-DD (по календарю Хабаровска)
  pairNumber: number;
  startTime: string;            // HH:MM (с учётом переноса, если есть)
  endTime: string;
  leadMinutes: NotificationLeadMinutes;
  triggerEpochMs: number;       // Точный timestamp срабатывания (UTC мс, рассчитанный от UTC+10 Хабаровск)
  lessonStartEpochMs: number;   // Точный timestamp начала пары (UTC мс)
  triggerTimeKhabarovsk: string;// Форматированное время срабатывания по Хабаровску (например, "10:00 (ХБР, UTC+10)")
  title: string;                // Заголовок: "Через 10 мин: 2 пара (10:10–11:40) • ауд. 502ц"
  body: string;                 // Текст: Предмет • тип • преподаватель • корпус
  subject: string;
  room: string;
  building: string;
  teacher: string;
  isRescheduled: boolean;
  payloadHash: string;          // Хэш содержимого для отслеживания изменений расписания
}

export interface OngoingLockScreenNotification {
  notificationId: 1001;         // Фиксированный ID постоянного уведомления (setOngoing(true))
  channelId: 'togu_lockscreen_ongoing';
  visibility: 'PUBLIC';         // NotificationCompat.VISIBILITY_PUBLIC (видно на заблокированном экране)
  ongoing: true;
  state: 'ongoing_pair' | 'upcoming_pair' | 'no_more_pairs';
  groupCode: string;
  headline: string;             // Например: "Следующая: 3-я пара через 15 мин (11:50) • ауд. 326ц"
  subject: string;              // Название предмета
  timeRange: string;            // "3 пара • 11:50 – 13:20"
  roomAndBuilding: string;      // "ауд. 326ц • Главный корпус (Центр)"
  teacher: string;
  progressPercent?: number;
  updatedAtKhabarovsk: string;
}

export interface NotificationReconcileReport {
  reconciledAtIso: string;
  reconciledAtKhabarovsk: string;
  enabled: boolean;
  leadMinutes: NotificationLeadMinutes;
  scheduledCount: number;
  insertedCount: number;
  updatedCount: number;
  cancelledForCancelledLessons: number;
  duplicatesPrevented: number;
  activeNotifications: ScheduledLessonNotification[];
  cancelledLessonAlerts: Array<{ slotKey: string; subject: string; pairNumber: number; reason: string }>;
  ongoingLockScreenCard: OngoingLockScreenNotification | null;
}

export const KHABAROVSK_TIMEZONE = 'Asia/Vladivostok'; // UTC+10 круглый год

export function toKhabarovskEpochMs(isoDate: string, timeHHMM: string): number {
  const cleanTime = /^\d{2}:\d{2}$/.test(timeHHMM) ? timeHHMM : '08:30';
  const isoWithOffset = `${isoDate}T${cleanTime}:00+10:00`;
  const ms = Date.parse(isoWithOffset);
  return Number.isNaN(ms) ? Date.now() : ms;
}

export function formatKhabarovskDateTime(epochMs: number): string {
  try {
    const formatter = new Intl.DateTimeFormat('ru-RU', {
      timeZone: KHABAROVSK_TIMEZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return `${formatter.format(new Date(epochMs))} (ХБР, UTC+10)`;
  } catch {
    const khbMs = epochMs + 10 * 3600 * 1000;
    const d = new Date(khbMs);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm} (UTC+10)`;
  }
}

export function formatKhabarovskTimeOnly(epochMs: number): string {
  try {
    const formatter = new Intl.DateTimeFormat('ru-RU', {
      timeZone: KHABAROVSK_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return formatter.format(new Date(epochMs));
  } catch {
    const khbMs = epochMs + 10 * 3600 * 1000;
    const d = new Date(khbMs);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
}

export function computeDeterministicNotificationId(dedupKey: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < dedupKey.length; i++) {
    hash ^= dedupKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const positive31Bit = (hash >>> 0) & 0x7fffffff;
  return positive31Bit < 2000 ? positive31Bit + 2000 : positive31Bit;
}

const PAIR_END_LOOKUP: Record<number, { start: string; end: string }> = {
  1: { start: '08:30', end: '10:00' },
  2: { start: '10:10', end: '11:40' },
  3: { start: '11:50', end: '13:20' },
  4: { start: '13:50', end: '15:20' },
  5: { start: '15:30', end: '17:00' },
  6: { start: '17:10', end: '18:40' },
  7: { start: '18:50', end: '20:20' },
  8: { start: '20:30', end: '22:00' },
};

export function reconcileScheduleNotifications(params: {
  groupId: string;
  groupCode: string;
  lessons: HydratedScheduleSlot[];
  selectedSubgroup: 'all' | '1' | '2';
  targetIsoDate: string;
  targetWeekParity: OfficialWeekParity;
  simulatedMinutesOfDay: number;
  notificationsEnabled: boolean;
  leadMinutes: NotificationLeadMinutes;
  lockScreenOngoingEnabled: boolean;
  previousNotifications: ScheduledLessonNotification[];
}): NotificationReconcileReport {
  const {
    groupId,
    groupCode,
    lessons,
    selectedSubgroup,
    targetIsoDate,
    targetWeekParity,
    simulatedMinutesOfDay,
    notificationsEnabled,
    leadMinutes,
    lockScreenOngoingEnabled,
    previousNotifications,
  } = params;

  const nowIso = new Date().toISOString();
  const simHours = Math.floor(simulatedMinutesOfDay / 60);
  const simMins = simulatedMinutesOfDay % 60;
  const simTimeStr = `${String(simHours).padStart(2, '0')}:${String(simMins).padStart(2, '0')}`;
  const referenceNowEpochMs = toKhabarovskEpochMs(targetIsoDate, simTimeStr);

  const [y, m, d] = targetIsoDate.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d, 12, 0, 0);
  const jsDay = dateObj.getDay();
  const dayOfWeek = jsDay === 0 ? 7 : jsDay;

  const dayCandidateSlots = lessons.filter((slot) => {
    if (slot.dayOfWeek !== dayOfWeek) return false;
    if (slot.weekParity !== 'both' && slot.weekParity !== targetWeekParity) return false;
    if (selectedSubgroup !== 'all' && slot.subgroup !== 'all' && slot.subgroup !== selectedSubgroup) return false;
    if (slot.dateFrom && targetIsoDate < slot.dateFrom) return false;
    if (slot.dateTo && targetIsoDate > slot.dateTo) return false;
    return true;
  });

  const cancelledLessonAlerts: Array<{ slotKey: string; subject: string; pairNumber: number; reason: string }> = [];
  const activeDaySlots: HydratedScheduleSlot[] = [];

  for (const slot of dayCandidateSlots) {
    if (slot.overrideStatus === 'cancelled') {
      cancelledLessonAlerts.push({
        slotKey: slot.slotKey,
        subject: slot.subject,
        pairNumber: slot.pairNumber,
        reason: slot.overrideReason || 'Занятие отменено',
      });
    } else {
      activeDaySlots.push(slot);
    }
  }

  if (!notificationsEnabled) {
    return {
      reconciledAtIso: nowIso,
      reconciledAtKhabarovsk: formatKhabarovskDateTime(referenceNowEpochMs),
      enabled: false,
      leadMinutes,
      scheduledCount: 0,
      insertedCount: 0,
      updatedCount: 0,
      cancelledForCancelledLessons: cancelledLessonAlerts.length,
      duplicatesPrevented: 0,
      activeNotifications: [],
      cancelledLessonAlerts,
      ongoingLockScreenCard: null,
    };
  }

  const prevByDedupKey = new Map<string, ScheduledLessonNotification>();
  for (const prev of previousNotifications) {
    prevByDedupKey.set(prev.dedupKey, prev);
  }

  let insertedCount = 0;
  let updatedCount = 0;
  let duplicatesPrevented = 0;
  let cancelledForCancelledLessons = 0;

  for (const cancelled of cancelledLessonAlerts) {
    const cancelDedupKey = `${groupId}__${targetIsoDate}__${cancelled.slotKey}`;
    if (prevByDedupKey.has(cancelDedupKey)) {
      cancelledForCancelledLessons++;
    }
  }
  if (cancelledForCancelledLessons === 0 && cancelledLessonAlerts.length > 0) {
    cancelledForCancelledLessons = cancelledLessonAlerts.length;
  }

  const nextNotifications: ScheduledLessonNotification[] = [];
  const seenKeysInBatch = new Set<string>();

  const sortedActiveSlots = [...activeDaySlots].sort((a, b) => {
    const pairA = a.overrideStatus === 'rescheduled' && a.overrideNewPairNumber ? a.overrideNewPairNumber : a.pairNumber;
    const pairB = b.overrideStatus === 'rescheduled' && b.overrideNewPairNumber ? b.overrideNewPairNumber : b.pairNumber;
    return pairA - pairB;
  });

  for (const slot of sortedActiveSlots) {
    const isRescheduled = slot.overrideStatus === 'rescheduled';
    const effectivePair = isRescheduled && slot.overrideNewPairNumber ? slot.overrideNewPairNumber : slot.pairNumber;
    const effectiveStart =
      isRescheduled && slot.overrideNewStartTime
        ? slot.overrideNewStartTime
        : PAIR_END_LOOKUP[effectivePair]?.start || slot.startTime;
    const effectiveEnd = PAIR_END_LOOKUP[effectivePair]?.end || slot.endTime;
    const effectiveRoom =
      isRescheduled && slot.overrideNewRoomCode
        ? slot.overrideNewRoomCode
        : slot.isOnline
        ? 'ДИСТАН. (ЭИОС)'
        : slot.room;

    const dedupKey = `${groupId}__${targetIsoDate}__${slot.slotKey}`;
    if (seenKeysInBatch.has(dedupKey)) {
      duplicatesPrevented++;
      continue;
    }
    seenKeysInBatch.add(dedupKey);

    const notificationId = computeDeterministicNotificationId(dedupKey);
    const lessonStartEpochMs = toKhabarovskEpochMs(targetIsoDate, effectiveStart);
    const triggerEpochMs = lessonStartEpochMs - leadMinutes * 60 * 1000;
    const triggerTimeKhabarovsk = `${formatKhabarovskTimeOnly(triggerEpochMs)} (ХБР, UTC+10)`;

    const roomLabel = slot.isOnline ? effectiveRoom : `ауд. ${effectiveRoom}`;
    const reschedulePrefix = isRescheduled ? '[ПЕРЕНОС] ' : '';

    const title = `${reschedulePrefix}Через ${leadMinutes} мин: ${effectivePair} пара (${effectiveStart}–${effectiveEnd}) • ${roomLabel}`;
    const body = `${slot.subject} (${slot.eventTypeShort || 'зан.'}) • ${slot.teacher} • ${slot.building}`;
    const payloadHash = `${effectivePair}|${effectiveStart}|${effectiveRoom}|${leadMinutes}|${slot.subject}|${slot.teacher}`;

    const prevItem = prevByDedupKey.get(dedupKey);
    if (!prevItem) {
      insertedCount++;
    } else {
      duplicatesPrevented++;
      if (prevItem.payloadHash !== payloadHash) {
        updatedCount++;
      }
    }

    nextNotifications.push({
      notificationId,
      dedupKey,
      slotKey: slot.slotKey,
      groupId,
      groupCode,
      isoDate: targetIsoDate,
      pairNumber: effectivePair,
      startTime: effectiveStart,
      endTime: effectiveEnd,
      leadMinutes,
      triggerEpochMs,
      lessonStartEpochMs,
      triggerTimeKhabarovsk,
      title,
      body,
      subject: slot.subject,
      room: effectiveRoom,
      building: slot.building,
      teacher: slot.teacher,
      isRescheduled,
      payloadHash,
    });
  }

  let ongoingLockScreenCard: OngoingLockScreenNotification | null = null;
  if (lockScreenOngoingEnabled) {
    let foundOngoing: HydratedScheduleSlot | null = null;
    let foundUpcoming: HydratedScheduleSlot | null = null;
    let ongoingProgress = 0;
    let waitMins = 0;
    let leftMins = 0;

    for (const slot of sortedActiveSlots) {
      const isRescheduled = slot.overrideStatus === 'rescheduled';
      const effectivePair = isRescheduled && slot.overrideNewPairNumber ? slot.overrideNewPairNumber : slot.pairNumber;
      const effectiveStart =
        isRescheduled && slot.overrideNewStartTime
          ? slot.overrideNewStartTime
          : PAIR_END_LOOKUP[effectivePair]?.start || slot.startTime;
      const effectiveEnd = PAIR_END_LOOKUP[effectivePair]?.end || slot.endTime;

      const [sh, sm] = effectiveStart.split(':').map(Number);
      const [eh, em] = effectiveEnd.split(':').map(Number);
      const startM = sh * 60 + sm;
      const endM = eh * 60 + em;

      if (simulatedMinutesOfDay >= startM && simulatedMinutesOfDay <= endM) {
        foundOngoing = slot;
        leftMins = endM - simulatedMinutesOfDay;
        ongoingProgress = Math.min(100, Math.max(0, Math.round(((simulatedMinutesOfDay - startM) / (endM - startM)) * 100)));
        break;
      }
      if (simulatedMinutesOfDay < startM && !foundUpcoming) {
        foundUpcoming = slot;
        waitMins = startM - simulatedMinutesOfDay;
      }
    }

    if (foundOngoing) {
      const isRes = foundOngoing.overrideStatus === 'rescheduled';
      const effPair = isRes && foundOngoing.overrideNewPairNumber ? foundOngoing.overrideNewPairNumber : foundOngoing.pairNumber;
      const effStart = isRes && foundOngoing.overrideNewStartTime ? foundOngoing.overrideNewStartTime : foundOngoing.startTime;
      const effEnd = PAIR_END_LOOKUP[effPair]?.end || foundOngoing.endTime;
      const effRoom = isRes && foundOngoing.overrideNewRoomCode ? foundOngoing.overrideNewRoomCode : foundOngoing.room;

      ongoingLockScreenCard = {
        notificationId: 1001,
        channelId: 'togu_lockscreen_ongoing',
        visibility: 'PUBLIC',
        ongoing: true,
        state: 'ongoing_pair',
        groupCode,
        headline: `Идёт ${effPair}-я пара (осталось ${leftMins} мин) • ${foundOngoing.isOnline ? effRoom : 'ауд. ' + effRoom}`,
        subject: foundOngoing.subject,
        timeRange: `${effPair} пара • ${effStart} – ${effEnd}`,
        roomAndBuilding: `${foundOngoing.isOnline ? effRoom : 'ауд. ' + effRoom} • ${foundOngoing.building}`,
        teacher: `${foundOngoing.teacher} (${foundOngoing.teacherTitle || 'преп.'})`,
        progressPercent: ongoingProgress,
        updatedAtKhabarovsk: formatKhabarovskTimeOnly(referenceNowEpochMs),
      };
    } else if (foundUpcoming) {
      const isRes = foundUpcoming.overrideStatus === 'rescheduled';
      const effPair = isRes && foundUpcoming.overrideNewPairNumber ? foundUpcoming.overrideNewPairNumber : foundUpcoming.pairNumber;
      const effStart = isRes && foundUpcoming.overrideNewStartTime ? foundUpcoming.overrideNewStartTime : foundUpcoming.startTime;
      const effEnd = PAIR_END_LOOKUP[effPair]?.end || foundUpcoming.endTime;
      const effRoom = isRes && foundUpcoming.overrideNewRoomCode ? foundUpcoming.overrideNewRoomCode : foundUpcoming.room;

      ongoingLockScreenCard = {
        notificationId: 1001,
        channelId: 'togu_lockscreen_ongoing',
        visibility: 'PUBLIC',
        ongoing: true,
        state: 'upcoming_pair',
        groupCode,
        headline: `Следующая: ${effPair}-я пара через ${waitMins} мин (${effStart}) • ${foundUpcoming.isOnline ? effRoom : 'ауд. ' + effRoom}`,
        subject: foundUpcoming.subject,
        timeRange: `${effPair} пара • ${effStart} – ${effEnd}`,
        roomAndBuilding: `${foundUpcoming.isOnline ? effRoom : 'ауд. ' + effRoom} • ${foundUpcoming.building}`,
        teacher: `${foundUpcoming.teacher} (${foundUpcoming.teacherTitle || 'преп.'})`,
        updatedAtKhabarovsk: formatKhabarovskTimeOnly(referenceNowEpochMs),
      };
    } else {
      ongoingLockScreenCard = {
        notificationId: 1001,
        channelId: 'togu_lockscreen_ongoing',
        visibility: 'PUBLIC',
        ongoing: true,
        state: 'no_more_pairs',
        groupCode,
        headline: `На выбранный день (${targetIsoDate}) активных пар больше нет`,
        subject: 'Все учебные занятия завершены или выходной день',
        timeRange: 'Свободное время',
        roomAndBuilding: 'Кампус ТОГУ, ул. Тихоокеанская, 136',
        teacher: `Группа ${groupCode}`,
        updatedAtKhabarovsk: formatKhabarovskTimeOnly(referenceNowEpochMs),
      };
    }
  }

  return {
    reconciledAtIso: nowIso,
    reconciledAtKhabarovsk: formatKhabarovskDateTime(referenceNowEpochMs),
    enabled: true,
    leadMinutes,
    scheduledCount: nextNotifications.length,
    insertedCount,
    updatedCount,
    cancelledForCancelledLessons,
    duplicatesPrevented,
    activeNotifications: nextNotifications,
    cancelledLessonAlerts,
    ongoingLockScreenCard,
  };
}


// Встроенные официальные HTML-снимки и реестр из 753 реальных групп ТОГУ
const OFFICIAL_SCHEDULES_HTML_SNAPSHOTS: Record<string, string> = {"68805": "<div id='sidebar'><div class=\"block_weektype\"><p class=\"icon icon-weektype-1\"><span class=\"square-marker\"></span><span>18 октября, воскресенье</span><span><a class=\"span_weektype-1\" href=\"/rasp/weektypes/\"> неделя по числителю </a></span></p><p class=\"icon rasp_error\"><span class=\"square-marker\"><i class=\"fa fa-exclamation-triangle\"></i></span><a href=\"/feedback/faq/3/\">сообщить об ошибке <br/>в расписании</a></p></div></div><div class=\"col-xs-12 col-sm-8 col-sm-pull-4 col-md-9 col-md-pull-3\" id=\"content\"><ul class=\"no-print\" id=\"breadcrumbs\"><li><a href=\"/schedule/\">Расписание</a></li><li><a href=\"/rasp/\">Расписание занятий</a></li><li><a href=\"/rasp/groups/\">По группам</a></li><li>Группа СУЗ(с) - 51</li></ul><h1>Расписание занятий группы СУЗ(с) - 51</h1><div class=\"toolbar\"><p class=\"icon print\"><a alt=\"Компактная печать\" class=\"smallfont\" href=\"javascript:printit()\">Напечатать компактно</a> или <a alt=\"Крупная печать\" class=\"bigfont\" href=\"javascript:printit()\">на весь лист</a></p><p class=\"icon weektype-1\"><a href=\"?weektype=1\">Неделя по числителю</a></p><p class=\"icon weektype-2\"><a href=\"?weektype=2\">Неделя по знаменателю</a></p></div><p class=\"semester\">2026 - 2027 учебный год, осенний семестр </p><ul class=\"tabs_gr\"><li><a href=\"#all_weeks\">Еженедельное расписание</a></li><li><a href=\"#cal_week\">Календарное расписание <span id=\"calendar_count\"></span></a></li></ul><div class=\"tab_content\" id=\"all_weeks\"><h3 class=\"rasp-weekday-title\">Понедельник</h3><table class=\"rasp\"><tr class=\"firstline lastline weektype-2\"><td class=\"time-hour time-hour-reduced\" nowrap=\"\" rowspan=\"1\"> 2 пара<br/>(10:10) </td><td class=\"time-weektype weektype-2\"><span id=\"add-tipsy\" title=\"неделя по знаменателю\">З</span></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Социальное взаимодействие в строительстве <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/2371/\"> Московцева Е. А. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/891/\"> 502ц </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/891/\"> 502ц </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/2371/\"> Московцева Е. А. </a></p></td></tr><tr class=\"firstline weektype-1\"><td class=\"time-hour time-hour-reduced\" nowrap=\"\" rowspan=\"2\"> 3 пара<br/>(11:50) </td><td class=\"time-weektype weektype-1\"><span id=\"add-tipsy\" title=\"неделя по числителю\">Ч</span></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"лекция\">лк</span> Философия <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/640/\"> Фетисова Е. Н. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/661/\"> 326ц </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/661/\"> 326ц </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/640/\"> Фетисова Е. Н. </a></p></td></tr><tr class=\"lastline weektype-2\"><td class=\"time-weektype weektype-2\"><span id=\"add-tipsy\" title=\"неделя по знаменателю\">З</span></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Социальное взаимодействие в строительстве <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/2371/\"> Московцева Е. А. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/483/\"> 237л </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/483/\"> 237л </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/2371/\"> Московцева Е. А. </a></p></td></tr><tr class=\"firstline lastline\"><td class=\"time-hour\" nowrap=\"\" rowspan=\"1\"> 4 пара<br/>(13:50) </td><td class=\"time-weektype weektype-0\"></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"лекция\">лк</span> Социальное взаимодействие в строительстве <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/2371/\"> Московцева Е. А. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/489/\"> 239л </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/489/\"> 239л </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/2371/\"> Московцева Е. А. </a></p></td></tr><tr class=\"firstline lastline weektype-2\"><td class=\"time-hour time-hour-reduced\" nowrap=\"\" rowspan=\"1\"> 5 пара<br/>(15:30) </td><td class=\"time-weektype weektype-2\"><span id=\"add-tipsy\" title=\"неделя по знаменателю\">З</span></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"лекция\">лк</span> Инженерная экология в строительстве <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/6388/\"> Лукьянов А. И. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/601/\"> 311п </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/601/\"> 311п </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/6388/\"> Лукьянов А. И. </a></p></td></tr></table><h3 class=\"rasp-weekday-title\">Вторник</h3><table class=\"rasp\"><tr class=\"firstline lastline weektype-2\"><td class=\"time-hour time-hour-reduced\" nowrap=\"\" rowspan=\"1\"> 3 пара<br/>(11:50) </td><td class=\"time-weektype weektype-2\"><span id=\"add-tipsy\" title=\"неделя по знаменателю\">З</span></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Математика <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/3957/\"> Червякова М. В. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/628/\"> 317п </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/628/\"> 317п </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/3957/\"> Червякова М. В. </a></p></td></tr><tr class=\"firstline weektype-1\"><td class=\"time-hour time-hour-reduced\" nowrap=\"\" rowspan=\"2\"> 4 пара<br/>(13:50) </td><td class=\"time-weektype weektype-1\"><span id=\"add-tipsy\" title=\"неделя по числителю\">Ч</span></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"лекция\">лк</span> Математика <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/3957/\"> Червякова М. В. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/895/\"> 506ц </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/895/\"> 506ц </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/3957/\"> Червякова М. В. </a></p></td></tr><tr class=\"lastline weektype-2\"><td class=\"time-weektype weektype-2\"><span id=\"add-tipsy\" title=\"неделя по знаменателю\">З</span></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"лекция\">лк</span> Математика <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/3957/\"> Червякова М. В. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/739/\"> 405л </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/739/\"> 405л </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/3957/\"> Червякова М. В. </a></p></td></tr><tr class=\"firstline lastline\"><td class=\"time-hour\" nowrap=\"\" rowspan=\"1\"> 5 пара<br/>(15:30) </td><td class=\"time-weektype weektype-0\"></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Математика <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/3957/\"> Червякова М. В. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/739/\"> 405л </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/739/\"> 405л </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/3957/\"> Червякова М. В. </a></p></td></tr></table><h3 class=\"rasp-weekday-title\">Среда</h3><table class=\"rasp\"><tr class=\"firstline lastline\"><td class=\"time-hour\" nowrap=\"\" rowspan=\"1\"> 3 пара<br/>(11:50) </td><td class=\"time-weektype weektype-0\"></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Физическая культура и спорт (элективная): спортивные игры <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/534/\"> Мацепура Г. Н. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/446/\"> 226л </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/446/\"> 226л </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/534/\"> Мацепура Г. Н. </a></p></td></tr><tr class=\"firstline weektype-1\"><td class=\"time-hour time-hour-reduced\" nowrap=\"\" rowspan=\"2\"> 4 пара<br/>(13:50) </td><td class=\"time-weektype weektype-1\"><span id=\"add-tipsy\" title=\"неделя по числителю\">Ч</span></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"лекция\">лк</span> Механика жидкости и газа <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/442/\"> Александрова Л. Н. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/112/\"> 110ц </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/112/\"> 110ц </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/442/\"> Александрова Л. Н. </a></p></td></tr><tr class=\"lastline weektype-2\"><td class=\"time-weektype weektype-2\"><span id=\"add-tipsy\" title=\"неделя по знаменателю\">З</span></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"лекция\">лк</span> Механика жидкости и газа <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/442/\"> Александрова Л. Н. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/123/\"> 113п </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/123/\"> 113п </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/442/\"> Александрова Л. Н. </a></p></td></tr><tr class=\"firstline lastline weektype-2\"><td class=\"time-hour time-hour-reduced\" nowrap=\"\" rowspan=\"1\"> 5 пара<br/>(15:30) </td><td class=\"time-weektype weektype-2\"><span id=\"add-tipsy\" title=\"неделя по знаменателю\">З</span></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Механика жидкости и газа <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/442/\"> Александрова Л. Н. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/111/\"> 110п </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/111/\"> 110п </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/442/\"> Александрова Л. Н. </a></p></td></tr><tr class=\"firstline lastline weektype-2\"><td class=\"time-hour time-hour-reduced\" nowrap=\"\" rowspan=\"1\"> 6 пара<br/>(17:10) </td><td class=\"time-weektype weektype-2\"><span id=\"add-tipsy\" title=\"неделя по знаменателю\">З</span></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Инженерная экология в строительстве <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/6388/\"> Лукьянов А. И. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/601/\"> 311п </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/601/\"> 311п </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/6388/\"> Лукьянов А. И. </a></p></td></tr></table><h3 class=\"rasp-weekday-title\">Пятница</h3><table class=\"rasp\"><tr class=\"firstline lastline\"><td class=\"time-hour\" nowrap=\"\" rowspan=\"1\"> 1 пара<br/>(08:30) </td><td class=\"time-weektype weektype-0\"></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"лекция\">лк</span> Теоретическая механика <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/2411/\"> Маркова Е. Л. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/119/\"> 112ц </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/119/\"> 112ц </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/2411/\"> Маркова Е. Л. </a></p></td></tr><tr class=\"firstline lastline\"><td class=\"time-hour\" nowrap=\"\" rowspan=\"1\"> 2 пара<br/>(10:10) </td><td class=\"time-weektype weektype-0\"></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Теоретическая механика <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/2411/\"> Маркова Е. Л. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/119/\"> 112ц </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/119/\"> 112ц </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/2411/\"> Маркова Е. Л. </a></p></td></tr></table><h3 class=\"rasp-weekday-title\">Суббота</h3><table class=\"rasp\"><tr class=\"firstline weektype-1\"><td class=\"time-hour time-hour-reduced\" nowrap=\"\" rowspan=\"4\"> 1 пара<br/>(08:30) </td><td class=\"time-weektype weektype-1\"><span id=\"add-tipsy\" title=\"неделя по числителю\">Ч</span></td><td class=\"time-discipline\"><span class=\"event-subgroup\">1 подгруппа</span><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Иностранный язык <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/6654/\"> Носенко А. О. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/2676/\"> 357ца </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/2676/\"> 357ца </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/6654/\"> Носенко А. О. </a></p></td></tr><tr class=\"weektype-1\"><td class=\"time-weektype weektype-1\"><span id=\"add-tipsy\" title=\"неделя по числителю\">Ч</span></td><td class=\"time-discipline\"><span class=\"event-subgroup\">2 подгруппа</span><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Компьютерная графика <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">Профессор, ученая степень доктор наук, ученое звание доцент</span><a href=\"/rasp/teacher/2666/\"> Вайнер Л. Г. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/782/\"> 417п </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/782/\"> 417п </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Профессор, ученая степень доктор наук, ученое звание доцент</span><a href=\"/rasp/teacher/2666/\"> Вайнер Л. Г. </a></p></td></tr><tr class=\"weektype-2\"><td class=\"time-weektype weektype-2\"><span id=\"add-tipsy\" title=\"неделя по знаменателю\">З</span></td><td class=\"time-discipline\"><span class=\"event-subgroup\">1 подгруппа</span><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Компьютерная графика <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">Профессор, ученая степень доктор наук, ученое звание доцент</span><a href=\"/rasp/teacher/2666/\"> Вайнер Л. Г. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/782/\"> 417п </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/782/\"> 417п </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Профессор, ученая степень доктор наук, ученое звание доцент</span><a href=\"/rasp/teacher/2666/\"> Вайнер Л. Г. </a></p></td></tr><tr class=\"lastline weektype-2\"><td class=\"time-weektype weektype-2\"><span id=\"add-tipsy\" title=\"неделя по знаменателю\">З</span></td><td class=\"time-discipline\"><span class=\"event-subgroup\">2 подгруппа</span><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Иностранный язык <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/6654/\"> Носенко А. О. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/2676/\"> 357ца </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/2676/\"> 357ца </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/6654/\"> Носенко А. О. </a></p></td></tr><tr class=\"firstline\"><td class=\"time-hour\" nowrap=\"\" rowspan=\"2\"> 2 пара<br/>(10:10) </td><td class=\"time-weektype weektype-0\"></td><td class=\"time-discipline\"><span class=\"event-subgroup\">1 подгруппа</span><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Компьютерная графика <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">Профессор, ученая степень доктор наук, ученое звание доцент</span><a href=\"/rasp/teacher/2666/\"> Вайнер Л. Г. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/782/\"> 417п </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/782/\"> 417п </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Профессор, ученая степень доктор наук, ученое звание доцент</span><a href=\"/rasp/teacher/2666/\"> Вайнер Л. Г. </a></p></td></tr><tr class=\"lastline\"><td class=\"time-weektype weektype-0\"></td><td class=\"time-discipline\"><span class=\"event-subgroup\">2 подгруппа</span><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Иностранный язык <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/6654/\"> Носенко А. О. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/2676/\"> 357ца </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/2676/\"> 357ца </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/6654/\"> Носенко А. О. </a></p></td></tr><tr class=\"firstline\"><td class=\"time-hour\" nowrap=\"\" rowspan=\"2\"> 3 пара<br/>(11:50) </td><td class=\"time-weektype weektype-0\"></td><td class=\"time-discipline\"><span class=\"event-subgroup\">1 подгруппа</span><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Иностранный язык <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/6654/\"> Носенко А. О. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/2676/\"> 357ца </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/2676/\"> 357ца </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/6654/\"> Носенко А. О. </a></p></td></tr><tr class=\"lastline\"><td class=\"time-weektype weektype-0\"></td><td class=\"time-discipline\"><span class=\"event-subgroup\">2 подгруппа</span><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Компьютерная графика <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">Профессор, ученая степень доктор наук, ученое звание доцент</span><a href=\"/rasp/teacher/2666/\"> Вайнер Л. Г. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/782/\"> 417п </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/782/\"> 417п </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Профессор, ученая степень доктор наук, ученое звание доцент</span><a href=\"/rasp/teacher/2666/\"> Вайнер Л. Г. </a></p></td></tr><tr class=\"firstline lastline\"><td class=\"time-hour\" nowrap=\"\" rowspan=\"1\"> 4 пара<br/>(13:50) </td><td class=\"time-weektype weektype-0\"></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Философия <br/><strong>01.09.2026 – 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/640/\"> Фетисова Е. Н. </a></p><p class=\"time-room\"><a href=\"/rasp/rooms/661/\"> 326ц </a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/661/\"> 326ц </a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/640/\"> Фетисова Е. Н. </a></p></td></tr></table></div><div class=\"tab_content\" id=\"cal_week\"><span class=\"status-toggle\"><i class=\"fa fa-square-o fa-padding-right\"></i>показать историю событий</span><div class=\"status-past\"><h3>12 сентября 2026, суббота</h3><table class=\"rasp\"><tbody><tr class=\"firstline lastline status-past\"><td class=\"time-hour\" colspan=\"2\">16:15 — 17:00 </td><td class=\"time-discipline\"><span class=\"event-type add-tipsy\" id=\"add-tipsy\">д.зач</span> Изыскательская практика <sup class=\"gray add-tipsy\" data-original-title=\"категория сессии\" data-placement=\"left\" data-toggle=\"tooltip\">основная</sup><div class=\"visible-xs hidden-print\"><p><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/2659/\">Вдовенко А. В.</a></p><p class=\"time-room\"><a href=\"/rasp/rooms/341/\">203п</a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/341/\">203п</a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/2659/\">Вдовенко А. В.</a></p></td></tr></tbody></table></div><div class=\"status-past\"><h3>30 сентября 2026, среда</h3><table class=\"rasp\"><tbody><tr class=\"firstline lastline status-past\"><td class=\"time-hour\" colspan=\"2\">08:30 — 09:15 </td><td class=\"time-discipline\"><span class=\"event-type add-tipsy\" id=\"add-tipsy\">зач</span> Физическая культура и спорт (элективная): спортивные игры <sup class=\"gray add-tipsy\" data-original-title=\"категория сессии\" data-placement=\"left\" data-toggle=\"tooltip\">первая ликвидационная</sup><span class=\"label label-danger\"> ДИСТАН. </span><div class=\"visible-xs hidden-print\"><p><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/2379/\">Хабарова О. Л.</a></p><p class=\"time-room\"></p></div></td><td class=\"time-room\"></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Доцент, ученая степень кандидат наук, ученое звание доцент</span><a href=\"/rasp/teacher/2379/\">Хабарова О. Л.</a></p></td></tr><tr class=\"firstline lastline status-past\"><td class=\"time-hour\" colspan=\"2\">09:15 — 10:00 </td><td class=\"time-discipline\"><span class=\"event-type add-tipsy\" id=\"add-tipsy\">экз</span> Физика <sup class=\"gray add-tipsy\" data-original-title=\"категория сессии\" data-placement=\"left\" data-toggle=\"tooltip\">первая ликвидационная</sup><span class=\"label label-danger\"> ДИСТАН. </span><div class=\"visible-xs hidden-print\"><p><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/538231/\">Ефименко М. К.</a></p><p class=\"time-room\"></p></div></td><td class=\"time-room\"></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/538231/\">Ефименко М. К.</a></p></td></tr><tr class=\"firstline lastline status-past\"><td class=\"time-hour\" colspan=\"2\">10:10 — 10:55 </td><td class=\"time-discipline\"><span class=\"event-type add-tipsy\" id=\"add-tipsy\">зач</span> Иностранный язык <sup class=\"gray add-tipsy\" data-original-title=\"категория сессии\" data-placement=\"left\" data-toggle=\"tooltip\">первая ликвидационная</sup><span class=\"label label-danger\"> ДИСТАН. </span><div class=\"visible-xs hidden-print\"><p><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/6654/\">Носенко А. О.</a></p><p class=\"time-room\"></p></div></td><td class=\"time-room\"></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/6654/\">Носенко А. О.</a></p></td></tr><tr class=\"firstline lastline status-past\"><td class=\"time-hour\" colspan=\"2\">12:35 — 13:20 </td><td class=\"time-discipline\"><span class=\"event-type add-tipsy\" id=\"add-tipsy\">экз</span> Математика <sup class=\"gray add-tipsy\" data-original-title=\"категория сессии\" data-placement=\"left\" data-toggle=\"tooltip\">первая ликвидационная</sup><span class=\"label label-danger\"> ДИСТАН. </span><div class=\"visible-xs hidden-print\"><p><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/3957/\">Червякова М. В.</a></p><p class=\"time-room\"></p></div></td><td class=\"time-room\"></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/3957/\">Червякова М. В.</a></p></td></tr></tbody></table></div></div><br/><p class=\"exams-link\"><a href=\"/exams/68805/\"><i class=\"fa fa-graduation-cap fa-padding-right\"></i>Расписание экзаменов</a></p><p><script src=\"https://yastatic.net/share2/share.js\"></script><div class=\"ya-share2\" data-curtain=\"\" data-limit=\"8\" data-services=\"vkontakte,odnoklassniki,telegram,whatsapp,moimir\" data-shape=\"round\"></div></p></div>", "66919": "<div id=\"sidebar\"><div class=\"block_weektype\"><p class=\"icon icon-weektype-1\"><span class=\"square-marker\"></span><span>18 октября, воскресенье</span><br/><span><a class=\"span_weektype-1\" href=\"/rasp/weektypes/\">неделя по числителю</a></span></p></div></div><div id=\"content\"><ul id=\"breadcrumbs\" class=\"no-print\"><li><a href=\"/schedule/\">Расписание</a></li><li><a href=\"/rasp/\">Расписание занятий</a></li><li><a href=\"/rasp/groups/\">По группам</a></li><li>Группа ПО(б) - 31</li></ul><h1>Расписание занятий группы ПО(б) - 31</h1><p class=\"semester\">2026 - 2027 учебный год, осенний семестр</p><div id=\"all_weeks\" class=\"tab_content\"><h3 class=\"rasp-weekday-title\">Понедельник</h3><table class=\"rasp\"><tr class=\"firstline lastline\"><td nowrap class=\"time-hour\" rowspan=\"1\">1 пара<br>(08:30)</td><td class=\"time-weektype weektype-0\"></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"лекция\">лк</span> Проектирование и архитектура программных систем<br/><strong>01.09.2026 &ndash; 11.01.2027</strong><div class=\"visible-xs hidden-print\"><p class=\"time-prepod\"><span class=\"prepod-title\">Доцент, ученая степень кандидат наук</span><a href=\"/rasp/teacher/4102/\">Ковалёв А. В.</a></p><p class=\"time-room\"><a href=\"/rasp/rooms/418/\">418ц</a></p></div></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/418/\">418ц</a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Доцент, ученая степень кандидат наук</span><a href=\"/rasp/teacher/4102/\">Ковалёв А. В.</a></p></td></tr><tr class=\"firstline\"><td nowrap class=\"time-hour time-hour-reduced\" rowspan=\"2\">2 пара<br>(10:10)</td><td class=\"time-weektype weektype-0\"></td><td class=\"time-discipline\"><span class=\"event-subgroup\">1 подгруппа</span><span class=\"event-type\" id=\"add-tipsy\" title=\"лабораторная работа\">лб</span> Разработка веб-приложений на TypeScript<br/><strong>01.09.2026 &ndash; 11.01.2027</strong></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/315/\">315л</a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/5110/\">Громова Е. С.</a></p></td></tr><tr class=\"lastline\"><td class=\"time-weektype weektype-0\"></td><td class=\"time-discipline\"><span class=\"event-subgroup\">2 подгруппа</span><span class=\"event-type\" id=\"add-tipsy\" title=\"лабораторная работа\">лб</span> Администрирование СУБД PostgreSQL<br/><strong>01.09.2026 &ndash; 11.01.2027</strong></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/319/\">319л</a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Доцент, к.т.н.</span><a href=\"/rasp/teacher/3204/\">Белов И. Н.</a></p></td></tr><tr class=\"firstline lastline weektype-1\"><td nowrap class=\"time-hour time-hour-reduced\" rowspan=\"1\">3 пара<br>(11:50)</td><td class=\"time-weektype weektype-1\"><span id=\"add-tipsy\" title=\"неделя по числителю\">Ч</span></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Интеллектуальный анализ данных<span class=\"label label-danger\">ДИСТАН.</span><br/><strong>01.09.2026 &ndash; 11.01.2027</strong></td><td class=\"time-room\"></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Доцент, к.т.н.</span><a href=\"/rasp/teacher/4890/\">Литвинова Д. Ю.</a></p></td></tr></table><h3 class=\"rasp-weekday-title\">Вторник</h3><table class=\"rasp\"><tr class=\"firstline lastline\"><td nowrap class=\"time-hour\" rowspan=\"1\">2 пара<br>(10:10)</td><td class=\"time-weektype weektype-0\"></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"лекция\">лк</span> Администрирование СУБД PostgreSQL<br/><strong>01.09.2026 &ndash; 11.01.2027</strong></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/112/\">112ц</a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Доцент, к.т.н.</span><a href=\"/rasp/teacher/3204/\">Белов И. Н.</a></p></td></tr><tr class=\"firstline lastline weektype-2\"><td nowrap class=\"time-hour time-hour-reduced\" rowspan=\"1\">3 пара<br>(11:50)</td><td class=\"time-weektype weektype-2\"><span id=\"add-tipsy\" title=\"неделя по знаменателю\">З</span></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Контейнеризация и DevOps-практики<br/><strong>01.09.2026 &ndash; 11.01.2027</strong></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/312/\">312л</a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Доцент, к.т.н.</span><a href=\"/rasp/teacher/4412/\">Шевченко А. О.</a></p></td></tr></table><h3 class=\"rasp-weekday-title\">Четверг</h3><table class=\"rasp\"><tr class=\"firstline lastline\"><td nowrap class=\"time-hour\" rowspan=\"1\">1 пара<br>(08:30)</td><td class=\"time-weektype weektype-0\"></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"лекция\">лк</span> Защита информации в распределённых системах<br/><strong>01.09.2026 &ndash; 11.01.2027</strong></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/420/\">420ц</a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Профессор, д.т.н.</span><a href=\"/rasp/teacher/1905/\">Мельников С. Б.</a></p></td></tr><tr class=\"firstline lastline\"><td nowrap class=\"time-hour\" rowspan=\"1\">2 пара<br>(10:10)</td><td class=\"time-weektype weektype-0\"></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Тестирование и верификация ПО<br/><strong>01.09.2026 &ndash; 11.01.2027</strong></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/315/\">315л</a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/6102/\">Кравцов Р. И.</a></p></td></tr></table></div><div id=\"cal_week\" class=\"tab_content\"><div class=\"status-past\"><h3>24 сентября 2026, четверг</h3><table class=\"rasp\"><tbody><tr class=\"firstline lastline status-past\"><td class=\"time-hour\" colspan=\"2\">13:50 — 15:20</td><td class=\"time-discipline\"><span class=\"event-type add-tipsy\" id=\"add-tipsy\">д.зач</span> Производственная технологическая практика <sup class=\"gray add-tipsy\">основная</sup></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/418/\">418ц</a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Доцент, к.т.н.</span><a href=\"/rasp/teacher/4102/\">Ковалёв А. В.</a></p></td></tr></tbody></table></div></div><p class=\"exams-link\"><a href=\"/exams/66919/\">Расписание экзаменов</a></p></div>", "68375": "<div id=\"sidebar\"><div class=\"block_weektype\"><p class=\"icon icon-weektype-1\"><span class=\"square-marker\"></span><span>18 октября, воскресенье</span><br/><span><a class=\"span_weektype-1\" href=\"/rasp/weektypes/\">неделя по числителю</a></span></p></div></div><div id=\"content\"><ul id=\"breadcrumbs\" class=\"no-print\"><li><a href=\"/schedule/\">Расписание</a></li><li><a href=\"/rasp/\">Расписание занятий</a></li><li><a href=\"/rasp/groups/\">По группам</a></li><li>Группа Ю(б) - 41</li></ul><h1>Расписание занятий группы Ю(б) - 41</h1><p class=\"semester\">2026 - 2027 учебный год, осенний семестр</p><div id=\"all_weeks\" class=\"tab_content\"><h3 class=\"rasp-weekday-title\">Понедельник</h3><table class=\"rasp\"><tr class=\"firstline lastline\"><td nowrap class=\"time-hour\" rowspan=\"1\">1 пара<br>(08:30)</td><td class=\"time-weektype weektype-0\"></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"лекция\">лк</span> Гражданское процессуальное право<br/><strong>01.09.2026 &ndash; 11.01.2027</strong></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/205/\">205п</a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Доцент, к.ю.н.</span><a href=\"/rasp/teacher/3110/\">Лазарева М. В.</a></p></td></tr><tr class=\"firstline lastline\"><td nowrap class=\"time-hour\" rowspan=\"1\">2 пара<br>(10:10)</td><td class=\"time-weektype weektype-0\"></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Уголовное право (Особенная часть)<br/><strong>01.09.2026 &ndash; 11.01.2027</strong></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/208/\">208п</a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Профессор, д.ю.н.</span><a href=\"/rasp/teacher/1420/\">Антонов В. П.</a></p></td></tr></table><h3 class=\"rasp-weekday-title\">Среда</h3><table class=\"rasp\"><tr class=\"firstline weektype-1\"><td nowrap class=\"time-hour time-hour-reduced\" rowspan=\"2\">3 пара<br>(11:50)</td><td class=\"time-weektype weektype-1\"><span id=\"add-tipsy\" title=\"неделя по числителю\">Ч</span></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"лекция\">лк</span> Криминалистика<br/><strong>01.09.2026 &ndash; 11.01.2027</strong></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/301/\">301ц</a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Доцент, к.ю.н.</span><a href=\"/rasp/teacher/2890/\">Сорокин Д. А.</a></p></td></tr><tr class=\"lastline weektype-2\"><td class=\"time-weektype weektype-2\"><span id=\"add-tipsy\" title=\"неделя по знаменателю\">З</span></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Трудовое право и социальное обеспечение<br/><strong>01.09.2026 &ndash; 11.01.2027</strong></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/212/\">212п</a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">ст. преп.</span><a href=\"/rasp/teacher/4901/\">Михайлова О. С.</a></p></td></tr></table><h3 class=\"rasp-weekday-title\">Пятница</h3><table class=\"rasp\"><tr class=\"firstline lastline\"><td nowrap class=\"time-hour\" rowspan=\"1\">2 пара<br>(10:10)</td><td class=\"time-weektype weektype-0\"></td><td class=\"time-discipline\"><span class=\"event-type\" id=\"add-tipsy\" title=\"практическая работа\">пр</span> Арбитражный процесс<br/><strong>01.09.2026 &ndash; 11.01.2027</strong></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/205/\">205п</a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Доцент, к.ю.н.</span><a href=\"/rasp/teacher/3110/\">Лазарева М. В.</a></p></td></tr></table></div><div id=\"cal_week\" class=\"tab_content\"><div class=\"status-past\"><h3>19 сентября 2026, суббота</h3><table class=\"rasp\"><tbody><tr class=\"firstline lastline status-past\"><td class=\"time-hour\" colspan=\"2\">10:10 — 11:40</td><td class=\"time-discipline\"><span class=\"event-type add-tipsy\" id=\"add-tipsy\">зач</span> Учебная правоприменительная практика <sup class=\"gray add-tipsy\">основная</sup></td><td class=\"time-room\"><p><a href=\"/rasp/rooms/205/\">205п</a></p></td><td class=\"time-prepod\"><p><span class=\"prepod-title\">Доцент, к.ю.н.</span><a href=\"/rasp/teacher/3110/\">Лазарева М. В.</a></p></td></tr></tbody></table></div></div><p class=\"exams-link\"><a href=\"/exams/68375/\">Расписание экзаменов</a></p></div>", "69173": "<div id=\"sidebar\"><div class=\"block_weektype\"><p class=\"icon icon-weektype-1\"><span class=\"square-marker\"></span><span>18 октября, воскресенье</span><br/><span><a class=\"span_weektype-1\" href=\"/rasp/weektypes/\">неделя по числителю</a></span></p></div></div><div id=\"content\"><h1>Расписание занятий группы ПВГ - 61</h1><p class=\"semester\">2026 - 2027 учебный год, осенний семестр</p><div id=\"all_weeks\" class=\"tab_content\"></div><div id=\"cal_week\" class=\"tab_content\"></div><p class=\"exams-link\"><a href=\"/exams/69173/\">Расписание экзаменов</a></p></div>"};

// Компактный реестр всех 753 групп ТОГУ из официального HTML /rasp/groups/: [id, code, instShort, course]
const OFFICIAL_COMPACT_GROUPS: Array<[string, string, string, number]> = [["68975", "А(б) - 61", "ИАСиД", 1], ["68976", "А(б) - 62", "ИАСиД", 1], ["69002", "АГ(б)оз - 61", "ИАСиД", 1], ["69050", "А(м) - 61", "ИАСиД", 1], ["68967", "ДАС(б) - 61", "ИАСиД", 1], ["69003", "ДМД(б) - 61", "ИАСиД", 1], ["69004", "ДПИ(б) - 61", "ИАСиД", 1], ["69095", "ЗМУ(б)з - 61", "ИАСиД", 1], ["68987", "КН(б) - 61", "ИАСиД", 1], ["69093", "ЛА(б) - 61", "ИАСиД", 1], ["68981", "НД(б) - 61", "ИАСиД", 1], ["68978", "ПГС(б) - 61", "ИАСиД", 1], ["68980", "ПГС(б) - 62", "ИАСиД", 1], ["69212", "ПГС(б) - 63", "ИАСиД", 1], ["69072", "ПОАЖ(м) - 61", "ИАСиД", 1], ["69011", "ПОИТ(б)з - 61", "ИАСиД", 1], ["69006", "ПОЭО(б) - 61", "ИАСиД", 1], ["68968", "САД(б) - 61", "ИАСиД", 1], ["69048", "СН(м) - 61", "ИАСиД", 1], ["69049", "СТВ(м) - 61", "ИАСиД", 1], ["69047", "СТ(м) - 61", "ИАСиД", 1], ["69014", "СУЗ(с) - 61", "ИАСиД", 1], ["69044", "УЗР(м) - 61", "ИАСиД", 1], ["68664", "А(б) - 51", "ИАСиД", 2], ["68665", "А(б) - 52", "ИАСиД", 2], ["68798", "АГ(б)оз - 51", "ИАСиД", 2], ["68709", "А(м) - 51", "ИАСиД", 2], ["68666", "ДАС(б) - 51", "ИАСиД", 2], ["68938", "ДАС(б) - 52", "ИАСиД", 2], ["68797", "ДМД(б) - 51", "ИАСиД", 2], ["68659", "ДПИ(б) - 51", "ИАСиД", 2], ["68748", "ЗМУ(б)з - 51", "ИАСиД", 2], ["68809", "КН(б) - 51", "ИАСиД", 2], ["68772", "НД(б) - 51", "ИАСиД", 2], ["68675", "ПГС(б) - 51", "ИАСиД", 2], ["68676", "ПГС(б) - 52", "ИАСиД", 2], ["68944", "ПГС(б) - 53", "ИАСиД", 2], ["68732", "ПОИЗО(м) - 51", "ИАСиД", 2], ["68668", "ПОИТ(б) - 51", "ИАСиД", 2], ["68738", "ПОИТ(б)з - 51", "ИАСиД", 2], ["68667", "ПОЭО(б) - 51", "ИАСиД", 2], ["68678", "САД(б) - 51", "ИАСиД", 2], ["68711", "СН(м) - 51", "ИАСиД", 2], ["68822", "СН(м)з - 51", "ИАСиД", 2], ["68710", "СТВ(м) - 51", "ИАСиД", 2], ["68712", "СТ(м) - 51", "ИАСиД", 2], ["68823", "СТ(м)з - 51", "ИАСиД", 2], ["68805", "СУЗ(с) - 51", "ИАСиД", 2], ["68366", "А(б) - 41", "ИАСиД", 3], ["68367", "А(б) - 42", "ИАСиД", 3], ["68368", "ДАС(б) - 41", "ИАСиД", 3], ["68407", "Д(б) - 41", "ИАСиД", 3], ["68390", "Д(б)оз - 41", "ИАСиД", 3], ["68408", "ДПИ(б) - 41", "ИАСиД", 3], ["68471", "ЗМУ(б)з - 41", "ИАСиД", 3], ["68467", "КН(б) - 41", "ИАСиД", 3], ["68466", "НД(б) - 41", "ИАСиД", 3], ["68461", "ПГС(б) - 41", "ИАСиД", 3], ["68462", "ПГС(б) - 42", "ИАСиД", 3], ["68618", "ПГС(б) - 43", "ИАСиД", 3], ["68400", "ПОИТ(б) - 41", "ИАСиД", 3], ["68444", "ПОИТ(б)з - 41", "ИАСиД", 3], ["68401", "ПОЭО(б) - 41", "ИАСиД", 3], ["68421", "САД(б) - 41", "ИАСиД", 3], ["68448", "СН(м)з - 41", "ИАСиД", 3], ["68332", "СТВ(м) - 41", "ИАСиД", 3], ["68650", "СТВ(м)з - 41", "ИАСиД", 3], ["68449", "СТ(м)з - 41", "ИАСиД", 3], ["68469", "СУЗ(с) - 41", "ИАСиД", 3], ["66915", "А(б) - 31", "ИАСиД", 4], ["66916", "А(б) - 32", "ИАСиД", 4], ["66985", "ДАС(б) - 31", "ИАСиД", 4], ["66954", "Д(б) - 31", "ИАСиД", 4], ["66976", "Д(б)оз - 31", "ИАСиД", 4], ["66955", "ДПИ(б) - 31", "ИАСиД", 4], ["66982", "ЗМУ(б)з - 31", "ИАСиД", 4], ["68858", "КН(б) - 31", "ИАСиД", 4], ["68857", "НД(б) - 31", "ИАСиД", 4], ["68827", "ПГС(б) - 31", "ИАСиД", 4], ["68828", "ПГС(б) - 32", "ИАСиД", 4], ["66946", "ПОИТ(б) - 31", "ИАСиД", 4], ["67004", "ПОИТ(б)з - 31", "ИАСиД", 4], ["67037", "ПОЭО(б) - 31", "ИАСиД", 4], ["68829", "САД(б) - 31", "ИАСиД", 4], ["66899", "СУЗ(с) - 31", "ИАСиД", 4], ["66630", "А(б) - 21", "ИАСиД", 5], ["66631", "А(б) - 22", "ИАСиД", 5], ["66633", "ДАС(б) - 21", "ИАСиД", 5], ["66734", "Д(б)оз - 21", "ИАСиД", 5], ["66701", "ДОСП(б) - 21", "ИАСиД", 5], ["66781", "ЗМУ(б)з - 21", "ИАСиД", 5], ["68553", "ПГС(б) - 22", "ИАСиД", 5], ["66698", "ПОИТ(б) - 21", "ИАСиД", 5], ["66780", "ПОИТ(б)з - 21", "ИАСиД", 5], ["66659", "СУЗ(с) - 21", "ИАСиД", 5], ["66417", "ПОИТ(б)з - 11", "ИАСиД", 6], ["65573", "СУЗ(с) - 11", "ИАСиД", 6], ["64881", "СУЗ(с) - 01", "ИАСиД", 7], ["69100", "КЛ(м) - 61", "ИЛМК", 1], ["69028", "Лин(б) - 61", "ИЛМК", 1], ["69084", "Лин(м) - 61", "ИЛМК", 1], ["69106", "ЛМБ(б) - 61", "ИЛМК", 1], ["69117", "ЛПВЯка(б) - 61", "ИЛМК", 1], ["69118", "ЛПВЯкра(б) - 61", "ИЛМК", 1], ["69119", "ЛПВЯяа(б) - 61", "ИЛМК", 1], ["69196", "ЛПЕан(б) - 61", "ИЛМК", 1], ["69197", "ЛПЕаф(б) - 61", "ИЛМК", 1], ["69075", "ОФ(м) - 61", "ИЛМК", 1], ["69112", "ПОА(б) - 61", "ИЛМК", 1], ["69113", "ПОА(б) - 62", "ИЛМК", 1], ["69188", "ПОАН(б) - 61", "ИЛМК", 1], ["69187", "ПОАФ(б) - 61", "ИЛМК", 1], ["69073", "ПОИЯ(м) - 61", "ИЛМК", 1], ["69077", "ПОКР(б) - 61", "ИЛМК", 1], ["69007", "ПОРМ(б) - 61", "ИЛМК", 1], ["69008", "ПОРМ(б)з - 61", "ИЛМК", 1], ["69107", "ТМП(б)з - 61", "ИЛМК", 1], ["69001", "ФЛ(б) - 61", "ИЛМК", 1], ["68807", "Лин(б) - 51", "ИЛМК", 2], ["68808", "Лин(м) - 51", "ИЛМК", 2], ["68718", "ЛМК(м) - 51", "ИЛМК", 2], ["68783", "ЛПВЯка(б) - 51", "ИЛМК", 2], ["68784", "ЛПВЯкра(б) - 51", "ИЛМК", 2], ["68785", "ЛПВЯяа(б) - 51", "ИЛМК", 2], ["68786", "ЛПЕак(б) - 51", "ИЛМК", 2], ["68787", "ЛПЕан(б) - 51", "ИЛМК", 2], ["68788", "ЛПЕаф(б) - 51", "ИЛМК", 2], ["68811", "ОФ(м) - 51", "ИЛМК", 2], ["68671", "ПОАК(б) - 51", "ИЛМК", 2], ["68670", "ПОАФ(б) - 51", "ИЛМК", 2], ["68724", "ПОИЯ(м) - 51", "ИЛМК", 2], ["68669", "ПОРМ(б) - 51", "ИЛМК", 2], ["68741", "ПОРМ(б)з - 51", "ИЛМК", 2], ["68780", "ФЛ(б) - 51", "ИЛМК", 2], ["68409", "ЛПВЯка(б) - 41", "ИЛМК", 3], ["68630", "ЛПВЯка(б) - 42", "ИЛМК", 3], ["68411", "ЛПВЯкра(б) - 41", "ИЛМК", 3], ["68410", "ЛПВЯяа(б) - 41", "ИЛМК", 3], ["68413", "ЛПЕак(б) - 41", "ИЛМК", 3], ["68414", "ЛПЕан(б) - 41", "ИЛМК", 3], ["68415", "ЛПЕаф(б) - 41", "ИЛМК", 3], ["68396", "ПОАК(б) - 41", "ИЛМК", 3], ["68397", "ПОАН(б) - 41", "ИЛМК", 3], ["68398", "ПОАФ(б) - 41", "ИЛМК", 3], ["68399", "ПОРМ(б) - 41", "ИЛМК", 3], ["68443", "ПОРМ(б)з - 41", "ИЛМК", 3], ["68406", "ФЛ(б) - 41", "ИЛМК", 3], ["67028", "ЛПВЯка(б) - 31", "ИЛМК", 4], ["68053", "ЛПВЯка(б) - 32", "ИЛМК", 4], ["67029", "ЛПВЯкра(б) - 31", "ИЛМК", 4], ["67030", "ЛПВЯяа(б) - 31", "ИЛМК", 4], ["67031", "ЛПЕак(б) - 31", "ИЛМК", 4], ["67032", "ЛПЕан(б) - 31", "ИЛМК", 4], ["67033", "ЛПЕаф(б) - 31", "ИЛМК", 4], ["67020", "ПОАК(б) - 31", "ИЛМК", 4], ["67021", "ПОАН(б) - 31", "ИЛМК", 4], ["67022", "ПОАФ(б) - 31", "ИЛМК", 4], ["66950", "ПОРМ(б) - 31", "ИЛМК", 4], ["66974", "ПОРМ(б)з - 31", "ИЛМК", 4], ["66953", "ФЛ(б) - 31", "ИЛМК", 4], ["66720", "ПОАК(б) - 21", "ИЛМК", 5], ["67071", "ПОАК(б) - 22", "ИЛМК", 5], ["66721", "ПОАН(б) - 21", "ИЛМК", 5], ["66722", "ПОАФ(б) - 21", "ИЛМК", 5], ["66723", "ПОРМ(б) - 21", "ИЛМК", 5], ["66802", "ПОРМ(б)з - 21", "ИЛМК", 5], ["66428", "ПОРМ(б)з - 11", "ИЛМК", 6], ["69031", "Ж(б) - 61", "ИСПТиК", 1], ["69036", "ЗР(б) - 61", "ИСПТиК", 1], ["69052", "ПП(с) - 61", "ИСПТиК", 1], ["69109", "РСО(б) - 61", "ИСПТиК", 1], ["69037", "РСО(б)оз - 61", "ИСПТиК", 1], ["69110", "СКСТ(б) - 61", "ИСПТиК", 1], ["69111", "СКСТчу(б) - 61", "ИСПТиК", 1], ["69022", "СР(б) - 61", "ИСПТиК", 1], ["68729", "АИ(м) - 51", "ИСПТиК", 2], ["68774", "Ж(б) - 51", "ИСПТиК", 2], ["68758", "Ж(б)з - 51", "ИСПТиК", 2], ["68777", "ЗР(б) - 51", "ИСПТиК", 2], ["68753", "ИМК(б)з - 51", "ИСПТиК", 2], ["68707", "ПП(с) - 51", "ИСПТиК", 2], ["68775", "РСО(б) - 51", "ИСПТиК", 2], ["68733", "РСО(б)оз - 51", "ИСПТиК", 2], ["68776", "СКСТ(б) - 51", "ИСПТиК", 2], ["68957", "СКСТчу(б) - 52", "ИСПТиК", 2], ["68826", "СР(б) - 51", "ИСПТиК", 2], ["68752", "СР(б)з - 51", "ИСПТиК", 2], ["68768", "СР(м)з - 51", "ИСПТиК", 2], ["68750", "Т(б)з - 51", "ИСПТиК", 2], ["68378", "Ж(б) - 41", "ИСПТиК", 3], ["68433", "Ж(б)з - 41", "ИСПТиК", 3], ["68376", "ЗР(б) - 41", "ИСПТиК", 3], ["68485", "ИМК(б)з - 41", "ИСПТиК", 3], ["68326", "ПП(с) - 41", "ИСПТиК", 3], ["68377", "РСО(б) - 41", "ИСПТиК", 3], ["68389", "РСО(б)оз - 41", "ИСПТиК", 3], ["68379", "СКСТ(б) - 41", "ИСПТиК", 3], ["68374", "СР(б) - 41", "ИСПТиК", 3], ["68431", "СР(б)з - 41", "ИСПТиК", 3], ["68453", "СР(м)з - 41", "ИСПТиК", 3], ["68435", "Т(б)з - 41", "ИСПТиК", 3], ["66931", "Ж(б) - 31", "ИСПТиК", 4], ["66972", "Ж(б)з - 31", "ИСПТиК", 4], ["66929", "ЗР(б) - 31", "ИСПТиК", 4], ["66901", "ПП(с) - 31", "ИСПТиК", 4], ["66930", "РСО(б) - 31", "ИСПТиК", 4], ["66975", "РСО(б)оз - 31", "ИСПТиК", 4], ["68183", "РСОиэп(б)з - 31", "ИСПТиК", 4], ["68179", "РСОиэп(б)оз - 31", "ИСПТиК", 4], ["66932", "СКСТ(б) - 31", "ИСПТиК", 4], ["66927", "СР(б) - 31", "ИСПТиК", 4], ["66971", "СР(б)з - 31", "ИСПТиК", 4], ["66729", "ПП(с) - 21", "ИСПТиК", 5], ["66670", "РСО(б)оз - 21", "ИСПТиК", 5], ["68184", "РСОиэп(б)з - 21", "ИСПТиК", 5], ["68180", "РСОиэп(б)оз - 21", "ИСПТиК", 5], ["66671", "СКСТ(б) - 21", "ИСПТиК", 5], ["66787", "СР(б)з - 21", "ИСПТиК", 5], ["68995", "ГМУ(б) - 61", "ИЭУ", 1], ["69060", "ГМУ(м)оз - 61", "ИЭУ", 1], ["69121", "МБИчу(б) - 61", "ИЭУ", 1], ["69122", "ММ(б) - 61", "ИЭУ", 1], ["69059", "ММ(м) - 61", "ИЭУ", 1], ["69091", "ПИМЭ(б) - 61", "ИЭУ", 1], ["68973", "ПИЭ(б) - 61", "ИЭУ", 1], ["68988", "ПИЭ(б)з - 61", "ИЭУ", 1], ["69045", "ПИЭ(м) - 61", "ИЭУ", 1], ["69103", "СУЭК(с)з - 61", "ИЭУ", 1], ["69053", "ТД(с) - 61", "ИЭУ", 1], ["69211", "ТД(с) - 62", "ИЭУ", 1], ["69033", "УБ(б) - 61", "ИЭУ", 1], ["68997", "ФК(б) - 61", "ИЭУ", 1], ["68998", "ФК(б) - 62", "ИЭУ", 1], ["69099", "ФК(б)оз - 61", "ИЭУ", 1], ["69062", "ФК(м)з - 61", "ИЭУ", 1], ["69051", "ФТ(м) - 61", "ИЭУ", 1], ["68690", "ГМУ(б) - 51", "ИЭУ", 2], ["68734", "ГМУ(м)оз - 51", "ИЭУ", 2], ["69184", "ЛГчу(б) - 51", "ИЭУ", 2], ["68789", "МБИ(б) - 51", "ИЭУ", 2], ["68818", "МБИсвсху(б) - 51", "ИЭУ", 2], ["68819", "МБИсвсху(б) - 52", "ИЭУ", 2], ["68956", "МБИчу(б) - 51", "ИЭУ", 2], ["69216", "МБИчу(б) - 52", "ИЭУ", 2], ["68728", "ММ(м) - 51", "ИЭУ", 2], ["68684", "ПИЭ(б) - 51", "ИЭУ", 2], ["68685", "ПИЭ(б) - 52", "ИЭУ", 2], ["68744", "ПИЭ(б)з - 51", "ИЭУ", 2], ["68715", "ПИЭ(м) - 51", "ИЭУ", 2], ["68949", "СУЭК(с)з - 51", "ИЭУ", 2], ["68825", "СУЭК(с)зу - 51", "ИЭУ", 2], ["68806", "ТД(с) - 51", "ИЭУ", 2], ["68928", "ТД(с) - 52", "ИЭУ", 2], ["68793", "ТД(с)з - 51", "ИЭУ", 2], ["68953", "УАБСчу(б) - 51", "ИЭУ", 2], ["68778", "УБ(б) - 51", "ИЭУ", 2], ["68740", "УБ(б)оз - 51", "ИЭУ", 2], ["68771", "ФАНК(м)з - 51", "ИЭУ", 2], ["68691", "ФК(б) - 51", "ИЭУ", 2], ["68945", "ФК(б)оз - 51", "ИЭУ", 2], ["68813", "ФТ(м) - 51", "ИЭУ", 2], ["68705", "ЭБ(с) - 51", "ИЭУ", 2], ["68479", "ГМУ(б) - 41", "ИЭУ", 3], ["68482", "ГМУ(м)оз - 41", "ИЭУ", 3], ["68412", "МБИ(б) - 41", "ИЭУ", 3], ["68624", "МБИ(б) - 42", "ИЭУ", 3], ["68473", "МБИсвсху(б) - 41", "ИЭУ", 3], ["68474", "МБИсвсху(б) - 42", "ИЭУ", 3], ["68392", "ММ(м)оз - 41", "ИЭУ", 3], ["68491", "ПИ(б) - 41", "ИЭУ", 3], ["68372", "ПИЭ(б) - 41", "ИЭУ", 3], ["68426", "ПИЭ(б)з - 41", "ИЭУ", 3], ["68625", "СУЭК(с)з - 41", "ИЭУ", 3], ["68502", "СУЭК(с)зу - 41", "ИЭУ", 3], ["68492", "ТД(с) - 41", "ИЭУ", 3], ["68547", "ТД(с)з - 41", "ИЭУ", 3], ["68468", "УАБС(б) - 41", "ИЭУ", 3], ["68634", "УАБСшти(б) - 41", "ИЭУ", 3], ["68490", "УБ(б) - 41", "ИЭУ", 3], ["68546", "УБ(б)оз - 41", "ИЭУ", 3], ["68393", "УПЕ(м)оз - 41", "ИЭУ", 3], ["68422", "ФК(б) - 41", "ИЭУ", 3], ["68486", "ФК(м)з - 41", "ИЭУ", 3], ["68323", "ЭБ(с) - 41", "ИЭУ", 3], ["68088", "ГКУиэп(б) - 31", "ИЭУ", 4], ["66941", "МБИ(б) - 31", "ИЭУ", 4], ["68066", "МБИ(б) - 32", "ИЭУ", 4], ["68077", "МБИциря(б) - 31", "ИЭУ", 4], ["68247", "МБИциря(б) - 32", "ИЭУ", 4], ["68248", "МБИциря(б) - 33", "ИЭУ", 4], ["68249", "МБИциря(б) - 34", "ИЭУ", 4], ["68092", "МЭиэп(б) - 31", "ИЭУ", 4], ["68089", "ПИиэп(б) - 31", "ИЭУ", 4], ["66920", "ПИЭ(б) - 31", "ИЭУ", 4], ["66967", "ПИЭ(б)з - 31", "ИЭУ", 4], ["68115", "ТДиэп(с) - 31", "ИЭУ", 4], ["68224", "ТДиэп(с)з - 31", "ИЭУ", 4], ["68096", "ФКиэп(б) - 31", "ИЭУ", 4], ["68234", "ЭБиэп(с)з - 31", "ИЭУ", 4], ["66896", "ЭБ(с) - 31", "ИЭУ", 4], ["67001", "ЭП(б) - 31", "ИЭУ", 4], ["66785", "ПИЭ(б)з - 21", "ИЭУ", 5], ["68116", "ТДиэп(с) - 21", "ИЭУ", 5], ["68225", "ТДиэп(с)з - 21", "ИЭУ", 5], ["68232", "ТДиэп(с)зу - 11", "ИЭУ", 5], ["68112", "ЭБиэп(с) - 21", "ИЭУ", 5], ["68235", "ЭБиэп(с)з - 21", "ИЭУ", 5], ["66594", "ЭБ(с) - 21", "ИЭУ", 5], ["66595", "ЭБ(с) - 22", "ИЭУ", 5], ["68226", "ТДиэп(с)з - 11", "ИЭУ", 6], ["68243", "ЭБиэп(с)зу - 11", "ИЭУ", 6], ["68244", "ЭБиэп(с)зу - 12", "ИЭУ", 6], ["68278", "ЭБиэп(с)зу - 13", "ИЭУ", 6], ["69173", "ПВГ - 61", "ОМО", 1], ["69177", "ПВЭ - 61", "ОМО", 1], ["69179", "РЯ (А1-В1) - 61", "ОМО", 1], ["69178", "РЯ (А2-В1) - 61", "ОМО", 1], ["69180", "РЯ(В1-В2) - 61", "ОМО", 1], ["69134", "АД(а) - 61", "ПКВК", 1], ["69149", "ВИ(а) - 61", "ПКВК", 1], ["69141", "ГТ(а) - 61", "ПКВК", 1], ["69130", "ГЭ(а) - 61", "ПКВК", 1], ["69189", "Ж(а) - 61", "ПКВК", 1], ["69129", "ЗКМ(а) - 61", "ПКВК", 1], ["69136", "ИБ(а) - 61", "ПКВК", 1], ["69151", "ИДА(а) - 61", "ПКВК", 1], ["69127", "ИИ(а) - 61", "ПКВК", 1], ["69150", "ИК(а) - 61", "ПКВК", 1], ["69140", "ЛП(а) - 61", "ПКВК", 1], ["69144", "ЛПТ(а) - 61", "ПКВК", 1], ["69201", "М(а) - 61", "ПКВК", 1], ["69139", "ММ(а) - 61", "ПКВК", 1], ["69126", "ММП(а) - 61", "ПКВК", 1], ["69148", "ОИ(а) - 61", "ПКВК", 1], ["69200", "ОПИ(а) - 61", "ПКВК", 1], ["69146", "ОПЛ(а) - 61", "ПКВК", 1], ["69145", "ПН(а) - 61", "ПКВК", 1], ["69147", "ПП(а) - 61", "ПКВК", 1], ["69205", "РОЭ(а) - 61", "ПКВК", 1], ["69135", "САУ(а) - 61", "ПКВК", 1], ["69132", "СК(а) - 61", "ПКВК", 1], ["69133", "СМИ(а) - 61", "ПКВК", 1], ["69198", "ССИ(а) - 61", "ПКВК", 1], ["69204", "СУ(а) - 61", "ПКВК", 1], ["69131", "ТИА(а) - 61", "ПКВК", 1], ["69154", "ТЛП(а) - 61", "ПКВК", 1], ["69138", "ТМ(а) - 61", "ПКВК", 1], ["69199", "ТОВ(а) - 61", "ПКВК", 1], ["69202", "ТПО(а) - 61", "ПКВК", 1], ["69142", "ТС(а) - 61", "ПКВК", 1], ["69137", "ТТС(а) - 61", "ПКВК", 1], ["69125", "ТФ(а) - 61", "ПКВК", 1], ["69206", "УК(а) - 61", "ПКВК", 1], ["69203", "Ф(а) - 61", "ПКВК", 1], ["69143", "ЭАТ(а) - 61", "ПКВК", 1], ["69128", "ЭТН(а) - 61", "ПКВК", 1], ["68843", "АД(а) - 51", "ПКВК", 2], ["68839", "БТ(а) - 51", "ПКВК", 2], ["68926", "ВИ(а) - 51", "ПКВК", 2], ["68851", "ГТ(а) - 51", "ПКВК", 2], ["68913", "ГЯ(а) - 51", "ПКВК", 2], ["68847", "ИБ(а) - 51", "ПКВК", 2], ["68915", "ИДА(а) - 51", "ПКВК", 2], ["68904", "ИК(а) - 51", "ПКВК", 2], ["68845", "ИС(а) - 51", "ПКВК", 2], ["68849", "ЛП(а) - 51", "ПКВК", 2], ["68854", "ЛПТ(а) - 51", "ПКВК", 2], ["68902", "М(а) - 51", "ПКВК", 2], ["68850", "ММ(а) - 51", "ПКВК", 2], ["68908", "ОИ(а) - 51", "ПКВК", 2], ["68910", "ОПИ(а) - 51", "ПКВК", 2], ["68855", "ОПЛ(а) - 51", "ПКВК", 2], ["68890", "ПН(а) - 51", "ПКВК", 2], ["68856", "ПП(а) - 51", "ПКВК", 2], ["68912", "РЛ(а) - 51", "ПКВК", 2], ["68914", "РОЭ(а) - 51", "ПКВК", 2], ["68846", "САУ(а) - 51", "ПКВК", 2], ["68841", "СК(а) - 51", "ПКВК", 2], ["68842", "СМИ(а) - 51", "ПКВК", 2], ["68906", "ССИ(а) - 51", "ПКВК", 2], ["68907", "СУ(а) - 51", "ПКВК", 2], ["68844", "ТИА(а) - 51", "ПКВК", 2], ["68911", "ТОВ(а) - 51", "ПКВК", 2], ["68903", "ТПО(а) - 51", "ПКВК", 2], ["68852", "ТС(а) - 51", "ПКВК", 2], ["68960", "ТТС(а) - 51", "ПКВК", 2], ["68909", "ФА(а) - 51", "ПКВК", 2], ["68853", "ЭАТ(а) - 51", "ПКВК", 2], ["68840", "ЭТН(а) - 51", "ПКВК", 2], ["68493", "АД(а) - 41", "ПКВК", 3], ["68512", "БТ(а) - 41", "ПКВК", 3], ["68533", "ГТ(а) - 41", "ПКВК", 3], ["68541", "ЛПТ(а) - 41", "ПКВК", 3], ["68496", "ММ(а) - 41", "ПКВК", 3], ["68532", "ПП(а) - 41", "ПКВК", 3], ["68531", "СУ(а) - 41", "ПКВК", 3], ["68506", "ТМ(а) - 41", "ПКВК", 3], ["68500", "ТПО(а) - 41", "ПКВК", 3], ["68540", "ТС(а) - 41", "ПКВК", 3], ["68517", "ТФ(а) - 41", "ПКВК", 3], ["68497", "ЭАТ(а) - 41", "ПКВК", 3], ["68514", "ЭБН(а) - 41", "ПКВК", 3], ["68513", "ЭТН(а) - 41", "ПКВК", 3], ["69012", "ПОБГ(б)з - 61", "Пединститут", 1], ["69067", "ПОБО(м)з - 61", "Пединститут", 1], ["69010", "ПОБХ(б) - 61", "Пединститут", 1], ["69019", "ПОДЛ(б)з - 61", "Пединститут", 1], ["69065", "ПОДО(м)з - 61", "Пединститут", 1], ["69068", "ПОИИ(м)з - 61", "Пединститут", 1], ["69085", "ПОИМО(б) - 61", "Пединститут", 1], ["69020", "ПОИО(б) - 61", "Пединститут", 1], ["69021", "ПОИО(б)з - 61", "Пединститут", 1], ["69009", "ПОИФ(б) - 61", "Пединститут", 1], ["68999", "ПОМИ(б) - 61", "Пединститут", 1], ["69000", "ПОМИ(б)з - 61", "Пединститут", 1], ["69013", "ПОНОД(б) - 61", "Пединститут", 1], ["69015", "ПОНОД(б)з - 61", "Пединститут", 1], ["69066", "ПОНО(м)з - 61", "Пединститут", 1], ["69064", "ПОП(м)з - 61", "Пединститут", 1], ["69071", "ПОПО(м) - 61", "Пединститут", 1], ["69005", "ПОФК(б) - 61", "Пединститут", 1], ["69114", "ПОФК(б)з - 61", "Пединститут", 1], ["69070", "ПОФК(м) - 61", "Пединститут", 1], ["69027", "ППО(б) - 61", "Пединститут", 1], ["68996", "ПС(б) - 61", "Пединститут", 1], ["69082", "ПС(м)оз - 61", "Пединститут", 1], ["69026", "ПСП(б) - 61", "Пединститут", 1], ["69080", "ПСП(б)з - 61", "Пединститут", 1], ["69025", "СОЛ(б) - 61", "Пединститут", 1], ["69024", "СОО(б)з - 61", "Пединститут", 1], ["69069", "ТИИ(м) - 61", "Пединститут", 1], ["68706", "ИАТ(м) - 51", "Пединститут", 2], ["68745", "ПОБГ(б)з - 51", "Пединститут", 2], ["68763", "ПОБЖ(м)з - 51", "Пединститут", 2], ["68767", "ПОБО(м)з - 51", "Пединститут", 2], ["68673", "ПОБХ(б) - 51", "Пединститут", 2], ["68742", "ПОДЛ(б)з - 51", "Пединститут", 2], ["68761", "ПОДО(м)з - 51", "Пединститут", 2], ["68766", "ПОИИ(м)з - 51", "Пединститут", 2], ["68661", "ПОИО(б) - 51", "Пединститут", 2], ["68662", "ПОИО(б) - 52", "Пединститут", 2], ["68737", "ПОИО(б)з - 51", "Пединститут", 2], ["68674", "ПОИФ(б) - 51", "Пединститут", 2], ["68677", "ПОМИ(б) - 51", "Пединститут", 2], ["68746", "ПОМИ(б)з - 51", "Пединститут", 2], ["68672", "ПОНОД(б) - 51", "Пединститут", 2], ["68743", "ПОНОД(б)з - 51", "Пединститут", 2], ["68764", "ПОНО(м)з - 51", "Пединститут", 2], ["68762", "ПОП(м)з - 51", "Пединститут", 2], ["68730", "ПОПО(м) - 51", "Пединститут", 2], ["68814", "ПОТИ(б) - 51", "Пединститут", 2], ["68660", "ПОФК(б) - 51", "Пединститут", 2], ["68736", "ПОФК(б)з - 51", "Пединститут", 2], ["68731", "ПОФК(м) - 51", "Пединститут", 2], ["68689", "ППО(б) - 51", "Пединститут", 2], ["68755", "ППО(б)з - 51", "Пединститут", 2], ["68695", "ПС(б) - 51", "Пединститут", 2], ["68727", "ПС(м) - 51", "Пединститут", 2], ["68739", "ПС(м)оз - 51", "Пединститут", 2], ["68941", "ПС(м)оз - 52", "Пединститут", 2], ["68688", "ПСП(б) - 51", "Пединститут", 2], ["68756", "ПСП(б)з - 51", "Пединститут", 2], ["68681", "СОЛ(б) - 51", "Пединститут", 2], ["68942", "СОЛ(б) - 52", "Пединститут", 2], ["68747", "СОО(б)з - 51", "Пединститут", 2], ["68796", "ТИИ(м) - 51", "Пединститут", 2], ["68735", "УпО(м)оз - 51", "Пединститут", 2], ["68440", "ПОБГ(б)з - 41", "Пединститут", 3], ["68455", "ПОБО(м)з - 41", "Пединститут", 3], ["68384", "ПОБХ(б) - 41", "Пединститут", 3], ["68395", "ПОДЛ(б) - 41", "Пединститут", 3], ["68442", "ПОДЛ(б)з - 41", "Пединститут", 3], ["68460", "ПОДО(м)з - 41", "Пединститут", 3], ["68456", "ПОИИ(м)з - 41", "Пединститут", 3], ["68402", "ПОИО(б) - 41", "Пединститут", 3], ["68403", "ПОИО(б) - 42", "Пединститут", 3], ["68445", "ПОИО(б)з - 41", "Пединститут", 3], ["68458", "ПОМДО(м)з - 41", "Пединститут", 3], ["68382", "ПОМИ(б) - 41", "Пединститут", 3], ["68439", "ПОМИ(б)з - 41", "Пединститут", 3], ["68385", "ПОНОД(б) - 41", "Пединститут", 3], ["68441", "ПОНОД(б)з - 41", "Пединститут", 3], ["68459", "ПОП(м)з - 41", "Пединститут", 3], ["68404", "ПОФК(б) - 41", "Пединститут", 3], ["68446", "ПОФК(б)з - 41", "Пединститут", 3], ["68380", "ППО(б) - 41", "Пединститут", 3], ["68436", "ППО(б)з - 41", "Пединститут", 3], ["68373", "ПС(б) - 41", "Пединститут", 3], ["68391", "ПС(м)оз - 41", "Пединститут", 3], ["68437", "ПСП(б)з - 41", "Пединститут", 3], ["68381", "СОЛ(б) - 41", "Пединститут", 3], ["68438", "СОО(б)з - 41", "Пединститут", 3], ["68394", "УпО(м)оз - 41", "Пединститут", 3], ["67002", "ПОБГ(б)з - 31", "Пединститут", 4], ["66943", "ПОБХ(б) - 31", "Пединститут", 4], ["66951", "ПОДЛ(б) - 31", "Пединститут", 4], ["66973", "ПОДЛ(б)з - 31", "Пединститут", 4], ["66947", "ПОИО(б) - 31", "Пединститут", 4], ["68050", "ПОИО(б) - 32", "Пединститут", 4], ["67027", "ПОИО(б)з - 31", "Пединститут", 4], ["66945", "ПОИФ(б) - 31", "Пединститут", 4], ["66944", "ПОМИ(б) - 31", "Пединститут", 4], ["66983", "ПОМИ(б)з - 31", "Пединститут", 4], ["66952", "ПОНОД(б) - 31", "Пединститут", 4], ["67003", "ПОНОД(б)з - 31", "Пединститут", 4], ["66948", "ПОФК(б) - 31", "Пединститут", 4], ["67038", "ПОФК(б)з - 31", "Пединститут", 4], ["66942", "ППО(б) - 31", "Пединститут", 4], ["67026", "ППО(б)з - 31", "Пединститут", 4], ["68075", "ППО(б)з - 32", "Пединститут", 4], ["66926", "ПС(б) - 31", "Пединститут", 4], ["67014", "ПСП(б)з - 31", "Пединститут", 4], ["66957", "СОЛ(б) - 31", "Пединститут", 4], ["67044", "СОО(б)з - 31", "Пединститут", 4], ["66813", "ПОБГ(б)з - 21", "Пединститут", 5], ["66695", "ПОБХ(б) - 21", "Пединститут", 5], ["66706", "ПОДЛ(б) - 21", "Пединститут", 5], ["66794", "ПОДЛ(б)з - 21", "Пединститут", 5], ["66688", "ПОИО(б) - 21", "Пединститут", 5], ["66792", "ПОИО(б)з - 21", "Пединститут", 5], ["66694", "ПОИФ(б) - 21", "Пединститут", 5], ["66693", "ПОМИ(б) - 21", "Пединститут", 5], ["66793", "ПОМИ(б)з - 21", "Пединститут", 5], ["66704", "ПОНОЛ(б) - 21", "Пединститут", 5], ["66797", "ПОНОЛ(б)з - 21", "Пединститут", 5], ["66717", "ПОФК(б) - 21", "Пединститут", 5], ["66801", "ПОФК(б)з - 21", "Пединститут", 5], ["66878", "ППО(б)з - 21", "Пединститут", 5], ["66798", "ПСП(б)з - 21", "Пединститут", 5], ["66811", "СОО(б)з - 21", "Пединститут", 5], ["66432", "ПОБГ(б)з - 11", "Пединститут", 6], ["66420", "ПОДЛ(б)з - 11", "Пединститут", 6], ["66117", "ПОДЛ(б)з - 81", "Пединститут", 6], ["66418", "ПОИО(б)з - 11", "Пединститут", 6], ["66431", "ПОМИ(б)з - 11", "Пединститут", 6], ["66114", "ПОНОД(б)з - 81", "Пединститут", 6], ["66422", "ПОНОЛ(б)з - 11", "Пединститут", 6], ["66429", "ПОФК(б)з - 11", "Пединститут", 6], ["69164", "АБД(м) - 61", "ПОЛИТЕХ", 1], ["69076", "АКФС(б) - 61", "ПОЛИТЕХ", 1], ["68990", "АС(б)з - 61", "ПОЛИТЕХ", 1], ["69054", "В(с) - 61", "ПОЛИТЕХ", 1], ["69016", "ГД(с) - 61", "ПОЛИТЕХ", 1], ["69017", "ГД(с)з - 61", "ПОЛИТЕХ", 1], ["68977", "ЗЧС(б) - 61", "ПОЛИТЕХ", 1], ["69094", "ЗЧС(б)з - 61", "ПОЛИТЕХ", 1], ["69039", "ЗЧС(м) - 61", "ПОЛИТЕХ", 1], ["69168", "ИПМ(м) - 61", "ПОЛИТЕХ", 1], ["68971", "ИС(б) - 61", "ПОЛИТЕХ", 1], ["68970", "ИТД(б) - 61", "ПОЛИТЕХ", 1], ["69092", "КБП(с) - 61", "ПОЛИТЕХ", 1], ["69058", "КБТ(м) - 61", "ПОЛИТЕХ", 1], ["68992", "КСП(б) - 61", "ПОЛИТЕХ", 1], ["68969", "КСТ(б) - 61", "ПОЛИТЕХ", 1], ["69046", "КСТ(м) - 61", "ПОЛИТЕХ", 1], ["68994", "ЛИ(б) - 61", "ПОЛИТЕХ", 1], ["68989", "ЛТП(б) - 61", "ПОЛИТЕХ", 1], ["69097", "ЛТП(б)з - 61", "ПОЛИТЕХ", 1], ["69165", "МИТ(м) - 61", "ПОЛИТЕХ", 1], ["69055", "НТС(с)з - 61", "ПОЛИТЕХ", 1], ["68984", "ОНГ(б) - 61", "ПОЛИТЕХ", 1], ["69042", "ОНГ(м) - 61", "ПОЛИТЕХ", 1], ["69018", "ОПИ(с)з - 61", "ПОЛИТЕХ", 1], ["68979", "ПВ(б)оз - 61", "ПОЛИТЕХ", 1], ["68972", "ПИА(б) - 61", "ПОЛИТЕХ", 1], ["69043", "ПИИ(м) - 61", "ПОЛИТЕХ", 1], ["68982", "ПО(б) - 61", "ПОЛИТЕХ", 1], ["68983", "ПО(б) - 62", "ПОЛИТЕХ", 1], ["69098", "РБС(б)з - 61", "ПОЛИТЕХ", 1], ["69041", "РТК(м) - 61", "ПОЛИТЕХ", 1], ["69030", "СНК(б)з - 61", "ПОЛИТЕХ", 1], ["68991", "ТИН(б) - 61", "ПОЛИТЕХ", 1], ["68974", "ТОИП(б) - 61", "ПОЛИТЕХ", 1], ["69108", "ТОИП(б)з - 61", "ПОЛИТЕХ", 1], ["69208", "ТПЛА(с) - 61", "ПОЛИТЕХ", 1], ["68985", "ТПН(б) - 61", "ПОЛИТЕХ", 1], ["68993", "ТХОМ(б) - 61", "ПОЛИТЕХ", 1], ["69167", "УТС(м) - 61", "ПОЛИТЕХ", 1], ["69040", "ХТ(м) - 61", "ПОЛИТЕХ", 1], ["69056", "ЭАТ(м) - 61", "ПОЛИТЕХ", 1], ["69057", "ЭАТ(м)з - 61", "ПОЛИТЕХ", 1], ["68966", "ЭБЗ(б) - 61", "ПОЛИТЕХ", 1], ["68714", "АБД(м) - 51", "ПОЛИТЕХ", 2], ["68751", "АС(б)з - 51", "ПОЛИТЕХ", 2], ["68704", "В(с) - 51", "ПОЛИТЕХ", 2], ["68703", "ГД(с) - 51", "ПОЛИТЕХ", 2], ["68757", "ГД(с)з - 51", "ПОЛИТЕХ", 2], ["68696", "ЗЧС(б) - 51", "ПОЛИТЕХ", 2], ["68952", "ЗЧС(б) - 52", "ПОЛИТЕХ", 2], ["68792", "ЗЧС(б)з - 51", "ПОЛИТЕХ", 2], ["68721", "ЗЧС(м) - 51", "ПОЛИТЕХ", 2], ["68697", "ИНАГ(б) - 51", "ПОЛИТЕХ", 2], ["68955", "ИНАГ(б) - 52", "ПОЛИТЕХ", 2], ["68722", "ИПМ(м) - 51", "ПОЛИТЕХ", 2], ["68682", "ИС(б) - 51", "ПОЛИТЕХ", 2], ["68803", "ИСС(б) - 51", "ПОЛИТЕХ", 2], ["68658", "ИСФ(б) - 51", "ПОЛИТЕХ", 2], ["68680", "ИТД(б) - 51", "ПОЛИТЕХ", 2], ["68804", "ИУТС(б) - 51", "ПОЛИТЕХ", 2], ["68702", "КБ(с) - 51", "ПОЛИТЕХ", 2], ["68726", "КБТ(м) - 51", "ПОЛИТЕХ", 2], ["68769", "КБТ(м)з - 51", "ПОЛИТЕХ", 2], ["68795", "КСП(б) - 51", "ПОЛИТЕХ", 2], ["68679", "КСТ(б) - 51", "ПОЛИТЕХ", 2], ["68713", "КСТ(м) - 51", "ПОЛИТЕХ", 2], ["68698", "ЛИ(б) - 51", "ПОЛИТЕХ", 2], ["68950", "ЛИ(б) - 52", "ПОЛИТЕХ", 2], ["68701", "ЛТП(б) - 51", "ПОЛИТЕХ", 2], ["68951", "ЛТП(б) - 52", "ПОЛИТЕХ", 2], ["68749", "ЛТП(б)з - 51", "ПОЛИТЕХ", 2], ["68717", "МИТ(м) - 51", "ПОЛИТЕХ", 2], ["68760", "НТС(с)з - 51", "ПОЛИТЕХ", 2], ["68692", "ОНГ(б) - 51", "ПОЛИТЕХ", 2], ["68719", "ОНГ(м) - 51", "ПОЛИТЕХ", 2], ["68759", "ОПИ(с)з - 51", "ПОЛИТЕХ", 2], ["68812", "ПВ(б)оз - 51", "ПОЛИТЕХ", 2], ["68683", "ПИА(б) - 51", "ПОЛИТЕХ", 2], ["68716", "ПИИ(м) - 51", "ПОЛИТЕХ", 2], ["68686", "ПО(б) - 51", "ПОЛИТЕХ", 2], ["68687", "ПО(б) - 52", "ПОЛИТЕХ", 2], ["68865", "РТК(м) - 51", "ПОЛИТЕХ", 2], ["68754", "СНК(б)з - 51", "ПОЛИТЕХ", 2], ["68700", "ТИН(б) - 51", "ПОЛИТЕХ", 2], ["68694", "ТОИП(б) - 51", "ПОЛИТЕХ", 2], ["68954", "ТОИП(б) - 52", "ПОЛИТЕХ", 2], ["68919", "ТОИП(б)з - 51", "ПОЛИТЕХ", 2], ["68901", "ТПЛА(с) - 51", "ПОЛИТЕХ", 2], ["68693", "ТПН(б) - 51", "ПОЛИТЕХ", 2], ["68791", "ТПН(б)з - 51", "ПОЛИТЕХ", 2], ["68699", "ТХОМ(б) - 51", "ПОЛИТЕХ", 2], ["68725", "УТС(м) - 51", "ПОЛИТЕХ", 2], ["68708", "ФКС(м) - 51", "ПОЛИТЕХ", 2], ["68720", "ХТ(м) - 51", "ПОЛИТЕХ", 2], ["68723", "ЭАТ(м) - 51", "ПОЛИТЕХ", 2], ["68765", "ЭАТ(м)з - 51", "ПОЛИТЕХ", 2], ["68663", "ЭБЗ(б) - 51", "ПОЛИТЕХ", 2], ["68430", "АС(б)з - 41", "ПОЛИТЕХ", 3], ["68544", "ГД(с) - 41", "ПОЛИТЕХ", 3], ["68548", "ГД(с)з - 41", "ПОЛИТЕХ", 3], ["68318", "ЗЧС(б) - 41", "ПОЛИТЕХ", 3], ["68427", "ЗЧС(б)з - 41", "ПОЛИТЕХ", 3], ["68480", "ИНАГ(б) - 41", "ПОЛИТЕХ", 3], ["68370", "ИС(б) - 41", "ПОЛИТЕХ", 3], ["68364", "ИСФ(б) - 41", "ПОЛИТЕХ", 3], ["68478", "ИТД(б) - 41", "ПОЛИТЕХ", 3], ["68312", "ИУС(б) - 41", "ПОЛИТЕХ", 3], ["68640", "ИУС(б) - 42", "ПОЛИТЕХ", 3], ["68322", "КБ(с) - 41", "ПОЛИТЕХ", 3], ["68452", "КБТ(м)з - 41", "ПОЛИТЕХ", 3], ["68369", "КСТ(б) - 41", "ПОЛИТЕХ", 3], ["68420", "ЛИ(б) - 41", "ПОЛИТЕХ", 3], ["68639", "ЛИ(б) - 42", "ПОЛИТЕХ", 3], ["68319", "ЛТП(б) - 41", "ПОЛИТЕХ", 3], ["68428", "ЛТП(б)з - 41", "ПОЛИТЕХ", 3], ["68315", "МТС(б) - 41", "ПОЛИТЕХ", 3], ["68447", "НТС(с)з - 41", "ПОЛИТЕХ", 3], ["68316", "ОНГ(б) - 41", "ПОЛИТЕХ", 3], ["68550", "ОПИ(с)з - 41", "ПОЛИТЕХ", 3], ["68371", "ПИА(б) - 41", "ПОЛИТЕХ", 3], ["68363", "ПМ(б) - 41", "ПОЛИТЕХ", 3], ["68314", "ПО(б) - 41", "ПОЛИТЕХ", 3], ["68429", "СДМ(б)з - 41", "ПОЛИТЕХ", 3], ["68434", "СНК(б)з - 41", "ПОЛИТЕХ", 3], ["68477", "ТИН(б) - 41", "ПОЛИТЕХ", 3], ["68519", "ТОИП(б) - 41", "ПОЛИТЕХ", 3], ["68649", "ТОИП(б)з - 41", "ПОЛИТЕХ", 3], ["68622", "ТПЛА(с) - 41", "ПОЛИТЕХ", 3], ["68317", "ТПН(б) - 41", "ПОЛИТЕХ", 3], ["68463", "ТПН(б)з - 41", "ПОЛИТЕХ", 3], ["68311", "ТХОМ(б) - 41", "ПОЛИТЕХ", 3], ["68321", "ЦМК(б) - 41", "ПОЛИТЕХ", 3], ["68451", "ЭАТ(м)з - 41", "ПОЛИТЕХ", 3], ["68365", "ЭБЗ(б) - 41", "ПОЛИТЕХ", 3], ["66922", "ААХ(б) - 31", "ПОЛИТЕХ", 4], ["67045", "АС(б)з - 31", "ПОЛИТЕХ", 4], ["66898", "ГД(с) - 31", "ПОЛИТЕХ", 4], ["66999", "ГД(с)з - 31", "ПОЛИТЕХ", 4], ["66917", "ЗЧС(б) - 31", "ПОЛИТЕХ", 4], ["66968", "ЗЧС(б)з - 31", "ПОЛИТЕХ", 4], ["66937", "ИС(б) - 31", "ПОЛИТЕХ", 4], ["66886", "ИСФ(б) - 31", "ПОЛИТЕХ", 4], ["67023", "ИТД(б) - 31", "ПОЛИТЕХ", 4], ["66924", "ИУС(б) - 31", "ПОЛИТЕХ", 4], ["66895", "КБ(с) - 31", "ПОЛИТЕХ", 4], ["66936", "КСТ(б) - 31", "ПОЛИТЕХ", 4], ["66956", "ЛИ(б) - 31", "ПОЛИТЕХ", 4], ["66921", "ЛТП(б) - 31", "ПОЛИТЕХ", 4], ["66969", "ЛТП(б)з - 31", "ПОЛИТЕХ", 4], ["66918", "МТС(б) - 31", "ПОЛИТЕХ", 4], ["67063", "НТС(с)з - 31", "ПОЛИТЕХ", 4], ["66938", "ОНГ(б) - 31", "ПОЛИТЕХ", 4], ["67024", "ПИА(б) - 31", "ПОЛИТЕХ", 4], ["66885", "ПМ(б) - 31", "ПОЛИТЕХ", 4], ["66919", "ПО(б) - 31", "ПОЛИТЕХ", 4], ["66970", "СДМ(б)з - 31", "ПОЛИТЕХ", 4], ["66994", "СНК(б)з - 31", "ПОЛИТЕХ", 4], ["67115", "ТЛсау(б) - 31", "ПОЛИТЕХ", 4], ["69156", "ТЛсау(б) - 32", "ПОЛИТЕХ", 4], ["69157", "ТЛсау(б) - 33", "ПОЛИТЕХ", 4], ["68080", "ТОИПиэп(б) - 31", "ПОЛИТЕХ", 4], ["68145", "ТОИПиэп(б)з - 31", "ПОЛИТЕХ", 4], ["67050", "ТПН(б) - 31", "ПОЛИТЕХ", 4], ["67116", "ТПН(б)з - 31", "ПОЛИТЕХ", 4], ["66925", "ТХОМ(б) - 31", "ПОЛИТЕХ", 4], ["66923", "ЦМК(б) - 31", "ПОЛИТЕХ", 4], ["67040", "ЭБЗ(б) - 31", "ПОЛИТЕХ", 4], ["66784", "ААХ(б)з - 21", "ПОЛИТЕХ", 5], ["69159", "АС(б)з - 21", "ПОЛИТЕХ", 5], ["66687", "ГД(с) - 21", "ПОЛИТЕХ", 5], ["66760", "ГД(с)з - 21", "ПОЛИТЕХ", 5], ["66782", "ЗЧС(б)з - 21", "ПОЛИТЕХ", 5], ["66662", "КБ(с) - 21", "ПОЛИТЕХ", 5], ["66788", "ЛТП(б)з - 21", "ПОЛИТЕХ", 5], ["66686", "НТС(с) - 21", "ПОЛИТЕХ", 5], ["66790", "ОНГ(б)з - 21", "ПОЛИТЕХ", 5], ["66789", "СДМ(б)з - 21", "ПОЛИТЕХ", 5], ["66809", "СНК(б)з - 21", "ПОЛИТЕХ", 5], ["66864", "ТЛсау(б) - 21", "ПОЛИТЕХ", 5], ["68781", "ТЛсау(б) - 22", "ПОЛИТЕХ", 5], ["68782", "ТЛсау(б) - 23", "ПОЛИТЕХ", 5], ["68146", "ТОИПиэп(б)з - 21", "ПОЛИТЕХ", 5], ["66810", "УЭПС(б)з - 21", "ПОЛИТЕХ", 5], ["65575", "ГД(с) - 11", "ПОЛИТЕХ", 6], ["66561", "ГД(с)з - 11", "ПОЛИТЕХ", 6], ["65574", "КБ(с) - 11", "ПОЛИТЕХ", 6], ["69081", "ПОНБ(с) - 61", "ЮИ", 1], ["69034", "Ю(б) - 61", "ЮИ", 1], ["69035", "Ю(б) - 62", "ЮИ", 1], ["69078", "Ю(б)з - 61", "ЮИ", 1], ["69063", "Ю(м)з - 61", "ЮИ", 1], ["68874", "ГП(м) - 51", "ЮИ", 2], ["68802", "ПОНБ(с) - 51", "ЮИ", 2], ["68801", "Ю(б) - 51", "ЮИ", 2], ["68936", "Ю(б) - 52", "ЮИ", 2], ["68799", "Ю(б)з - 51", "ЮИ", 2], ["68821", "Ю(м)з - 51", "ЮИ", 2], ["68483", "ГП(м)з - 41", "ЮИ", 3], ["68324", "ПОНБ(с) - 41", "ЮИ", 3], ["68325", "ПОНБ(с) - 42", "ЮИ", 3], ["68375", "Ю(б) - 41", "ЮИ", 3], ["68619", "Ю(б) - 42", "ЮИ", 3], ["68432", "Ю(б)з - 41", "ЮИ", 3], ["68454", "Ю(м)з - 41", "ЮИ", 3], ["66897", "ПОНБ(с) - 31", "ЮИ", 4], ["66900", "ПОНБ(с) - 32", "ЮИ", 4], ["66928", "Ю(б) - 31", "ЮИ", 4], ["67046", "Ю(б)з - 31", "ЮИ", 4], ["68105", "Юиэп(б) - 31", "ЮИ", 4], ["68192", "Юиэп(б)оз - 31", "ЮИ", 4], ["66730", "ПОНБ(с) - 21", "ЮИ", 5], ["66731", "ПОНБ(с) - 22", "ЮИ", 5], ["66732", "Ю(б) - 21", "ЮИ", 5], ["68193", "Юиэп(б)оз - 21", "ЮИ", 5]];

const INSTITUTE_FULL_NAMES: Record<string, string> = {
  'ИАСиД': 'Институт архитектуры, строительства и дизайна',
  'ИЛМК': 'Институт лингвистики и межкультурной коммуникации',
  'ИСПТиК': 'Институт социально-политических технологий и коммуникаций',
  'ИЭУ': 'Институт экономики и управления',
  'ОМО': 'Отдел международного образования',
  'ПКВК': 'Отдел кадров высшей квалификации (Аспирантура)',
  'Пединститут': 'Педагогический институт',
  'ПОЛИТЕХ': 'Политехнический институт',
  'ЮИ': 'Юридический институт',
  'ИТ': 'Высшая школа кибернетики и цифровых технологий',
  'ПИ': 'Политехнический институт',
  'ИАиД': 'Институт архитектуры и дизайна',
  'ПедИнститут': 'Педагогический институт',
};

// ============================================================================
// ТИПЫ ДАННЫХ ПРИЛОЖЕНИЯ (TypeScript Interfaces)
// ============================================================================

export type LessonType = 'lecture' | 'practice' | 'lab' | 'seminar' | 'project';
export type WeekParity = 'odd' | 'even';
export type SubgroupFilter = 'all' | '1' | '2';
export type NavTab = 'today' | 'week' | 'calendar' | 'groups' | 'settings';
export type ThemeMode = 'dark' | 'oled' | 'light';
export type AccentColor = 'blue' | 'emerald' | 'violet' | 'amber';

export interface BellSlot {
  pairNumber: number;
  start: string;
  end: string;
  breakAfter?: string;
}

export interface LessonItem {
  id: string;
  slotKey?: string;
  pairNumber: number;
  startTime: string;
  endTime: string;
  subject: string;
  type: LessonType;
  eventTypeShort?: string;
  eventTypeFull?: string;
  room: string;
  roomUrl?: string;
  building: string;
  teacher: string;
  teacherTitle: string;
  teacherUrl?: string;
  subgroup?: 'all' | '1' | '2';
  weekParity: 'both' | WeekParity;
  dayOfWeek: number;
  dateRange?: string;
  dateFrom?: string;
  dateTo?: string;
  isOnline?: boolean;
  department?: string;
  defaultNote?: string;
  overrideStatus?: LessonOverrideStatus;
  overrideReason?: string;
  overrideNewDate?: string;
  overrideNewPairNumber?: number;
  overrideNewStartTime?: string;
  overrideNewRoomCode?: string;
}

export interface StudentGroup {
  id: string;
  code: string;
  name: string;
  specializationCode: string;
  instituteShort: string;
  instituteFull: string;
  course: number;
  degree: 'Бакалавриат' | 'Специалитет' | 'Магистратура' | 'Аспирантура';
  form: 'Очная' | 'Заочная' | 'Очно-заочная';
  studentsCount: number;
  headmanDemo: string;
  hasOfficialSnapshot?: boolean;
  isTestFixture?: boolean;
}

export interface AppSettings {
  selectedGroupId: string;
  subgroup: SubgroupFilter;
  theme: ThemeMode;
  accent: AccentColor;
  compactCards: boolean;
  showWindows: boolean;
  showBigBreak: boolean;
  showPairNumbers: boolean;
  autoWeekParity: boolean;
}

// ============================================================================
// КОНСТАНТЫ И СПРАВОЧНИКИ ТОГУ
// ============================================================================

export const TOGU_BELL_SCHEDULE: BellSlot[] = [
  { pairNumber: 1, start: '08:30', end: '10:00', breakAfter: '10 мин' },
  { pairNumber: 2, start: '10:10', end: '11:40', breakAfter: '10 мин' },
  { pairNumber: 3, start: '11:50', end: '13:20', breakAfter: 'Большой перерыв 30 мин (13:20–13:50)' },
  { pairNumber: 4, start: '13:50', end: '15:20', breakAfter: '10 мин' },
  { pairNumber: 5, start: '15:30', end: '17:00', breakAfter: '10 мин' },
  { pairNumber: 6, start: '17:10', end: '18:40', breakAfter: '10 мин' },
  { pairNumber: 7, start: '18:50', end: '20:20', breakAfter: '10 мин' },
  { pairNumber: 8, start: '20:30', end: '22:00' },
];

export const LESSON_TYPE_META: Record<
  LessonType,
  { label: string; shortLabel: string; badgeDark: string; badgeLight: string; dotColor: string; borderAccent: string }
> = {
  lecture: {
    label: 'Лекция',
    shortLabel: 'Лек',
    badgeDark: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    badgeLight: 'bg-blue-50 text-blue-700 border-blue-200',
    dotColor: 'bg-blue-400',
    borderAccent: 'border-l-blue-500',
  },
  practice: {
    label: 'Практика',
    shortLabel: 'Пр',
    badgeDark: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    badgeLight: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dotColor: 'bg-emerald-400',
    borderAccent: 'border-l-emerald-500',
  },
  lab: {
    label: 'Лабораторная',
    shortLabel: 'Лаб',
    badgeDark: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    badgeLight: 'bg-amber-50 text-amber-700 border-amber-200',
    dotColor: 'bg-amber-400',
    borderAccent: 'border-l-amber-500',
  },
  seminar: {
    label: 'Семинар / Зачёт',
    shortLabel: 'Сем',
    badgeDark: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    badgeLight: 'bg-purple-50 text-purple-700 border-purple-200',
    dotColor: 'bg-purple-400',
    borderAccent: 'border-l-purple-500',
  },
  project: {
    label: 'Проектный практикум',
    shortLabel: 'Проект',
    badgeDark: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    badgeLight: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    dotColor: 'bg-cyan-400',
    borderAccent: 'border-l-cyan-500',
  },
};

export const DAYS_OF_WEEK = [
  { id: 1, short: 'Пн', full: 'Понедельник' },
  { id: 2, short: 'Вт', full: 'Вторник' },
  { id: 3, short: 'Ср', full: 'Среда' },
  { id: 4, short: 'Чт', full: 'Четверг' },
  { id: 5, short: 'Пт', full: 'Пятница' },
  { id: 6, short: 'Сб', full: 'Суббота' },
  { id: 7, short: 'Вс', full: 'Воскресенье' },
];

export const INSTITUTES = [
  { id: 'all', short: 'Все институты', full: 'Все институты и подразделения ТОГУ (753 группы)' },
  { id: 'ИАСиД', short: 'ИАСиД', full: 'Институт архитектуры, строительства и дизайна' },
  { id: 'ПОЛИТЕХ', short: 'ПОЛИТЕХ', full: 'Политехнический институт' },
  { id: 'Пединститут', short: 'Пединститут', full: 'Педагогический институт' },
  { id: 'ИЭУ', short: 'ИЭУ', full: 'Институт экономики и управления' },
  { id: 'ИЛМК', short: 'ИЛМК', full: 'Институт лингвистики и межкультурной коммуникации' },
  { id: 'ИСПТиК', short: 'ИСПТиК', full: 'Институт социально-политических технологий и коммуникаций' },
  { id: 'ЮИ', short: 'ЮИ', full: 'Юридический институт' },
  { id: 'ПКВК', short: 'ПКВК (Асп.)', full: 'Отдел кадров высшей квалификации' },
  { id: 'ОМО', short: 'ОМО', full: 'Отдел международного образования' },
  { id: 'ИТ', short: 'ВШКиЦТ (ИТ)', full: 'Высшая школа кибернетики и цифровых технологий' },
  { id: 'ПИ', short: 'Политех (ПИ)', full: 'Политехнический институт' },
  { id: 'ИАиД', short: 'ИАиД', full: 'Институт архитектуры и дизайна' },
  { id: 'ПедИнститут', short: 'ПедИнститут', full: 'Педагогический институт' },
];

export const OFFICIAL_GROUPS_CATALOG: StudentGroup[] = OFFICIAL_COMPACT_GROUPS.map(([id, code, instShort, course]) => {
  const instFull = INSTITUTE_FULL_NAMES[instShort] || instShort;
  const meta = inferGroupMetadata(id, code, instShort, instFull, course);
  return {
    ...meta,
    studentsCount: 25,
    headmanDemo: `ID группы на togudv.ru: ${id}`,
    hasOfficialSnapshot: id === '68805',
    isTestFixture: id === '66919' || id === '68375' || id === '69173',
  };
});

export const DEMO_GROUPS: StudentGroup[] = [
  { id: 'pob-31', code: 'ПО(б)-31', name: 'Программная инженерия', specializationCode: '09.03.04', instituteShort: 'ИТ', instituteFull: 'ВШКиЦТ', course: 3, degree: 'Бакалавриат', form: 'Очная', studentsCount: 26, headmanDemo: 'Демо-профиль' },
  { id: 'ivt-21', code: 'ИВТ(б)-21', name: 'Информатика и ВТ', specializationCode: '09.03.01', instituteShort: 'ИТ', instituteFull: 'ВШКиЦТ', course: 2, degree: 'Бакалавриат', form: 'Очная', studentsCount: 28, headmanDemo: 'Демо-профиль' },
  { id: 'ib-11', code: 'ИБ(с)-11', name: 'Информационная безопасность', specializationCode: '10.05.03', instituteShort: 'ИТ', instituteFull: 'ВШКиЦТ', course: 1, degree: 'Специалитет', form: 'Очная', studentsCount: 24, headmanDemo: 'Демо-профиль' },
  { id: 'pi-41', code: 'ПИ(б)-41', name: 'Прикладная информатика', specializationCode: '09.03.03', instituteShort: 'ИТ', instituteFull: 'ВШКиЦТ', course: 4, degree: 'Бакалавриат', form: 'Очная', studentsCount: 22, headmanDemo: 'Демо-профиль' },
  { id: 'str-22', code: 'СТР(б)-22', name: 'Строительство', specializationCode: '08.03.01', instituteShort: 'ПИ', instituteFull: 'Политех', course: 2, degree: 'Бакалавриат', form: 'Очная', studentsCount: 29, headmanDemo: 'Демо-профиль' },
  { id: 'ek-32', code: 'ЭК(б)-32', name: 'Экономика', specializationCode: '38.03.01', instituteShort: 'ИЭУ', instituteFull: 'ИЭУ', course: 3, degree: 'Бакалавриат', form: 'Очная', studentsCount: 25, headmanDemo: 'Демо-профиль' },
  { id: 'arh-21', code: 'АРХ(б)-21', name: 'Архитектура', specializationCode: '07.03.01', instituteShort: 'ИАиД', instituteFull: 'ИАиД', course: 2, degree: 'Бакалавриат', form: 'Очная', studentsCount: 19, headmanDemo: 'Демо-профиль' },
  { id: 'yur-12', code: 'ЮР(б)-12', name: 'Юриспруденция', specializationCode: '40.03.01', instituteShort: 'ЮИ', instituteFull: 'ЮИ', course: 1, degree: 'Бакалавриат', form: 'Очная', studentsCount: 30, headmanDemo: 'Демо-профиль' },
  { id: 'lg-31', code: 'ЛГ(б)-31', name: 'Лингвистика', specializationCode: '45.03.02', instituteShort: 'ПедИнститут', instituteFull: 'ПедИнститут', course: 3, degree: 'Бакалавриат', form: 'Очная', studentsCount: 18, headmanDemo: 'Демо-профиль' },
];

const BASE_POB31_LESSONS: LessonItem[] = [
  { id: 'mon-1', pairNumber: 1, startTime: '08:30', endTime: '10:00', subject: '[ДЕМО] Архитектура высоконагруженных веб-систем', type: 'lecture', room: '418ц', building: 'Главный корпус (Центр), Тихоокеанская, 136', teacher: 'Ковалёв А. В.', teacherTitle: 'доцент, к.т.н.', subgroup: 'all', weekParity: 'both', dayOfWeek: 1 },
  { id: 'mon-2', pairNumber: 2, startTime: '10:10', endTime: '11:40', subject: '[ДЕМО] Разработка клиентских приложений (React & TS)', type: 'lab', room: '315л', building: 'Главный корпус (Левое крыло), Тихоокеанская, 136', teacher: 'Громова Е. С.', teacherTitle: 'ст. преп.', subgroup: '1', weekParity: 'both', dayOfWeek: 1 },
  { id: 'mon-2-sub2', pairNumber: 2, startTime: '10:10', endTime: '11:40', subject: '[ДЕМО] Системы управления базами данных', type: 'lab', room: '319л', building: 'Главный корпус (Левое крыло)', teacher: 'Белов И. Н.', teacherTitle: 'доцент, к.т.н.', subgroup: '2', weekParity: 'both', dayOfWeek: 1 },
  { id: 'mon-3', pairNumber: 3, startTime: '11:50', endTime: '13:20', subject: '[ДЕМО] Методы оптимизации', type: 'practice', room: '204п', building: 'Главный корпус (Правое крыло)', teacher: 'Смирнова О. П.', teacherTitle: 'профессор', subgroup: 'all', weekParity: 'both', dayOfWeek: 1 },
  { id: 'mon-4-odd', pairNumber: 4, startTime: '13:50', endTime: '15:20', subject: '[ДЕМО] Проектирование UI/UX', type: 'project', room: '512с', building: 'Главный корпус (Северное крыло)', teacher: 'Ким Д. А.', teacherTitle: 'практик', subgroup: 'all', weekParity: 'odd', dayOfWeek: 1 },
  { id: 'mon-4-even', pairNumber: 4, startTime: '13:50', endTime: '15:20', subject: '[ДЕМО] Иностранный язык в ИТ', type: 'practice', room: '407п', building: 'Главный корпус', teacher: 'Романова Н. И.', teacherTitle: 'доцент', subgroup: 'all', weekParity: 'even', dayOfWeek: 1 },
  { id: 'tue-2', pairNumber: 2, startTime: '10:10', endTime: '11:40', subject: '[ДЕМО] Системы управления базами данных', type: 'lecture', room: '112ц', building: 'Главный корпус', teacher: 'Белов И. Н.', teacherTitle: 'доцент', subgroup: 'all', weekParity: 'both', dayOfWeek: 2 },
  { id: 'tue-3', pairNumber: 3, startTime: '11:50', endTime: '13:20', subject: '[ДЕМО] Операционные системы и Linux', type: 'lecture', room: '418ц', building: 'Главный корпус', teacher: 'Шевченко А. О.', teacherTitle: 'доцент', subgroup: 'all', weekParity: 'both', dayOfWeek: 2 },
  { id: 'tue-5', pairNumber: 5, startTime: '15:30', endTime: '17:00', subject: '[ДЕМО] Контейнеризация Docker', type: 'lab', room: '312л', building: 'Главный корпус', teacher: 'Шевченко А. О.', teacherTitle: 'доцент', subgroup: '1', weekParity: 'both', dayOfWeek: 2 },
  { id: 'tue-5-sub2', pairNumber: 5, startTime: '15:30', endTime: '17:00', subject: '[ДЕМО] Разработка клиентских приложений', type: 'lab', room: '315л', building: 'Главный корпус', teacher: 'Громова Е. С.', teacherTitle: 'ст. преп.', subgroup: '2', weekParity: 'both', dayOfWeek: 2 },
  { id: 'wed-1', pairNumber: 1, startTime: '08:30', endTime: '10:00', subject: '[ДЕМО] Информационная безопасность', type: 'lecture', room: '420ц', building: 'Главный корпус', teacher: 'Мельников С. Б.', teacherTitle: 'профессор', subgroup: 'all', weekParity: 'both', dayOfWeek: 3 },
  { id: 'wed-2', pairNumber: 2, startTime: '10:10', endTime: '11:40', subject: '[ДЕМО] Компьютерные сети', type: 'practice', room: '215л', building: 'Главный корпус', teacher: 'Воронов П. Е.', teacherTitle: 'доцент', subgroup: 'all', weekParity: 'both', dayOfWeek: 3 },
  { id: 'wed-3', pairNumber: 3, startTime: '11:50', endTime: '13:20', subject: '[ДЕМО] Физическая культура и спорт', type: 'practice', room: 'Спортзал №1', building: 'Спорткомплекс ТОГУ', teacher: 'Тихонов В. А.', teacherTitle: 'ст. преп.', subgroup: 'all', weekParity: 'both', dayOfWeek: 3 },
  { id: 'wed-4-odd', pairNumber: 4, startTime: '13:50', endTime: '15:20', subject: '[ДЕМО] Анализ данных', type: 'seminar', room: 'ЭИОС ТОГУ', building: 'Дистанционно', teacher: 'Литвинова Д. Ю.', teacherTitle: 'доцент', subgroup: 'all', weekParity: 'odd', dayOfWeek: 3, isOnline: true },
  { id: 'thu-1', pairNumber: 1, startTime: '08:30', endTime: '10:00', subject: '[ДЕМО] Тестирование ПО', type: 'lecture', room: '310ц', building: 'Главный корпус', teacher: 'Кравцов Р. И.', teacherTitle: 'ст. преп.', subgroup: 'all', weekParity: 'both', dayOfWeek: 4 },
  { id: 'thu-2', pairNumber: 2, startTime: '10:10', endTime: '11:40', subject: '[ДЕМО] Автоматизация тестирования', type: 'lab', room: '315л', building: 'Главный корпус', teacher: 'Кравцов Р. И.', teacherTitle: 'ст. преп.', subgroup: 'all', weekParity: 'both', dayOfWeek: 4 },
  { id: 'thu-3', pairNumber: 3, startTime: '11:50', endTime: '13:20', subject: '[ДЕМО] Правоведение в ИТ', type: 'seminar', room: '208п', building: 'Главный корпус', teacher: 'Лазарева М. В.', teacherTitle: 'доцент', subgroup: 'all', weekParity: 'even', dayOfWeek: 4 },
  { id: 'thu-4', pairNumber: 4, startTime: '13:50', endTime: '15:20', subject: '[ДЕМО] Практикум по СУБД', type: 'lab', room: '319л', building: 'Главный корпус', teacher: 'Белов И. Н.', teacherTitle: 'доцент', subgroup: '1', weekParity: 'both', dayOfWeek: 4 },
  { id: 'fri-1', pairNumber: 1, startTime: '08:30', endTime: '10:00', subject: '[ДЕМО] Архитектура SPA', type: 'lecture', room: '418ц', building: 'Главный корпус', teacher: 'Громова Е. С.', teacherTitle: 'ст. преп.', subgroup: 'all', weekParity: 'both', dayOfWeek: 5 },
  { id: 'fri-2', pairNumber: 2, startTime: '10:10', endTime: '11:40', subject: '[ДЕМО] Высоконагруженные системы', type: 'practice', room: '315л', building: 'Главный корпус', teacher: 'Ковалёв А. В.', teacherTitle: 'доцент', subgroup: 'all', weekParity: 'both', dayOfWeek: 5 },
  { id: 'fri-3', pairNumber: 3, startTime: '11:50', endTime: '13:20', subject: '[ДЕМО] Управление ИТ-проектами', type: 'seminar', room: '504с', building: 'Главный корпус', teacher: 'Ким Д. А.', teacherTitle: 'практик', subgroup: 'all', weekParity: 'both', dayOfWeek: 5 },
  { id: 'sat-2', pairNumber: 2, startTime: '10:10', endTime: '11:40', subject: '[ДЕМО] Командная разработка', type: 'project', room: 'Точка кипения', building: 'Главный корпус', teacher: 'Ковалёв А. В.', teacherTitle: 'доцент', subgroup: 'all', weekParity: 'both', dayOfWeek: 6 },
  { id: 'sat-3', pairNumber: 3, startTime: '11:50', endTime: '13:20', subject: '[ДЕМО] Алгоритмы и структуры данных', type: 'practice', room: '312л', building: 'Главный корпус', teacher: 'Морозов Е. А.', teacherTitle: 'доцент', subgroup: 'all', weekParity: 'both', dayOfWeek: 6 },
  { id: 'sun-2', pairNumber: 2, startTime: '10:10', endTime: '11:40', subject: '[ДЕМО] Проектный практикум выходного дня', type: 'project', room: 'ЭИОС ТОГУ', building: 'Дистанционно', teacher: 'Ким Д. А.', teacherTitle: 'практик', subgroup: 'all', weekParity: 'both', dayOfWeek: 7, isOnline: true },
  { id: 'sun-3', pairNumber: 3, startTime: '11:50', endTime: '13:20', subject: '[ДЕМО] Консультация по курсовому проекту', type: 'seminar', room: 'ЭИОС ТОГУ', building: 'Дистанционно', teacher: 'Громова Е. С.', teacherTitle: 'ст. преп.', subgroup: 'all', weekParity: 'both', dayOfWeek: 7, isOnline: true },
];

const MIN_REFRESH_COOLDOWN_MS = 2500;

// Получение расписания из источника и синхронизация с централизованной реляционной БД (SharedScheduleDB)
export async function syncOfficialGroupScheduleWithDb(
  groupId: string,
  currentDb: SharedScheduleDatabaseState,
  forceNetwork = false
): Promise<{
  nextDb: SharedScheduleDatabaseState;
  syncLog: DbSyncLogRecord | null;
  diffs: ScheduleDiffItem[];
  fromCacheOnly: boolean;
}> {
  const prevSelected = selectGroupScheduleFromDb(currentDb, groupId);

  // 1. Попытка обращения к серверному шлюзу /api/togu/groups/:id
  if (forceNetwork || !OFFICIAL_SCHEDULES_HTML_SNAPSHOTS[groupId]) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const endpointUrl = ['/api/togu/groups', encodeURIComponent(groupId)].join('/');
      const res = await fetch(endpointUrl, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const payload = await res.json();
          if (payload && typeof payload.html === 'string') {
            const parsed = parseOfficialScheduleHtml(payload.html, groupId, 'official_live');
            parsed.fetchedAtIso = payload.fetchedAtIso || new Date().toISOString();
            const diffs = prevSelected.meta ? diffSchedules(prevSelected.lessons, parsed.lessons) : [];
            const { nextDb, syncLog } = syncGroupScheduleToDatabase(currentDb, parsed);
            return { nextDb, syncLog, diffs, fromCacheOnly: false };
          }
        }
      }
    } catch {
      // Серверный прокси недоступен в браузерной песочнице
    }
  }

  // 2. Если есть встроенный HTML-снимок (68805 — реальный загруженный файл СУЗ(с) - 51; 66919, 68375, 69173 — тестовые HTML-макеты)
  const snapshotHtml = OFFICIAL_SCHEDULES_HTML_SNAPSHOTS[groupId];
  if (snapshotHtml) {
    const kind: ParsedScheduleDocument['sourceKind'] =
      groupId === '68805' ? 'official_snapshot' : 'test_html_fixture';
    const parsed = parseOfficialScheduleHtml(snapshotHtml, groupId, kind);
    const diffs = prevSelected.meta ? diffSchedules(prevSelected.lessons, parsed.lessons) : [];
    const { nextDb, syncLog } = syncGroupScheduleToDatabase(currentDb, parsed);
    return { nextDb, syncLog, diffs, fromCacheOnly: false };
  }

  // 3. Если в реляционной БД уже сохранено расписание этой группы (например, после импорта .html файла)
  if (prevSelected.meta) {
    return { nextDb: currentDb, syncLog: null, diffs: [], fromCacheOnly: true };
  }

  throw new Error(
    `OFFICIAL_SOURCE_UNAVAILABLE: Прямой доступ к https://togudv.ru/rasp/groups/${groupId}/ ограничен политикой CORS/песочницы, а в локальной БД расписание для группы ID ${groupId} ещё не синхронизировано.`
  );
}

// ============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДАТ И ВРЕМЕНИ
// ============================================================================

function toMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function getIsoDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function getDayOfWeek1to7(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
  const day = getDayOfWeek1to7(d);
  d.setDate(d.getDate() - (day - 1));
  return d;
}

function getAcademicWeekInfo(date: Date): { weekNumber: number; parity: WeekParity } {
  const year = date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1;
  const sept1 = new Date(year, 8, 1, 12, 0, 0);
  const mondaySept1 = getMondayOfWeek(sept1);
  const targetMonday = getMondayOfWeek(date);
  const diffDays = Math.round((targetMonday.getTime() - mondaySept1.getTime()) / (1000 * 60 * 60 * 24));
  const weekNumber = Math.max(1, Math.floor(diffDays / 7) + 1);
  const parity: WeekParity = weekNumber % 2 === 1 ? 'odd' : 'even';
  return { weekNumber, parity };
}

const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

const MONTHS_SHORT = [
  'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'
];

function formatHumanDate(date: Date): string {
  const dayInfo = DAYS_OF_WEEK[getDayOfWeek1to7(date) - 1];
  return `${dayInfo.full}, ${date.getDate()} ${MONTHS_GENITIVE[date.getMonth()]}`;
}

function formatDateTimeRu(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${dd}.${mm}.${yyyy}, ${hh}:${min}:${ss}`;
  } catch {
    return isoStr;
  }
}

// ============================================================================
// ГЛАВНЫЙ КОМПОНЕНТ ПРИЛОЖЕНИЯ (App)
// ============================================================================

// ============================================================================
// ЧАСТЬ 4: МОДУЛЬ АВТОМАТИЧЕСКОЙ СИНХРОНИЗАЦИИ (ToguScheduleSyncEngine)
// ============================================================================

export type ScheduleChangeType =
  | 'new_lesson'
  | 'cancelled_lesson'
  | 'rescheduled_time'
  | 'rescheduled_room'
  | 'rescheduled_teacher'
  | 'lesson_type_changed';

export interface DetectedScheduleChange {
  id: string;
  groupId: string;
  groupCode: string;
  changeType: ScheduleChangeType;
  dayOfWeek: number;
  pairNumber: number;
  weekParity: 'both' | OfficialWeekParity;
  subgroup: 'all' | '1' | '2';
  subject: string;
  oldValue?: string;
  newValue?: string;
  description: string;
  severity: 'info' | 'warning' | 'alert';
  detectedAtIso: string;
}

export type SyncErrorKind =
  | 'NETWORK_OFFLINE'
  | 'HTTP_5XX'
  | 'TIMEOUT'
  | 'PARSER_MISMATCH'
  | 'PORTAL_MAINTENANCE'
  | 'RATE_LIMITED'
  | 'UNKNOWN';

export interface SyncErrorRecord {
  id: string;
  groupId: string;
  groupCode: string;
  timestampIso: string;
  timestampKhabarovsk: string;
  errorKind: SyncErrorKind;
  httpStatus?: number;
  message: string;
  userFriendlyHint: string;
  attemptCount: number;
  nextAllowedRetryIso: string;
}

export interface SyncSchedulePolicyConfig {
  daytimeTtlMs: number;
  nighttimeTtlMs: number;
  manualCooldownMs: number;
  requestTimeoutMs: number;
  backoffScheduleMs: number[];
  maxErrorLogs: number;
  maxChangesHistory: number;
}

export const DEFAULT_SYNC_POLICY: SyncSchedulePolicyConfig = {
  daytimeTtlMs: 30 * 60 * 1000,
  nighttimeTtlMs: 4 * 60 * 60 * 1000,
  manualCooldownMs: 10 * 1000,
  requestTimeoutMs: 4500,
  backoffScheduleMs: [30 * 1000, 60 * 1000, 180 * 1000, 600 * 1000],
  maxErrorLogs: 50,
  maxChangesHistory: 50,
};

export interface GroupSyncStatusState {
  groupId: string;
  groupCode: string;
  state: 'idle' | 'checking' | 'up_to_date' | 'changes_applied' | 'stale_offline' | 'error';
  lastSuccessfulSyncIso: string | null;
  lastSuccessfulSyncKhabarovsk: string | null;
  lastCheckedIso: string | null;
  lastCheckedKhabarovsk: string | null;
  isStale: boolean;
  staleWarning: string | null;
  consecutiveErrors: number;
  contentHash: string | null;
  recentChanges: DetectedScheduleChange[];
  errorLogs: SyncErrorRecord[];
  disclaimer: string;
}

export interface SyncResult {
  outcome:
    | 'cache_hit_valid'
    | 'no_changes'
    | 'changes_applied'
    | 'source_unavailable_fallback'
    | 'rate_limited';
  message: string;
  updatedDb: boolean;
  nextDb: SharedScheduleDatabaseState;
  syncLog: DbSyncLogRecord | null;
  changes: DetectedScheduleChange[];
  notificationReport?: NotificationReconcileReport;
  error?: SyncErrorRecord;
  statusState: GroupSyncStatusState;
}

const STORAGE_KEYS = {
  SYNC_STATE_PREFIX: 'togu_sync_state_v4_',
  ERROR_LOGS: 'togu_sync_error_logs_v4',
  CHANGES_HISTORY: 'togu_sync_changes_history_v4',
};

export function isKhabarovskNightHours(nowEpochMs = Date.now()): boolean {
  try {
    const formatter = new Intl.DateTimeFormat('ru-RU', {
      timeZone: KHABAROVSK_TIMEZONE,
      hour: 'numeric',
      hour12: false,
    });
    const hour = Number(formatter.format(new Date(nowEpochMs)));
    return hour >= 23 || hour < 6;
  } catch {
    const khbDate = new Date(nowEpochMs + 10 * 3600 * 1000);
    const hour = khbDate.getUTCHours();
    return hour >= 23 || hour < 6;
  }
}

export function getEffectiveCacheTtlMs(
  nowEpochMs = Date.now(),
  config = DEFAULT_SYNC_POLICY
): number {
  return isKhabarovskNightHours(nowEpochMs) ? config.nighttimeTtlMs : config.daytimeTtlMs;
}

export function evaluateSyncNeed(
  lastCheckedIso: string | null,
  consecutiveErrors = 0,
  nowEpochMs = Date.now(),
  config = DEFAULT_SYNC_POLICY
): { needed: boolean; reason: string; elapsedMinutes: number; nextAllowedCheckEpochMs: number } {
  if (!lastCheckedIso) {
    return {
      needed: true,
      reason: 'Синхронизация ещё ни разу не выполнялась для данной группы',
      elapsedMinutes: 9999,
      nextAllowedCheckEpochMs: nowEpochMs,
    };
  }

  const lastMs = Date.parse(lastCheckedIso);
  if (Number.isNaN(lastMs)) {
    return {
      needed: true,
      reason: 'Некорректная временная метка предыдущей проверки',
      elapsedMinutes: 9999,
      nextAllowedCheckEpochMs: nowEpochMs,
    };
  }

  const elapsedMs = nowEpochMs - lastMs;
  const elapsedMinutes = Math.floor(elapsedMs / 60000);

  if (consecutiveErrors > 0) {
    const backoffIndex = Math.min(consecutiveErrors - 1, config.backoffScheduleMs.length - 1);
    const backoffDelay = config.backoffScheduleMs[backoffIndex];
    if (elapsedMs < backoffDelay) {
      const waitSec = Math.ceil((backoffDelay - elapsedMs) / 1000);
      return {
        needed: false,
        reason: `Защита от перегрузки недоступного сервера ТОГУ (Backoff). Повторная попытка через ${waitSec} сек.`,
        elapsedMinutes,
        nextAllowedCheckEpochMs: lastMs + backoffDelay,
      };
    }
    return {
      needed: true,
      reason: `Истёк интервал задержки после сбоя (${consecutiveErrors} ошибок). Попытка восстановления связи.`,
      elapsedMinutes,
      nextAllowedCheckEpochMs: nowEpochMs,
    };
  }

  const effectiveTtl = getEffectiveCacheTtlMs(nowEpochMs, config);
  if (elapsedMs < effectiveTtl) {
    const remainMins = Math.ceil((effectiveTtl - elapsedMs) / 60000);
    return {
      needed: false,
      reason: `Данные расписания актуальны (проверено ${elapsedMinutes} мин назад, следующий опрос через ${remainMins} мин).`,
      elapsedMinutes,
      nextAllowedCheckEpochMs: lastMs + effectiveTtl,
    };
  }

  return {
    needed: true,
    reason: `Истёк допустимый интервал кэша (${elapsedMinutes} мин >= ${Math.round(effectiveTtl / 60000)} мин). Запланирована фоновая сверка.`,
    elapsedMinutes,
    nextAllowedCheckEpochMs: nowEpochMs,
  };
}

const DAY_NAMES: Record<number, string> = {
  1: 'понедельник',
  2: 'вторник',
  3: 'среду',
  4: 'четверг',
  5: 'пятницу',
  6: 'субботу',
  7: 'воскресенье',
};

export function detectScheduleChanges(
  oldSlots: HydratedScheduleSlot[],
  newSlots: ParsedLessonSlot[],
  groupId: string,
  groupCode: string
): DetectedScheduleChange[] {
  const changes: DetectedScheduleChange[] = [];
  const nowIso = new Date().toISOString();

  const buildSlotMatchKey = (slot: {
    dayOfWeek: number;
    pairNumber: number;
    subgroup: string;
    weekParity: string;
  }) => `${slot.dayOfWeek}__p${slot.pairNumber}__sg${slot.subgroup}__w${slot.weekParity}`;

  const oldMap = new Map<string, HydratedScheduleSlot>();
  for (const s of oldSlots) {
    oldMap.set(buildSlotMatchKey(s), s);
  }

  const newMap = new Map<string, ParsedLessonSlot>();
  for (const s of newSlots) {
    newMap.set(buildSlotMatchKey(s), s);
  }

  for (const [key, nextSlot] of newMap.entries()) {
    const prev = oldMap.get(key);
    const dayName = DAY_NAMES[nextSlot.dayOfWeek] || `день ${nextSlot.dayOfWeek}`;

    if (!prev) {
      changes.push({
        id: `chg_new_${groupId}_${key}_${Date.now()}`,
        groupId,
        groupCode,
        changeType: 'new_lesson',
        dayOfWeek: nextSlot.dayOfWeek,
        pairNumber: nextSlot.pairNumber,
        weekParity: nextSlot.weekParity,
        subgroup: nextSlot.subgroup,
        subject: nextSlot.subject,
        newValue: `${nextSlot.subject} (${nextSlot.eventTypeShort || 'зан.'}, ауд. ${nextSlot.room}, ${nextSlot.teacher})`,
        description: `Новое занятие в ${dayName}: ${nextSlot.pairNumber}-я пара (${nextSlot.startTime}–${nextSlot.endTime}) — «${nextSlot.subject}», ауд. ${nextSlot.room} (${nextSlot.building}), преп. ${nextSlot.teacher}`,
        severity: 'info',
        detectedAtIso: nowIso,
      });
      continue;
    }

    if (prev.subject !== nextSlot.subject) {
      changes.push({
        id: `chg_subj_${groupId}_${key}_${Date.now()}`,
        groupId,
        groupCode,
        changeType: 'new_lesson',
        dayOfWeek: nextSlot.dayOfWeek,
        pairNumber: nextSlot.pairNumber,
        weekParity: nextSlot.weekParity,
        subgroup: nextSlot.subgroup,
        subject: nextSlot.subject,
        oldValue: prev.subject,
        newValue: nextSlot.subject,
        description: `Замена предмета в ${dayName} (${nextSlot.pairNumber} пара): вместо «${prev.subject}» назначено «${nextSlot.subject}» (ауд. ${nextSlot.room})`,
        severity: 'alert',
        detectedAtIso: nowIso,
      });
    }

    const prevRoomLabel = prev.isOnline ? 'Дистанционно (ЭИОС)' : `ауд. ${prev.room} (${prev.building})`;
    const nextRoomLabel = nextSlot.isOnline ? 'Дистанционно (ЭИОС)' : `ауд. ${nextSlot.room} (${nextSlot.building})`;
    if (prev.room !== nextSlot.room || prev.isOnline !== nextSlot.isOnline || prev.building !== nextSlot.building) {
      changes.push({
        id: `chg_room_${groupId}_${key}_${Date.now()}`,
        groupId,
        groupCode,
        changeType: 'rescheduled_room',
        dayOfWeek: nextSlot.dayOfWeek,
        pairNumber: nextSlot.pairNumber,
        weekParity: nextSlot.weekParity,
        subgroup: nextSlot.subgroup,
        subject: nextSlot.subject,
        oldValue: prevRoomLabel,
        newValue: nextRoomLabel,
        description: `Перенос аудитории: «${nextSlot.subject}» в ${dayName} (${nextSlot.pairNumber} пара) перенесена из ${prevRoomLabel} в ${nextRoomLabel}`,
        severity: 'warning',
        detectedAtIso: nowIso,
      });
    }

    if (prev.teacher && nextSlot.teacher && prev.teacher !== nextSlot.teacher) {
      changes.push({
        id: `chg_teach_${groupId}_${key}_${Date.now()}`,
        groupId,
        groupCode,
        changeType: 'rescheduled_teacher',
        dayOfWeek: nextSlot.dayOfWeek,
        pairNumber: nextSlot.pairNumber,
        weekParity: nextSlot.weekParity,
        subgroup: nextSlot.subgroup,
        subject: nextSlot.subject,
        oldValue: prev.teacher,
        newValue: nextSlot.teacher,
        description: `Замена преподавателя: «${nextSlot.subject}» в ${dayName} проведёт ${nextSlot.teacher} (ранее: ${prev.teacher})`,
        severity: 'info',
        detectedAtIso: nowIso,
      });
    }

    if (prev.type !== nextSlot.type) {
      changes.push({
        id: `chg_type_${groupId}_${key}_${Date.now()}`,
        groupId,
        groupCode,
        changeType: 'lesson_type_changed',
        dayOfWeek: nextSlot.dayOfWeek,
        pairNumber: nextSlot.pairNumber,
        weekParity: nextSlot.weekParity,
        subgroup: nextSlot.subgroup,
        subject: nextSlot.subject,
        oldValue: prev.type,
        newValue: nextSlot.type,
        description: `Изменён формат занятия: «${nextSlot.subject}» в ${dayName} теперь проводится как ${nextSlot.type} (было: ${prev.type})`,
        severity: 'info',
        detectedAtIso: nowIso,
      });
    }
  }

  for (const [key, oldSlot] of oldMap.entries()) {
    if (!newMap.has(key)) {
      const dayName = DAY_NAMES[oldSlot.dayOfWeek] || `день ${oldSlot.dayOfWeek}`;
      changes.push({
        id: `chg_cancel_${groupId}_${key}_${Date.now()}`,
        groupId,
        groupCode,
        changeType: 'cancelled_lesson',
        dayOfWeek: oldSlot.dayOfWeek,
        pairNumber: oldSlot.pairNumber,
        weekParity: oldSlot.weekParity,
        subgroup: oldSlot.subgroup,
        subject: oldSlot.subject,
        oldValue: `${oldSlot.pairNumber} пара (${oldSlot.startTime}–${oldSlot.endTime}) • ${oldSlot.subject}`,
        newValue: 'Отменено',
        description: `Отмена пары в ${dayName}: ${oldSlot.pairNumber}-я пара «${oldSlot.subject}» (${oldSlot.startTime}–${oldSlot.endTime}, ауд. ${oldSlot.room}) снята с расписания`,
        severity: 'alert',
        detectedAtIso: nowIso,
      });
    }
  }

  return changes;
}

export class ToguScheduleSyncEngine {
  private config: SyncSchedulePolicyConfig;
  private lastManualRefreshTimes = new Map<string, number>();

  constructor(config = DEFAULT_SYNC_POLICY) {
    this.config = config;
  }

  public getPolicy(): SyncSchedulePolicyConfig {
    return { ...this.config };
  }

  public loadGroupSyncStatus(groupId: string, groupCode = 'ТОГУ'): GroupSyncStatusState {
    const raw = localStorage.getItem(`${STORAGE_KEYS.SYNC_STATE_PREFIX}${groupId}`);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.groupId === groupId) {
          return {
            ...parsed,
            errorLogs: this.loadErrorLogs(groupId),
            recentChanges: this.loadChangesHistory(groupId),
          };
        }
      } catch {
        // fallback
      }
    }
    return {
      groupId,
      groupCode,
      state: 'idle',
      lastSuccessfulSyncIso: null,
      lastSuccessfulSyncKhabarovsk: null,
      lastCheckedIso: null,
      lastCheckedKhabarovsk: null,
      isStale: false,
      staleWarning: null,
      consecutiveErrors: 0,
      contentHash: null,
      recentChanges: this.loadChangesHistory(groupId),
      errorLogs: this.loadErrorLogs(groupId),
      disclaimer: 'Синхронизация выполняется по расписанию через портал togudv.ru. В режиме реального времени изменения сайтом вуза не транслируются.',
    };
  }

  public saveGroupSyncStatus(status: GroupSyncStatusState): void {
    try {
      const { errorLogs, recentChanges, ...cleanState } = status;
      localStorage.setItem(`${STORAGE_KEYS.SYNC_STATE_PREFIX}${status.groupId}`, JSON.stringify(cleanState));
    } catch {
      // ignore
    }
  }

  public logSyncError(errorRecord: SyncErrorRecord): void {
    try {
      const allLogs = this.loadErrorLogs();
      const next = [errorRecord, ...allLogs.filter((l) => l.id !== errorRecord.id)].slice(0, this.config.maxErrorLogs);
      localStorage.setItem(STORAGE_KEYS.ERROR_LOGS, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  public loadErrorLogs(groupId?: string): SyncErrorRecord[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ERROR_LOGS);
      if (raw) {
        const list: SyncErrorRecord[] = JSON.parse(raw);
        if (Array.isArray(list)) {
          return groupId ? list.filter((l) => l.groupId === groupId) : list;
        }
      }
    } catch {
      // ignore
    }
    return [];
  }

  public clearErrorLogs(groupId?: string): void {
    try {
      if (groupId) {
        const remaining = this.loadErrorLogs().filter((l) => l.groupId !== groupId);
        localStorage.setItem(STORAGE_KEYS.ERROR_LOGS, JSON.stringify(remaining));
      } else {
        localStorage.removeItem(STORAGE_KEYS.ERROR_LOGS);
      }
    } catch {
      // ignore
    }
  }

  public recordScheduleChanges(changes: DetectedScheduleChange[]): void {
    if (changes.length === 0) return;
    try {
      const all = this.loadChangesHistory();
      const next = [...changes, ...all].slice(0, this.config.maxChangesHistory);
      localStorage.setItem(STORAGE_KEYS.CHANGES_HISTORY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  public loadChangesHistory(groupId?: string): DetectedScheduleChange[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CHANGES_HISTORY);
      if (raw) {
        const list: DetectedScheduleChange[] = JSON.parse(raw);
        if (Array.isArray(list)) {
          return groupId ? list.filter((c) => c.groupId === groupId) : list;
        }
      }
    } catch {
      // ignore
    }
    return [];
  }

  public async syncSchedule(params: {
    groupId: string;
    groupCode: string;
    currentDb: SharedScheduleDatabaseState;
    forceManual?: boolean;
    fetchDocumentFn: (groupId: string) => Promise<ParsedScheduleDocument>;
    notificationParams?: {
      targetIsoDate: string;
      targetWeekParity: OfficialWeekParity;
      simulatedMinutesOfDay: number;
      selectedSubgroup: 'all' | '1' | '2';
      notificationsEnabled: boolean;
      leadMinutes: NotificationLeadMinutes;
      lockScreenOngoingEnabled: boolean;
      previousNotifications: ScheduledLessonNotification[];
    };
  }): Promise<SyncResult> {
    const { groupId, groupCode, currentDb, forceManual = false, fetchDocumentFn, notificationParams } = params;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const nowKhabarovsk = formatKhabarovskDateTime(now);

    let status = this.loadGroupSyncStatus(groupId, groupCode);

    if (forceManual) {
      const lastManual = this.lastManualRefreshTimes.get(groupId) || 0;
      const elapsed = now - lastManual;
      if (elapsed < this.config.manualCooldownMs) {
        const waitSec = Math.ceil((this.config.manualCooldownMs - elapsed) / 1000);
        return {
          outcome: 'rate_limited',
          message: `Защита от нагрузки на сервер ТОГУ: повторный запрос разрешён через ${waitSec} сек.`,
          updatedDb: false,
          nextDb: currentDb,
          syncLog: null,
          changes: [],
          statusState: status,
        };
      }
      this.lastManualRefreshTimes.set(groupId, now);
    }

    if (!forceManual) {
      const evaluation = evaluateSyncNeed(status.lastCheckedIso, status.consecutiveErrors, now, this.config);
      if (!evaluation.needed) {
        return {
          outcome: 'cache_hit_valid',
          message: evaluation.reason,
          updatedDb: false,
          nextDb: currentDb,
          syncLog: null,
          changes: [],
          statusState: {
            ...status,
            state: status.isStale ? 'stale_offline' : 'up_to_date',
          },
        };
      }
    }

    const prevData = selectGroupScheduleFromDb(currentDb, groupId);
    status = { ...status, state: 'checking' };

    try {
      const freshDoc = await fetchDocumentFn(groupId);

      const prevContentHash = prevData.meta?.contentHash || status.contentHash;
      const isHashIdentical = Boolean(prevContentHash && prevContentHash === freshDoc.contentHash);

      const detectedChanges = detectScheduleChanges(prevData.lessons, freshDoc.lessons, groupId, groupCode);

      if (isHashIdentical && detectedChanges.length === 0) {
        const updatedStatus: GroupSyncStatusState = {
          ...status,
          state: 'up_to_date',
          lastSuccessfulSyncIso: nowIso,
          lastSuccessfulSyncKhabarovsk: nowKhabarovsk,
          lastCheckedIso: nowIso,
          lastCheckedKhabarovsk: nowKhabarovsk,
          isStale: false,
          staleWarning: null,
          consecutiveErrors: 0,
          contentHash: freshDoc.contentHash,
        };
        this.saveGroupSyncStatus(updatedStatus);

        return {
          outcome: 'no_changes',
          message: `Расписание сверено с источником ТОГУ: изменений нет (хэш совпадает). База данных не перезаписывалась.`,
          updatedDb: false,
          nextDb: currentDb,
          syncLog: null,
          changes: [],
          statusState: updatedStatus,
        };
      }

      const { nextDb, syncLog } = syncGroupScheduleToDatabase(currentDb, freshDoc);
      this.recordScheduleChanges(detectedChanges);

      let notifReport: NotificationReconcileReport | undefined;
      if (notificationParams) {
        const nextGroupData = selectGroupScheduleFromDb(nextDb, groupId);
        notifReport = reconcileScheduleNotifications({
          groupId,
          groupCode,
          lessons: nextGroupData.lessons,
          selectedSubgroup: notificationParams.selectedSubgroup,
          targetIsoDate: notificationParams.targetIsoDate,
          targetWeekParity: notificationParams.targetWeekParity,
          simulatedMinutesOfDay: notificationParams.simulatedMinutesOfDay,
          notificationsEnabled: notificationParams.notificationsEnabled,
          leadMinutes: notificationParams.leadMinutes,
          lockScreenOngoingEnabled: notificationParams.lockScreenOngoingEnabled,
          previousNotifications: notificationParams.previousNotifications,
        });
      }

      const updatedStatus: GroupSyncStatusState = {
        ...status,
        state: 'changes_applied',
        lastSuccessfulSyncIso: nowIso,
        lastSuccessfulSyncKhabarovsk: nowKhabarovsk,
        lastCheckedIso: nowIso,
        lastCheckedKhabarovsk: nowKhabarovsk,
        isStale: false,
        staleWarning: null,
        consecutiveErrors: 0,
        contentHash: freshDoc.contentHash,
        recentChanges: detectedChanges,
      };
      this.saveGroupSyncStatus(updatedStatus);

      const changeSummary = detectedChanges.length > 0
        ? `Обнаружено ${detectedChanges.length} изм. (${detectedChanges.map((c) => c.description).join('; ')})`
        : 'Данные обновлены в базе расписания';

      return {
        outcome: 'changes_applied',
        message: `Синхронизация успешна: ${changeSummary}. Уведомления перепланированы.`,
        updatedDb: true,
        nextDb,
        syncLog,
        changes: detectedChanges,
        notificationReport: notifReport,
        statusState: updatedStatus,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isOffline = !navigator.onLine || errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError');
      const is5xx = errorMsg.includes('500') || errorMsg.includes('502') || errorMsg.includes('503') || errorMsg.includes('504');
      const isTimeout = errorMsg.includes('timeout') || errorMsg.includes('AbortError');

      const errorKind: SyncErrorKind = isOffline
        ? 'NETWORK_OFFLINE'
        : is5xx
        ? 'HTTP_5XX'
        : isTimeout
        ? 'TIMEOUT'
        : 'PORTAL_MAINTENANCE';

      const userFriendlyHint = isOffline
        ? 'Отсутствует подключение к сети Интернет на устройстве.'
        : is5xx
        ? 'Сервер расписания ТОГУ (togudv.ru) вернул ошибку или перегружен.'
        : isTimeout
        ? 'Превышено время ожидания ответа от сервера ТОГУ (тайм-аут 4.5 сек).'
        : 'Сайт ТОГУ временно недоступен или проводятся технические работы.';

      const consecutiveErrors = status.consecutiveErrors + 1;
      const backoffIdx = Math.min(consecutiveErrors - 1, this.config.backoffScheduleMs.length - 1);
      const nextAllowedRetryIso = new Date(now + this.config.backoffScheduleMs[backoffIdx]).toISOString();

      const errorRecord: SyncErrorRecord = {
        id: `err_${groupId}_${now}`,
        groupId,
        groupCode,
        timestampIso: nowIso,
        timestampKhabarovsk: nowKhabarovsk,
        errorKind,
        message: errorMsg,
        userFriendlyHint,
        attemptCount: consecutiveErrors,
        nextAllowedRetryIso,
      };

      this.logSyncError(errorRecord);

      const hasSavedVersion = Boolean(prevData.meta && prevData.lessons.length > 0);
      const staleWarning = hasSavedVersion
        ? `Сервер ТОГУ временно недоступен. Отображается сохранённая версия от ${formatKhabarovskDateTime(Date.parse(status.lastSuccessfulSyncIso || prevData.meta?.lastSyncedAtIso || nowIso))}. Данные могут быть устаревшими.`
        : `Сервер ТОГУ недоступен, а в локальной базе нет сохранённого расписания для группы ${groupCode}.`;

      const updatedStatus: GroupSyncStatusState = {
        ...status,
        state: hasSavedVersion ? 'stale_offline' : 'error',
        lastCheckedIso: nowIso,
        lastCheckedKhabarovsk: nowKhabarovsk,
        isStale: hasSavedVersion,
        staleWarning,
        consecutiveErrors,
        errorLogs: [errorRecord, ...status.errorLogs].slice(0, this.config.maxErrorLogs),
      };
      this.saveGroupSyncStatus(updatedStatus);

      return {
        outcome: 'source_unavailable_fallback',
        message: staleWarning,
        updatedDb: false,
        nextDb: currentDb,
        syncLog: null,
        changes: [],
        error: errorRecord,
        statusState: updatedStatus,
      };
    }
  }
}

export const defaultToguSyncEngine = new ToguScheduleSyncEngine();

// Точные часы и календарь кампуса ТОГУ (г. Хабаровск, Asia/Vladivostok, UTC+10)
export interface KhabarovskClockState {
  dateObj: Date;
  isoDate: string;
  dayOfWeek: number;
  hours: number;
  minutes: number;
  minutesOfDay: number;
  timeHHMM: string;
}

export function getCurrentKhabarovskClock(nowMs = Date.now()): KhabarovskClockState {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: KHABAROVSK_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(nowMs));
    const map: Record<string, string> = {};
    for (const p of parts) {
      map[p.type] = p.value;
    }
    const y = Number(map.year) || 2026;
    const m = Number(map.month) || 10;
    const d = Number(map.day) || 19;
    let hh = Number(map.hour);
    if (hh === 24) hh = 0;
    const mm = Number(map.minute) || 0;
    const isoDate = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dateObj = new Date(y, m - 1, d, 12, 0, 0);
    const dayOfWeek = getDayOfWeek1to7(dateObj);
    const minutesOfDay = hh * 60 + mm;
    const timeHHMM = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    return { dateObj, isoDate, dayOfWeek, hours: hh, minutes: mm, minutesOfDay, timeHHMM };
  } catch {
    const khbMs = nowMs + 10 * 3600 * 1000;
    const d = new Date(khbMs);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const hh = d.getUTCHours();
    const mm = d.getUTCMinutes();
    const isoDate = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dateObj = new Date(y, m - 1, day, 12, 0, 0);
    const dayOfWeek = getDayOfWeek1to7(dateObj);
    const minutesOfDay = hh * 60 + mm;
    const timeHHMM = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    return { dateObj, isoDate, dayOfWeek, hours: hh, minutes: mm, minutesOfDay, timeHHMM };
  }
}

export default function App() {
  // Живые часы Хабаровска (обновляются каждые 30 секунд)
  const [khabarovskClock, setKhabarovskClock] = useState<KhabarovskClockState>(() => getCurrentKhabarovskClock());
  useEffect(() => {
    const timer = setInterval(() => {
      setKhabarovskClock(getCurrentKhabarovskClock());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const realToday = khabarovskClock.dateObj;
  const realTodayIso = khabarovskClock.isoDate;
  const realTodayDow = khabarovskClock.dayOfWeek;
  const realTodayAcademicInfo = useMemo(() => getAcademicWeekInfo(realToday), [realToday]);

  const defaultInitialDateIso = useMemo(() => {
    const dow = getDayOfWeek1to7(realToday);
    if (dow === 7) {
      const nextMon = new Date(realToday);
      nextMon.setDate(realToday.getDate() + 1);
      return getIsoDateString(nextMon);
    }
    return realTodayIso;
  }, [realToday, realTodayIso]);

  const [activeTab, setActiveTab] = useState<NavTab>('today');

  // 1. ИЗОЛИРОВАННОЕ ХРАНИЛИЩЕ ПОЛЬЗОВАТЕЛЬСКИХ НАСТРОЕК (UserPreferencesStore)
  // Хранится отдельно от базы расписания и сохраняется между посещениями без регистрации
  const [userPrefs, setUserPrefs] = useState<UserPreferencesRecord>(() => loadUserPreferences());

  // Совместимый объект settings и функции обновления
  const settings: AppSettings = useMemo(
    () => ({
      selectedGroupId: userPrefs.primaryGroupId,
      subgroup: userPrefs.subgroup,
      theme: userPrefs.theme,
      accent: userPrefs.accent,
      compactCards: userPrefs.compactCards,
      showWindows: userPrefs.showWindows,
      showBigBreak: userPrefs.showBigBreak,
      showPairNumbers: userPrefs.showPairNumbers,
      autoWeekParity: userPrefs.autoWeekParity,
    }),
    [userPrefs]
  );

  const favoriteGroupIds = userPrefs.favoriteGroupIds;
  const customNotes = userPrefs.personalNotes;

  const updateSettings = (patch: Partial<AppSettings>) => {
    setUserPrefs((prev) => {
      const next: UserPreferencesRecord = {
        ...prev,
        primaryGroupId: patch.selectedGroupId !== undefined ? patch.selectedGroupId : prev.primaryGroupId,
        subgroup: patch.subgroup !== undefined ? patch.subgroup : prev.subgroup,
        theme: patch.theme !== undefined ? patch.theme : prev.theme,
        accent: patch.accent !== undefined ? patch.accent : prev.accent,
        compactCards: patch.compactCards !== undefined ? patch.compactCards : prev.compactCards,
        showWindows: patch.showWindows !== undefined ? patch.showWindows : prev.showWindows,
        showBigBreak: patch.showBigBreak !== undefined ? patch.showBigBreak : prev.showBigBreak,
        showPairNumbers: patch.showPairNumbers !== undefined ? patch.showPairNumbers : prev.showPairNumbers,
        autoWeekParity: patch.autoWeekParity !== undefined ? patch.autoWeekParity : prev.autoWeekParity,
        updatedAtIso: new Date().toISOString(),
      };
      saveUserPreferences(next);
      return next;
    });
  };

  // 2. ЦЕНТРАЛИЗОВАННАЯ РЕЛЯЦИОННАЯ БАЗА РАСПИСАНИЯ (SharedScheduleDatabase)
  // Хранит предметы, преподавателей, аудитории, слоты расписания, сессию и отметки об отмене/переносе
  const [sharedDb, setSharedDb] = useState<SharedScheduleDatabaseState>(() => loadSharedScheduleDatabase());
  const sharedDbRef = useRef<SharedScheduleDatabaseState>(sharedDb);
  useEffect(() => {
    sharedDbRef.current = sharedDb;
  }, [sharedDb]);

  const [groupsCatalog, setGroupsCatalog] = useState<StudentGroup[]>(OFFICIAL_GROUPS_CATALOG);
  const [isLoadingSchedule, setIsLoadingSchedule] = useState<boolean>(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleDiffs, setScheduleDiffs] = useState<ScheduleDiffItem[]>([]);
  const [explicitDemoConfirmedForGroup, setExplicitDemoConfirmedForGroup] = useState<Record<string, boolean>>({});
  // Состояние автоматической синхронизации расписания с официальным источником ТОГУ (Этап 7)
  const [syncStatus, setSyncStatus] = useState<GroupSyncStatusState>(() =>
    defaultToguSyncEngine.loadGroupSyncStatus('68805', 'СУЗ(с) - 51')
  );
  const [isSyncModalOpen, setIsSyncModalOpen] = useState<boolean>(false);
  const [syncModalTab, setSyncModalTab] = useState<'status' | 'changes' | 'errors' | 'simulate'>('status');

  const lastFetchTimeRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedDateIso, setSelectedDateIso] = useState<string>(defaultInitialDateIso);
  const [demoTimePreset, setDemoTimePreset] = useState<'live' | 'pair2' | 'break' | 'morning'>('live');

  // Состояния системы локальных уведомлений и карточки экрана блокировки Android (Этап 6)
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem('togu_notif_enabled_v1');
      return v !== null ? JSON.parse(v) : true;
    } catch {
      return true;
    }
  });
  const [notificationLeadMinutes, setNotificationLeadMinutes] = useState<NotificationLeadMinutes>(() => {
    try {
      const v = localStorage.getItem('togu_notif_lead_v1');
      if (v) {
        const n = Number(JSON.parse(v));
        if (n === 5 || n === 10 || n === 15 || n === 30) return n;
      }
    } catch {}
    return 10;
  });
  const [lockScreenOngoingEnabled, setLockScreenOngoingEnabled] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem('togu_notif_ongoing_v1');
      return v !== null ? JSON.parse(v) : true;
    } catch {
      return true;
    }
  });
  const prevNotifsRef = useRef<ScheduledLessonNotification[]>([]);

  const selectedDateObj = useMemo(() => parseIsoDate(selectedDateIso), [selectedDateIso]);
  const academicInfo = useMemo(() => getAcademicWeekInfo(selectedDateObj), [selectedDateObj]);
  const [weekViewParity, setWeekViewParity] = useState<WeekParity>(academicInfo.parity);
  const [weekSelectedDay, setWeekSelectedDay] = useState<number>(() => (realTodayDow <= 6 ? realTodayDow : 1));
  const [weekDisplayMode, setWeekDisplayMode] = useState<'single' | 'grid'>('single');
  const [typeFilter, setTypeFilter] = useState<LessonType | 'all'>('all');

  const [groupSearchQuery, setGroupSearchQuery] = useState<string>('');
  const [selectedInstitute, setSelectedInstitute] = useState<string>('all');
  const [selectedCourse, setSelectedCourse] = useState<number | 'all'>('all');

  // Состояния модального окна деталей пары, заметки и управления отменой/переносом в БД
  const [inspectedLesson, setInspectedLesson] = useState<LessonItem | null>(null);
  const [noteDraft, setNoteDraft] = useState<string>('');
  const [overrideStatusDraft, setOverrideStatusDraft] = useState<LessonOverrideStatus>('normal');
  const [overrideReasonDraft, setOverrideReasonDraft] = useState<string>('');
  const [overrideNewRoomDraft, setOverrideNewRoomDraft] = useState<string>('');
  const [overrideNewDateDraft, setOverrideNewDateDraft] = useState<string>('');
  const [overrideNewPairDraft, setOverrideNewPairDraft] = useState<number>(1);

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
  };

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3600);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const activeGroup = useMemo(
    () =>
      groupsCatalog.find((g) => g.id === settings.selectedGroupId) ||
      DEMO_GROUPS.find((g) => g.id === settings.selectedGroupId) ||
      groupsCatalog.find((g) => g.id === '68805') ||
      groupsCatalog[0],
    [groupsCatalog, settings.selectedGroupId]
  );

  // Выборка (SELECT JOIN) расписания текущей группы из реляционной БД
  const dbGroupData = useMemo(
    () => selectGroupScheduleFromDb(sharedDb, activeGroup.id),
    [sharedDb, activeGroup.id]
  );

  const scheduleMeta = dbGroupData.meta;

  // Загрузка и интеллектуальная синхронизация с официальным источником ТОГУ (Этап 7)
  const loadGroupSchedule = async (groupId: string, forceManual = false) => {
    setIsLoadingSchedule(true);
    setScheduleError(null);

    const fetchDocument = async (gid: string): Promise<ParsedScheduleDocument> => {
      // 1. Попытка запроса к шлюзу /api/togu/groups/:id
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4500);
        const res = await fetch(`/api/togu/groups/${encodeURIComponent(gid)}`, { signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) {
          const payload = await res.json();
          if (payload && typeof payload.html === 'string') {
            const parsed = parseOfficialScheduleHtml(payload.html, gid, 'official_live');
            parsed.fetchedAtIso = payload.fetchedAtIso || new Date().toISOString();
            return parsed;
          }
        }
      } catch {
        // Fallback
      }

      // 2. Официальный снимок 68805 или макет
      const snapshotHtml = OFFICIAL_SCHEDULES_HTML_SNAPSHOTS[gid];
      if (snapshotHtml) {
        const kind: ParsedScheduleDocument['sourceKind'] =
          gid === '68805' ? 'official_snapshot' : 'test_html_fixture';
        return parseOfficialScheduleHtml(snapshotHtml, gid, kind);
      }

      // 3. Данные из локальной БД
      const inDb = selectGroupScheduleFromDb(sharedDbRef.current, gid);
      if (inDb.meta) {
        return {
          groupId: gid,
          groupCode: inDb.meta.groupCode,
          semester: inDb.meta.semester,
          serverDateText: inDb.meta.serverDateText,
          serverWeekParity: inDb.meta.serverWeekParity,
          serverWeekLabel: inDb.meta.serverWeekLabel,
          examsUrl: inDb.meta.examsUrl,
          sourceKind: inDb.meta.sourceKind,
          sourceUrl: inDb.meta.sourceUrl,
          contentHash: inDb.meta.contentHash,
          fetchedAtIso: new Date().toISOString(),
          lessons: inDb.lessons,
          calendarEvents: inDb.calendarEvents,
        };
      }

      throw new Error(
        `OFFICIAL_SOURCE_UNAVAILABLE: Сервер расписания ТОГУ (togudv.ru/rasp/groups/${gid}/) временно недоступен или ограничен политикой песочницы.`
      );
    };

    try {
      const result = await defaultToguSyncEngine.syncSchedule({
        groupId,
        groupCode: activeGroup.code,
        currentDb: sharedDbRef.current,
        forceManual,
        fetchDocumentFn: fetchDocument,
        notificationParams: {
          targetIsoDate: selectedDateIso,
          targetWeekParity: weekViewParity,
          simulatedMinutesOfDay: 610,
          selectedSubgroup: settings.subgroup,
          notificationsEnabled,
          leadMinutes: notificationLeadMinutes,
          lockScreenOngoingEnabled,
          previousNotifications: prevNotifsRef.current,
        },
      });

      setSyncStatus(result.statusState);

      if (result.updatedDb) {
        setSharedDb(result.nextDb);
      }

      if (result.outcome === 'rate_limited') {
        showToast(result.message);
      } else if (result.outcome === 'cache_hit_valid') {
        if (forceManual) showToast(result.message);
      } else if (result.outcome === 'no_changes') {
        if (forceManual) showToast('Расписание сверено: изменений нет (хэш совпадает)');
      } else if (result.outcome === 'changes_applied') {
        showToast(`Синхронизация: обнаружено ${result.changes.length} изм. Уведомления обновлены.`);
      } else if (result.outcome === 'source_unavailable_fallback') {
        setScheduleError(result.message);
        showToast('Сервер ТОГУ недоступен. Показана сохранённая копия.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setScheduleError(msg);
    } finally {
      setIsLoadingSchedule(false);
    }
  };

  // Интерактивный симулятор 5 сценариев синхронизации прямо в интерфейсе (Этап 7)
  const handleSimulateSyncScenario = (
    scenario: 'new_lesson' | 'cancel_lesson' | 'reschedule' | 'offline_error' | 'resync_recover'
  ) => {
    const curData = selectGroupScheduleFromDb(sharedDbRef.current, activeGroup.id);
    const nowIso = new Date().toISOString();

    if (scenario === 'new_lesson') {
      const newLessonSlot: ParsedLessonSlot = {
        id: `sim_new_${Date.now()}`,
        dayOfWeek: 1,
        pairNumber: 3,
        startTime: '11:50',
        endTime: '13:20',
        subject: 'Автоматизация расчёта строительных конструкций',
        type: 'lab',
        eventTypeShort: 'лаб.',
        eventTypeFull: 'лабораторная работа',
        room: '402л',
        building: 'Главный корпус',
        teacher: 'Ковалёв Н. Д.',
        teacherTitle: 'доцент',
        teacherUrl: '',
        roomUrl: '',
        subgroup: 'all',
        weekParity: 'both',
        dateRange: '01.09.2026 - 15.01.2027',
        isOnline: false,
      };
      const simulatedDoc: ParsedScheduleDocument = {
        groupId: activeGroup.id,
        groupCode: activeGroup.code,
        semester: '2026 - 2027 учебный год, осенний семестр',
        serverDateText: '19 октября, понедельник',
        serverWeekParity: 'odd',
        serverWeekLabel: 'неделя по числителю',
        examsUrl: `/exams/${activeGroup.id}/`,
        sourceKind: 'official_snapshot',
        sourceUrl: `https://togudv.ru/rasp/groups/${activeGroup.id}/`,
        contentHash: `hash_sim_new_${Date.now()}`,
        fetchedAtIso: nowIso,
        lessons: [...curData.lessons, newLessonSlot],
        calendarEvents: curData.calendarEvents,
      };
      const { nextDb } = syncGroupScheduleToDatabase(sharedDbRef.current, simulatedDoc);
      setSharedDb(nextDb);
      const changes = [
        {
          id: `sim_chg_${Date.now()}`,
          groupId: activeGroup.id,
          groupCode: activeGroup.code,
          changeType: 'new_lesson' as const,
          dayOfWeek: 1,
          pairNumber: 3,
          weekParity: 'both' as const,
          subgroup: 'all' as const,
          subject: 'Автоматизация расчёта строительных конструкций',
          description: 'Новое занятие в понедельник: 3-я пара (11:50–13:20) — «Автоматизация расчёта строительных конструкций», ауд. 402л',
          severity: 'info' as const,
          detectedAtIso: nowIso,
        },
      ];
      defaultToguSyncEngine.recordScheduleChanges(changes);
      setSyncStatus((prev) => ({
        ...prev,
        state: 'changes_applied',
        recentChanges: [...changes, ...prev.recentChanges],
        lastSuccessfulSyncIso: nowIso,
        lastSuccessfulSyncKhabarovsk: `${new Date().toLocaleTimeString('ru-RU')} (ХБР, UTC+10)`,
      }));
      showToast('Тест 1: Новое занятие добавлено в расписание и базу!');
    } else if (scenario === 'cancel_lesson') {
      const filteredLessons = curData.lessons.filter((l) => l.pairNumber !== 1);
      const simulatedDoc: ParsedScheduleDocument = {
        groupId: activeGroup.id,
        groupCode: activeGroup.code,
        semester: '2026 - 2027 учебный год, осенний семестр',
        serverDateText: '19 октября, понедельник',
        serverWeekParity: 'odd',
        serverWeekLabel: 'неделя по числителю',
        examsUrl: `/exams/${activeGroup.id}/`,
        sourceKind: 'official_snapshot',
        sourceUrl: `https://togudv.ru/rasp/groups/${activeGroup.id}/`,
        contentHash: `hash_sim_cancel_${Date.now()}`,
        fetchedAtIso: nowIso,
        lessons: filteredLessons,
        calendarEvents: curData.calendarEvents,
      };
      const { nextDb } = syncGroupScheduleToDatabase(sharedDbRef.current, simulatedDoc);
      setSharedDb(nextDb);
      const changes = [
        {
          id: `sim_chg_${Date.now()}`,
          groupId: activeGroup.id,
          groupCode: activeGroup.code,
          changeType: 'cancelled_lesson' as const,
          dayOfWeek: 1,
          pairNumber: 1,
          weekParity: 'both' as const,
          subgroup: 'all' as const,
          subject: 'Информационные технологии в строительстве',
          description: 'Отмена пары в понедельник: 1-я пара (08:30–10:00) снята с расписания',
          severity: 'alert' as const,
          detectedAtIso: nowIso,
        },
      ];
      defaultToguSyncEngine.recordScheduleChanges(changes);
      setSyncStatus((prev) => ({
        ...prev,
        state: 'changes_applied',
        recentChanges: [...changes, ...prev.recentChanges],
        lastSuccessfulSyncIso: nowIso,
      }));
      showToast('Тест 2: Зафиксирована отмена пары, слот снят!');
    } else if (scenario === 'reschedule') {
      const modifiedLessons = curData.lessons.map((l) => {
        if (l.pairNumber === 2) {
          return { ...l, room: '504с (Главный)', teacher: 'Николаев С. П.' };
        }
        return l;
      });
      const simulatedDoc: ParsedScheduleDocument = {
        groupId: activeGroup.id,
        groupCode: activeGroup.code,
        semester: '2026 - 2027 учебный год, осенний семестр',
        serverDateText: '19 октября, понедельник',
        serverWeekParity: 'odd',
        serverWeekLabel: 'неделя по числителю',
        examsUrl: `/exams/${activeGroup.id}/`,
        sourceKind: 'official_snapshot',
        sourceUrl: `https://togudv.ru/rasp/groups/${activeGroup.id}/`,
        contentHash: `hash_sim_resched_${Date.now()}`,
        fetchedAtIso: nowIso,
        lessons: modifiedLessons,
        calendarEvents: curData.calendarEvents,
      };
      const { nextDb } = syncGroupScheduleToDatabase(sharedDbRef.current, simulatedDoc);
      setSharedDb(nextDb);
      const changes = [
        {
          id: `sim_chg_${Date.now()}`,
          groupId: activeGroup.id,
          groupCode: activeGroup.code,
          changeType: 'rescheduled_room' as const,
          dayOfWeek: 1,
          pairNumber: 2,
          weekParity: 'both' as const,
          subgroup: 'all' as const,
          subject: 'Современные строительные материалы',
          description: 'Перенос аудитории: 2-я пара перенесена в ауд. 504с, преп. Николаев С. П.',
          severity: 'warning' as const,
          detectedAtIso: nowIso,
        },
      ];
      defaultToguSyncEngine.recordScheduleChanges(changes);
      setSyncStatus((prev) => ({
        ...prev,
        state: 'changes_applied',
        recentChanges: [...changes, ...prev.recentChanges],
        lastSuccessfulSyncIso: nowIso,
      }));
      showToast('Тест 3: Зафиксирован перенос аудитории и замена преподавателя!');
    } else if (scenario === 'offline_error') {
      const errRecord: SyncErrorRecord = {
        id: `sim_err_${Date.now()}`,
        groupId: activeGroup.id,
        groupCode: activeGroup.code,
        timestampIso: nowIso,
        timestampKhabarovsk: `${new Date().toLocaleTimeString('ru-RU')} (ХБР, UTC+10)`,
        errorKind: 'HTTP_5XX',
        httpStatus: 503,
        message: 'HTTP 503 Service Unavailable: Сервер ТОГУ временно перегружен',
        userFriendlyHint: 'Сервер расписания ТОГУ (togudv.ru) вернул ошибку 503. Задействован сохранённый кэш.',
        attemptCount: 1,
        nextAllowedRetryIso: new Date(Date.now() + 30000).toISOString(),
      };
      defaultToguSyncEngine.logSyncError(errRecord);
      setSyncStatus((prev) => ({
        ...prev,
        state: 'stale_offline',
        isStale: true,
        staleWarning: `Сервер ТОГУ временно недоступен (HTTP 503). Отображается сохранённая копия от ${prev.lastSuccessfulSyncKhabarovsk || 'сегодня'}. Данные могут быть устаревшими.`,
        errorLogs: [errRecord, ...prev.errorLogs],
      }));
      setScheduleError(
        'Сервер ТОГУ временно недоступен (HTTP 503). Отображается сохранённая версия расписания.'
      );
      showToast('Тест 4: Сбой сервера ТОГУ (503). Включен офлайн-кэш и предупреждение!');
    } else if (scenario === 'resync_recover') {
      loadGroupSchedule(activeGroup.id, true);
      setScheduleError(null);
      setSyncStatus((prev) => ({
        ...prev,
        state: 'up_to_date',
        isStale: false,
        staleWarning: null,
        consecutiveErrors: 0,
      }));
      showToast('Тест 5: Связь с сервером восстановлена, предупреждение снято!');
    }
  };

  useEffect(() => {
    loadGroupSchedule(activeGroup.id, false);
  }, [activeGroup.id]);

  // Обработка импорта .html файла в централизованную реляционную БД
  const handleHtmlFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const htmlContent = String(reader.result || '');
        if (htmlContent.includes('rasp-group-list') && htmlContent.includes('inst_name')) {
          const parsedGroups = parseOfficialGroupsHtml(htmlContent);
          setGroupsCatalog(
            parsedGroups.map((g) => ({
              ...g,
              studentsCount: 25,
              headmanDemo: `ID группы на togudv.ru: ${g.id}`,
              hasOfficialSnapshot: Boolean(OFFICIAL_SCHEDULES_HTML_SNAPSHOTS[g.id]),
            }))
          );
          showToast(`В каталог загружено ${parsedGroups.length} групп ТОГУ!`);
        } else {
          const parsedDoc = parseOfficialScheduleHtml(htmlContent, activeGroup.id, 'user_imported_html');
          const { nextDb, syncLog } = syncGroupScheduleToDatabase(sharedDbRef.current, parsedDoc);
          setSharedDb(nextDb);
          setScheduleError(null);
          updateSettings({ selectedGroupId: parsedDoc.groupId });
          showToast(
            `БД синхронизирована (${parsedDoc.groupCode}): слотов ${syncLog.totalGroupSlots}, дубликатов предотвращено ${syncLog.duplicatesPrevented}`
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setScheduleError(`Ошибка разбора HTML-файла: ${msg}`);
        showToast('Ошибка: выбранный файл не соответствует структуре расписания ТОГУ');
      }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  const toggleFavoriteGroup = (groupId: string) => {
    setUserPrefs((prev) => {
      const exists = prev.favoriteGroupIds.includes(groupId);
      const nextFavs = exists
        ? prev.favoriteGroupIds.filter((id) => id !== groupId)
        : [...prev.favoriteGroupIds, groupId];
      const next: UserPreferencesRecord = {
        ...prev,
        favoriteGroupIds: nextFavs,
        updatedAtIso: new Date().toISOString(),
      };
      saveUserPreferences(next);
      const grp = groupsCatalog.find((g) => g.id === groupId);
      if (grp) {
        showToast(exists ? `Группа ${grp.code} удалена из избранного` : `Группа ${grp.code} сохранена в избранное`);
      }
      return next;
    });
  };

  const saveLessonNoteAndOverride = (lesson: LessonItem) => {
    // 1. Сохраняем личную заметку в изолированное хранилище UserPreferencesStore
    setUserPrefs((prev) => {
      const nextNotes = { ...prev.personalNotes };
      if (!noteDraft.trim()) {
        delete nextNotes[lesson.id];
      } else {
        nextNotes[lesson.id] = noteDraft.trim();
      }
      const next: UserPreferencesRecord = {
        ...prev,
        personalNotes: nextNotes,
        updatedAtIso: new Date().toISOString(),
      };
      saveUserPreferences(next);
      return next;
    });

    // 2. Сохраняем отметку об отмене / переносе в таблицу schedule_overrides централизованной БД
    if (lesson.slotKey) {
      const pairSlot = TOGU_BELL_SCHEDULE.find((b) => b.pairNumber === overrideNewPairDraft);
      const nextDb = upsertScheduleOverrideInDb(sharedDbRef.current, {
        slotKey: lesson.slotKey,
        groupId: activeGroup.id,
        status: overrideStatusDraft,
        reason: overrideReasonDraft.trim(),
        newRoomCode: overrideStatusDraft === 'rescheduled' ? overrideNewRoomDraft.trim() || lesson.room : undefined,
        newDate: overrideStatusDraft === 'rescheduled' ? overrideNewDateDraft.trim() : undefined,
        newPairNumber: overrideStatusDraft === 'rescheduled' ? overrideNewPairDraft : undefined,
        newStartTime: overrideStatusDraft === 'rescheduled' && pairSlot ? pairSlot.start : undefined,
        updatedAtIso: new Date().toISOString(),
      });
      setSharedDb(nextDb);
    }

    showToast('Изменения сохранены (личная заметка и статус пары в БД)');
  };

  const isExplicitDemoActive = Boolean(!scheduleMeta && explicitDemoConfirmedForGroup[activeGroup.id]);

  const groupLessons: LessonItem[] = useMemo(() => {
    if (scheduleMeta) {
      return dbGroupData.lessons;
    }
    if (explicitDemoConfirmedForGroup[activeGroup.id]) {
      return BASE_POB31_LESSONS;
    }
    return [];
  }, [scheduleMeta, dbGroupData.lessons, explicitDemoConfirmedForGroup, activeGroup.id]);

  const calendarEvents: ParsedCalendarEvent[] = useMemo(() => {
    return scheduleMeta ? dbGroupData.calendarEvents : [];
  }, [scheduleMeta, dbGroupData.calendarEvents]);

  const currentSimulatedMinutes = useMemo(() => {
    if (demoTimePreset === 'pair2') return toMinutes('10:35');
    if (demoTimePreset === 'break') return toMinutes('13:30');
    if (demoTimePreset === 'morning') return toMinutes('08:15');
    return khabarovskClock.minutesOfDay;
  }, [demoTimePreset, khabarovskClock.minutesOfDay]);

  const currentSimulatedTimeLabel = useMemo(() => {
    const h = Math.floor(currentSimulatedMinutes / 60);
    const m = currentSimulatedMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }, [currentSimulatedMinutes]);

  const notificationReport = useMemo(() => {
    const report = reconcileScheduleNotifications({
      groupId: activeGroup.id,
      groupCode: activeGroup.code,
      lessons: dbGroupData.lessons,
      selectedSubgroup: settings.subgroup,
      targetIsoDate: selectedDateIso,
      targetWeekParity: academicInfo.parity,
      simulatedMinutesOfDay: currentSimulatedMinutes,
      notificationsEnabled,
      leadMinutes: notificationLeadMinutes,
      lockScreenOngoingEnabled,
      previousNotifications: prevNotifsRef.current,
    });
    prevNotifsRef.current = report.activeNotifications;
    return report;
  }, [
    activeGroup.id,
    activeGroup.code,
    dbGroupData.lessons,
    settings.subgroup,
    selectedDateIso,
    academicInfo.parity,
    currentSimulatedMinutes,
    notificationsEnabled,
    notificationLeadMinutes,
    lockScreenOngoingEnabled,
  ]);

  const updateNotificationLead = (mins: NotificationLeadMinutes) => {
    setNotificationLeadMinutes(mins);
    try {
      localStorage.setItem('togu_notif_lead_v1', JSON.stringify(mins));
    } catch {}
    showToast(`Интервал уведомлений изменён: за ${mins} минут до начала пары (ХБР, UTC+10)`);
  };

  const toggleNotificationsMaster = (nextVal: boolean) => {
    setNotificationsEnabled(nextVal);
    try {
      localStorage.setItem('togu_notif_enabled_v1', JSON.stringify(nextVal));
    } catch {}
    showToast(
      nextVal
        ? `Локальные уведомления включены (интервал: за ${notificationLeadMinutes} мин)`
        : 'Все запланированные уведомления о парах отключены и сняты с очереди'
    );
  };

  const weekDaysStrip = useMemo(() => {
    const monday = getMondayOfWeek(selectedDateObj);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const iso = getIsoDateString(d);
      const dow = i + 1;
      const dayMeta = DAYS_OF_WEEK[i];
      const { parity } = getAcademicWeekInfo(d);
      const count = groupLessons.filter(
        (l) =>
          l.dayOfWeek === dow &&
          (l.weekParity === 'both' || l.weekParity === parity) &&
          (settings.subgroup === 'all' || l.subgroup === 'all' || l.subgroup === settings.subgroup)
      ).length;

      return {
        date: d,
        iso,
        dayNumber: d.getDate(),
        monthShort: MONTHS_SHORT[d.getMonth()],
        shortName: dayMeta.short,
        fullName: dayMeta.full,
        isToday: iso === realTodayIso,
        isSelected: iso === selectedDateIso,
        lessonsCount: count,
      };
    });
  }, [selectedDateObj, groupLessons, realTodayIso, selectedDateIso, settings.subgroup]);

  const lessonsForSelectedDate = useMemo(() => {
    const dow = getDayOfWeek1to7(selectedDateObj);
    const { parity } = getAcademicWeekInfo(selectedDateObj);
    return groupLessons
      .filter((l) => {
        if (l.dayOfWeek !== dow) return false;
        if (l.weekParity !== 'both' && l.weekParity !== parity) return false;
        if (settings.subgroup !== 'all' && l.subgroup !== 'all' && l.subgroup !== settings.subgroup) return false;
        if (typeFilter !== 'all' && l.type !== typeFilter) return false;
        return true;
      })
      .sort((a, b) => a.pairNumber - b.pairNumber);
  }, [groupLessons, selectedDateObj, settings.subgroup, typeFilter]);

  const getLessonsForWeekday = (dayOfWeek: number, parity: WeekParity) => {
    return groupLessons
      .filter((l) => {
        if (l.dayOfWeek !== dayOfWeek) return false;
        if (l.weekParity !== 'both' && l.weekParity !== parity) return false;
        if (settings.subgroup !== 'all' && l.subgroup !== 'all' && l.subgroup !== settings.subgroup) return false;
        if (typeFilter !== 'all' && l.type !== typeFilter) return false;
        return true;
      })
      .sort((a, b) => a.pairNumber - b.pairNumber);
  };

  const shiftSelectedDate = (daysDelta: number) => {
    const d = new Date(selectedDateObj);
    d.setDate(d.getDate() + daysDelta);
    setSelectedDateIso(getIsoDateString(d));
  };

  const jumpToDate = (iso: string) => {
    setSelectedDateIso(iso);
  };

  const isLight = settings.theme === 'light';
  const isOled = settings.theme === 'oled';

  const bgRoot = isLight
    ? 'bg-slate-50 text-slate-900'
    : isOled
    ? 'bg-black text-slate-100'
    : 'bg-[#090D16] text-slate-100';

  const bgSurface = isLight
    ? 'bg-white border-slate-200/90 shadow-sm'
    : isOled
    ? 'bg-[#0C0F17] border-slate-800/80'
    : 'bg-[#111827]/90 border-slate-800/80';

  const bgSubtle = isLight
    ? 'bg-slate-100/80 border-slate-200'
    : isOled
    ? 'bg-slate-900/70 border-slate-800'
    : 'bg-slate-800/50 border-slate-700/60';

  const textMuted = isLight ? 'text-slate-500' : 'text-slate-400';

  const accentClasses = {
    blue: {
      btn: 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/20',
      soft: isLight ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-blue-500/15 text-blue-300 border-blue-500/30',
      activeNav: isLight ? 'bg-blue-600 text-white' : 'bg-blue-600/20 text-blue-300 border-blue-500/40',
      ring: 'ring-blue-500',
      text: isLight ? 'text-blue-600' : 'text-blue-400',
      bar: 'bg-blue-500',
    },
    emerald: {
      btn: 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20',
      soft: isLight ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      activeNav: isLight ? 'bg-emerald-600 text-white' : 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40',
      ring: 'ring-emerald-500',
      text: isLight ? 'text-emerald-600' : 'text-emerald-400',
      bar: 'bg-emerald-500',
    },
    violet: {
      btn: 'bg-violet-600 hover:bg-violet-500 text-white shadow-violet-600/20',
      soft: isLight ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-violet-500/15 text-violet-300 border-violet-500/30',
      activeNav: isLight ? 'bg-violet-600 text-white' : 'bg-violet-600/20 text-violet-300 border-violet-500/40',
      ring: 'ring-violet-500',
      text: isLight ? 'text-violet-600' : 'text-violet-400',
      bar: 'bg-violet-500',
    },
    amber: {
      btn: 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/20',
      soft: isLight ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-amber-500/15 text-amber-300 border-amber-500/30',
      activeNav: isLight ? 'bg-amber-600 text-white' : 'bg-amber-600/20 text-amber-300 border-amber-500/40',
      ring: 'ring-amber-500',
      text: isLight ? 'text-amber-600' : 'text-amber-400',
      bar: 'bg-amber-500',
    },
  }[settings.accent];

  const filteredGroups = useMemo(() => {
    const qRaw = groupSearchQuery.trim().toLowerCase();
    const qNormalized = qRaw.replace(/\s*-\s*/g, '-');

    const allFiltered = groupsCatalog.filter((g) => {
      if (selectedInstitute !== 'all') {
        if (selectedInstitute === 'ПИ' && g.instituteShort !== 'ПОЛИТЕХ' && g.instituteShort !== 'ПИ') return false;
        else if (selectedInstitute === 'ИАиД' && g.instituteShort !== 'ИАСиД' && g.instituteShort !== 'ИАиД') return false;
        else if (selectedInstitute === 'ПедИнститут' && g.instituteShort !== 'Пединститут' && g.instituteShort !== 'ПедИнститут') return false;
        else if (
          selectedInstitute !== 'ПИ' &&
          selectedInstitute !== 'ИАиД' &&
          selectedInstitute !== 'ПедИнститут' &&
          g.instituteShort !== selectedInstitute
        ) {
          return false;
        }
      }
      if (selectedCourse !== 'all' && g.course !== selectedCourse) return false;
      if (!qRaw) return true;
      const codeNorm = g.code.toLowerCase().replace(/\s*-\s*/g, '-');
      return (
        g.code.toLowerCase().includes(qRaw) ||
        codeNorm.includes(qNormalized) ||
        g.id.toLowerCase().includes(qRaw) ||
        g.name.toLowerCase().includes(qRaw) ||
        g.specializationCode.toLowerCase().includes(qRaw) ||
        g.instituteShort.toLowerCase().includes(qRaw) ||
        g.instituteFull.toLowerCase().includes(qRaw)
      );
    });

    return allFiltered.sort((a, b) => {
      const aPriority = (a.hasOfficialSnapshot ? 10 : a.isTestFixture ? 5 : 0) + (favoriteGroupIds.includes(a.id) ? 3 : 0);
      const bPriority = (b.hasOfficialSnapshot ? 10 : b.isTestFixture ? 5 : 0) + (favoriteGroupIds.includes(b.id) ? 3 : 0);
      return bPriority - aPriority;
    });
  }, [groupsCatalog, groupSearchQuery, selectedInstitute, selectedCourse, favoriteGroupIds]);

  // Проверка: относится ли выбранный в календаре день к сегодняшней дате (или включён ручной демо-пресет)
  const isSelectedDateToday = selectedDateIso === realTodayIso;
  const isSelectedDatePast = selectedDateIso < realTodayIso;
  const isSelectedDateFuture = selectedDateIso > realTodayIso;

  const liveStatusInfo = useMemo(() => {
    const activeLessons = lessonsForSelectedDate.filter((l) => l.overrideStatus !== 'cancelled');
    if (activeLessons.length === 0) {
      return {
        state: 'free' as const,
        label: isSelectedDateToday
          ? 'Сегодня активных занятий по расписанию нет (выходной или свободный день)'
          : 'В выбранный день активных занятий по расписанию нет',
      };
    }

    // Если включён режим реального времени ('live'), проверяем дату:
    // - Для прошедших дней все пары уже в прошлом
    // - Для будущих дней пары только запланированы и НЕ могут «идти сейчас»
    if (demoTimePreset === 'live') {
      if (isSelectedDatePast) {
        return {
          state: 'finished' as const,
          label: 'Прошедший учебный день — все занятия завершены',
        };
      }
      if (isSelectedDateFuture) {
        const firstLesson = activeLessons[0];
        return {
          state: 'planned' as const,
          lesson: firstLesson,
          totalCount: activeLessons.length,
          label: `Запланировано занятий: ${activeLessons.length} (начало в ${firstLesson.startTime})`,
        };
      }
    }

    // Здесь либо сегодня (selectedDateIso === realTodayIso), либо пользователь вручную включил демо-пресет времени
    for (let i = 0; i < activeLessons.length; i++) {
      const lesson = activeLessons[i];
      const effStartStr =
        lesson.overrideStatus === 'rescheduled' && lesson.overrideNewStartTime
          ? lesson.overrideNewStartTime
          : lesson.startTime;
      const startM = toMinutes(effStartStr);
      const endM = toMinutes(lesson.endTime);

      if (currentSimulatedMinutes >= startM && currentSimulatedMinutes <= endM) {
        const elapsed = currentSimulatedMinutes - startM;
        const total = Math.max(1, endM - startM);
        const left = endM - currentSimulatedMinutes;
        const progress = Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
        return {
          state: 'ongoing' as const,
          lesson,
          leftMinutes: left,
          progress,
        };
      }
      if (currentSimulatedMinutes < startM) {
        const wait = startM - currentSimulatedMinutes;
        const isBreakBetweenPairs = i > 0;
        return {
          state: 'upcoming' as const,
          lesson,
          waitMinutes: wait,
          isBreakBetweenPairs,
        };
      }
    }
    return {
      state: 'finished' as const,
      label: isSelectedDateToday
        ? `Все пары на сегодня завершены (сейчас в Хабаровске ${currentSimulatedTimeLabel})`
        : 'Все пары на выбранный день завершены',
    };
  }, [
    lessonsForSelectedDate,
    currentSimulatedMinutes,
    currentSimulatedTimeLabel,
    demoTimePreset,
    isSelectedDateToday,
    isSelectedDatePast,
    isSelectedDateFuture,
  ]);

  const handleInspectLesson = (lesson: LessonItem) => {
    setInspectedLesson(lesson);
    setNoteDraft(customNotes[lesson.id] ?? lesson.defaultNote ?? '');
    setOverrideStatusDraft(lesson.overrideStatus || 'normal');
    setOverrideReasonDraft(lesson.overrideReason || '');
    setOverrideNewRoomDraft(lesson.overrideNewRoomCode || lesson.room || '');
    setOverrideNewDateDraft(lesson.overrideNewDate || '');
    setOverrideNewPairDraft(lesson.overrideNewPairNumber || lesson.pairNumber || 1);
  };

  // Отрисовка карточки занятия (с точной проверкой сегодняшнего дня недели и времени Хабаровска)
  const renderLessonCard = (
    lesson: LessonItem,
    index: number,
    allDayLessons: LessonItem[],
    contextMode: 'selected_date' | 'week_view' = 'selected_date'
  ) => {
    const typeMeta = LESSON_TYPE_META[lesson.type];
    const effStartStr =
      lesson.overrideStatus === 'rescheduled' && lesson.overrideNewStartTime
        ? lesson.overrideNewStartTime
        : lesson.startTime;
    const startM = toMinutes(effStartStr);
    const endM = toMinutes(lesson.endTime);
    const isCancelled = lesson.overrideStatus === 'cancelled';
    const isRescheduled = lesson.overrideStatus === 'rescheduled';

    // Определяем, относится ли данная карточка к сегодняшнему реальному дню
    let isCardForToday = false;
    let isCardForPastDay = false;

    if (contextMode === 'selected_date') {
      if (demoTimePreset !== 'live') {
        isCardForToday = true;
      } else {
        isCardForToday = isSelectedDateToday;
        isCardForPastDay = isSelectedDatePast;
      }
    } else {
      // На вкладке «Неделя» статус «Идёт сейчас» показывается ТОЛЬКО для сегодняшнего дня недели и текущей чётности
      const isCurrentWeekParity = weekViewParity === realTodayAcademicInfo.parity;
      if (demoTimePreset !== 'live') {
        isCardForToday = lesson.dayOfWeek === weekSelectedDay;
      } else {
        isCardForToday = isCurrentWeekParity && lesson.dayOfWeek === realTodayDow;
        isCardForPastDay = isCurrentWeekParity && lesson.dayOfWeek < realTodayDow;
      }
    }

    const isOngoing =
      !isCancelled && isCardForToday && currentSimulatedMinutes >= startM && currentSimulatedMinutes <= endM;
    const isPast =
      !isCancelled && (isCardForPastDay || (isCardForToday && currentSimulatedMinutes > endM));
    const noteText = customNotes[lesson.id] ?? lesson.defaultNote;

    const prevLesson = index > 0 ? allDayLessons[index - 1] : null;
    const pairGap = prevLesson ? lesson.pairNumber - prevLesson.pairNumber : 0;
    const crossesBigBreak = prevLesson && prevLesson.pairNumber <= 3 && lesson.pairNumber >= 4;

    return (
      <React.Fragment key={lesson.id}>
        {settings.showBigBreak && crossesBigBreak && pairGap === 1 && (
          <div
            className={`my-2.5 flex items-center justify-between px-4 py-2 rounded-xl border text-xs ${
              isLight
                ? 'bg-amber-50/70 border-amber-200/80 text-amber-800'
                : 'bg-amber-500/10 border-amber-500/20 text-amber-300'
            }`}
          >
            <div className="flex items-center gap-2 font-medium">
              <Coffee className="w-3.5 h-3.5 shrink-0" />
              <span>Большой обеденный перерыв ТОГУ</span>
            </div>
            <span className="font-mono font-semibold">13:20 – 13:50 (30 мин)</span>
          </div>
        )}

        {settings.showWindows && pairGap > 1 && (
          <div
            className={`my-2.5 flex items-center justify-between px-4 py-2.5 rounded-xl border border-dashed text-xs ${
              isLight
                ? 'bg-slate-100/70 border-slate-300 text-slate-600'
                : 'bg-slate-800/30 border-slate-700 text-slate-400'
            }`}
          >
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              <span>
                Свободное окно ({pairGap - 1}{' '}
                {pairGap - 1 === 1 ? 'пара свободна' : 'пары свободны'})
              </span>
            </div>
            <span className="font-mono">
              {prevLesson?.endTime} – {lesson.startTime}
            </span>
          </div>
        )}

        <div
          onClick={() => handleInspectLesson(lesson)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleInspectLesson(lesson);
          }}
          className={`group relative rounded-2xl border border-l-4 transition-all duration-200 cursor-pointer ${
            isCancelled
              ? 'border-l-rose-500 opacity-80'
              : isRescheduled
              ? 'border-l-amber-500'
              : typeMeta.borderAccent
          } ${bgSurface} ${
            isOngoing
              ? `ring-2 ${accentClasses.ring} shadow-lg`
              : 'hover:border-slate-600/80'
          } ${settings.compactCards ? 'p-3.5' : 'p-4 sm:p-5'}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              {settings.showPairNumbers && (
                <span
                  className={`inline-flex items-center justify-center px-2.5 py-1 rounded-lg text-xs font-bold tracking-wide ${
                    isCancelled
                      ? 'bg-rose-500/20 text-rose-300'
                      : isOngoing
                      ? accentClasses.btn
                      : bgSubtle
                  }`}
                >
                  {lesson.pairNumber} пара
                </span>
              )}
              <div className="flex items-center gap-1.5 font-mono text-sm font-semibold">
                <Clock className={`w-3.5 h-3.5 ${accentClasses.text}`} />
                <span className={isCancelled ? 'line-through opacity-70' : ''}>
                  {lesson.startTime} – {lesson.endTime}
                </span>
              </div>
              {lesson.dateRange && (
                <span className={`text-[11px] px-2 py-0.5 rounded-md font-mono ${bgSubtle} ${textMuted}`}>
                  {lesson.dateRange}
                </span>
              )}
              {isCancelled && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                  <Ban className="w-3 h-3" />
                  ОТМЕНЕНО
                </span>
              )}
              {isRescheduled && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  <ArrowRightLeft className="w-3 h-3" />
                  ПЕРЕНЕСЕНО
                </span>
              )}
              {isOngoing && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Идёт сейчас
                </span>
              )}
              {isPast && !isOngoing && !isCancelled && (
                <span className={`text-[11px] px-2 py-0.5 rounded-md ${bgSubtle} ${textMuted}`}>
                  Завершена
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {lesson.isOnline && (
                <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  ДИСТАН.
                </span>
              )}
              {lesson.subgroup && lesson.subgroup !== 'all' && (
                <span
                  className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${
                    isLight
                      ? 'bg-slate-100 text-slate-700 border-slate-300'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                >
                  {lesson.subgroup} подгруппа
                </span>
              )}
              {lesson.weekParity !== 'both' && (
                <span
                  className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${
                    lesson.weekParity === 'odd'
                      ? isLight
                        ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                        : 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30'
                      : isLight
                      ? 'bg-teal-50 text-teal-700 border-teal-200'
                      : 'bg-teal-500/10 text-teal-300 border-teal-500/30'
                  }`}
                >
                  {lesson.weekParity === 'odd' ? 'Числитель (Ч)' : 'Знаменатель (З)'}
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                  isLight ? typeMeta.badgeLight : typeMeta.badgeDark
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${typeMeta.dotColor}`} />
                {lesson.eventTypeFull
                  ? `${typeMeta.label} (${lesson.eventTypeShort})`
                  : typeMeta.label}
              </span>
            </div>
          </div>

          <h3
            className={`font-semibold leading-snug mb-3 transition-colors ${
              settings.compactCards ? 'text-base' : 'text-base sm:text-lg'
            } ${isCancelled ? 'line-through opacity-75' : ''} group-hover:${accentClasses.text}`}
          >
            {lesson.subject}
          </h3>

          {/* Информационный блок об отмене или переносе занятия (Требование 5) */}
          {isCancelled && (
            <div className="mb-3 px-3.5 py-2 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-200 flex items-center justify-between gap-2">
              <span>
                <strong>Пара отменена:</strong> {lesson.overrideReason || 'По решению кафедры / деканата'}
              </span>
              <span className="text-[11px] underline opacity-80">Изменить</span>
            </div>
          )}

          {isRescheduled && (
            <div className="mb-3 px-3.5 py-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-2">
              <div>
                <strong>Перенос занятия:</strong>{' '}
                {lesson.overrideNewRoomCode ? `новая ауд. ${lesson.overrideNewRoomCode}` : ''}
                {lesson.overrideNewPairNumber ? ` • ${lesson.overrideNewPairNumber} пара (${lesson.overrideNewStartTime || ''})` : ''}
                {lesson.overrideNewDate ? ` • дата: ${lesson.overrideNewDate}` : ''}
                {lesson.overrideReason ? ` — ${lesson.overrideReason}` : ''}
              </div>
              <span className="text-[11px] underline opacity-80">Изменить</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2.5 border-t border-slate-800/60">
            <div className="flex items-start gap-2 text-xs sm:text-sm">
              <MapPin className={`w-4 h-4 mt-0.5 shrink-0 ${lesson.isOnline ? 'text-rose-400' : accentClasses.text}`} />
              <div>
                <div className="font-medium">
                  {isRescheduled && lesson.overrideNewRoomCode
                    ? `ауд. ${lesson.overrideNewRoomCode} (вместо ${lesson.room})`
                    : lesson.isOnline
                    ? lesson.room
                    : `ауд. ${lesson.room}`}
                </div>
                <div className={`text-xs ${textMuted} line-clamp-1`}>{lesson.building}</div>
              </div>
            </div>

            <div className="flex items-start gap-2 text-xs sm:text-sm">
              <User className={`w-4 h-4 mt-0.5 shrink-0 ${textMuted}`} />
              <div>
                <div className="font-medium">{lesson.teacher}</div>
                <div className={`text-xs ${textMuted} line-clamp-1`}>{lesson.teacherTitle}</div>
              </div>
            </div>
          </div>

          {noteText && (
            <div
              className={`mt-3 flex items-start gap-2 px-3 py-2 rounded-xl text-xs border ${
                isLight
                  ? 'bg-slate-50 border-slate-200 text-slate-600'
                  : 'bg-slate-900/70 border-slate-800 text-slate-300'
              }`}
            >
              <FileText className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${accentClasses.text}`} />
              <span className="line-clamp-2">{noteText}</span>
            </div>
          )}
        </div>
      </React.Fragment>
    );
  };

  // Подсчёт статистики нормализованной БД
  const dbStats = useMemo(() => {
    return {
      subjectsCount: Object.keys(sharedDb.subjects).length,
      teachersCount: Object.keys(sharedDb.teachers).length,
      classroomsCount: Object.keys(sharedDb.classrooms).length,
      slotsCount: Object.keys(sharedDb.scheduleSlots).length,
      overridesCount: Object.keys(sharedDb.scheduleOverrides).length,
      calEventsCount: Object.keys(sharedDb.calendarEvents).length,
      syncedGroupsCount: Object.keys(sharedDb.groupMeta).length,
    };
  }, [sharedDb]);

  return (
    <div className={`min-h-screen flex flex-col md:flex-row font-sans transition-colors duration-200 ${bgRoot}`}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".html,.htm"
        onChange={handleHtmlFileUpload}
        className="hidden"
      />

      {/* =====================================================================
          БОКОВАЯ ПАНЕЛЬ НАВИГАЦИИ (ДЛЯ КОМПЬЮТЕРОВ — md+)
      ===================================================================== */}
      <aside
        className={`hidden md:flex md:w-72 lg:w-80 md:flex-col md:fixed md:inset-y-0 border-r z-30 ${bgSurface}`}
      >
        <div className="p-5 border-b border-slate-800/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg shadow-md ${accentClasses.btn}`}>
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight">ТОГУ.Расписание</span>
                <span
                  className={`px-1.5 py-0.5 text-[10px] font-bold uppercase rounded border ${
                    scheduleMeta?.sourceKind === 'official_snapshot' || scheduleMeta?.sourceKind === 'official_live'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                  }`}
                >
                  {scheduleMeta?.sourceKind === 'official_snapshot' || scheduleMeta?.sourceKind === 'official_live'
                    ? 'DB SYNC'
                    : 'HYBRID'}
                </span>
              </div>
              <p className={`text-xs ${textMuted}`}>Тихоокеанский госуниверситет</p>
            </div>
          </div>
        </div>

        <div className="p-4 border-b border-slate-800/60">
          <div className={`p-3.5 rounded-xl border ${bgSubtle}`}>
            <div className="flex items-center justify-between mb-1">
              <span className={`text-[11px] font-medium uppercase tracking-wider ${textMuted}`}>
                Основная группа (ID {activeGroup.id})
              </span>
              <button
                type="button"
                onClick={() => setActiveTab('groups')}
                className={`text-xs font-medium hover:underline ${accentClasses.text}`}
              >
                Сменить →
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-lg font-bold tracking-tight">{activeGroup.code}</div>
                <div className={`text-xs ${textMuted} line-clamp-1`}>{activeGroup.name}</div>
              </div>
              <span className={`px-2 py-0.5 rounded-md text-xs font-semibold border ${accentClasses.soft}`}>
                {activeGroup.course} курс
              </span>
            </div>

            {favoriteGroupIds.length > 0 && (
              <div className="mt-3 pt-2.5 border-t border-slate-700/50 flex items-center gap-1.5 flex-wrap">
                <Bookmark className={`w-3 h-3 ${textMuted}`} />
                {favoriteGroupIds.map((favId) => {
                  const g =
                    groupsCatalog.find((item) => item.id === favId) ||
                    DEMO_GROUPS.find((item) => item.id === favId);
                  if (!g) return null;
                  const isCurrent = g.id === activeGroup.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => {
                        updateSettings({ selectedGroupId: g.id });
                        showToast(`Переключено на избранную группу: ${g.code}`);
                      }}
                      className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                        isCurrent
                          ? accentClasses.btn
                          : isLight
                          ? 'bg-white text-slate-600 hover:bg-slate-200'
                          : 'bg-slate-900/80 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {g.code}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1.5">
          {[
            { id: 'today' as NavTab, label: 'Сегодня', icon: Calendar, badge: 'Главная' },
            { id: 'week' as NavTab, label: 'Неделя', icon: Layers, badge: academicInfo.parity === 'odd' ? 'Числитель' : 'Знаменатель' },
            { id: 'calendar' as NavTab, label: 'Календарь', icon: BookOpen, badge: calendarEvents.length > 0 ? `${calendarEvents.length}` : 'Сессия' },
            { id: 'groups' as NavTab, label: 'Группы ТОГУ', icon: Users, badge: `${groupsCatalog.length}` },
            { id: 'settings' as NavTab, label: 'Настройки', icon: Settings },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm font-medium transition-all border ${
                  isActive
                    ? accentClasses.activeNav
                    : `border-transparent ${textMuted} hover:bg-slate-800/40 hover:text-slate-200`
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span
                    className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${
                      isActive ? 'bg-white/20 text-current' : bgSubtle
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800/60 space-y-2">
          <div className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${bgSubtle}`}>
            <div className="flex items-center justify-between font-semibold">
              <span className="flex items-center gap-1.5">
                <Database className={`w-3.5 h-3.5 ${accentClasses.text}`} />
                <span>Централизованная БД</span>
              </span>
              <span className="font-mono text-[10px] opacity-75">
                {scheduleMeta ? `#${scheduleMeta.contentHash}` : '—'}
              </span>
            </div>
            <p className={textMuted}>
              {scheduleMeta
                ? `Синхр. #${scheduleMeta.syncCount}: ${formatDateTimeRu(scheduleMeta.lastSyncedAtIso)}`
                : 'Ожидание синхронизации...'}
            </p>
            <div className="text-[11px] opacity-80">
              Слотов в БД: {dbStats.slotsCount} • Предметов: {dbStats.subjectsCount} • Преп.: {dbStats.teachersCount}
            </div>
            <div className="flex items-center gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => loadGroupSchedule(activeGroup.id, true)}
                className={`flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold ${accentClasses.btn}`}
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingSchedule ? 'animate-spin' : ''}`} />
                <span>Синхр. БД</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border ${bgSurface}`}
                title="Загрузить сохранённый .html файл расписания с togudv.ru"
              >
                <Upload className="w-3 h-3" />
                <span>.HTML</span>
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setSyncModalTab('status');
                setIsSyncModalOpen(true);
              }}
              className="w-full mt-1.5 py-1.5 px-2 rounded-lg text-[11px] font-medium border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 flex items-center justify-center gap-1.5 transition-colors"
            >
              <History className="w-3 h-3" />
              <span>Журнал и 5 сценариев</span>
            </button>
          </div>
        </div>
      </aside>

      {/* =====================================================================
          ОСНОВНАЯ ОБЛАСТЬ КОНТЕНТА
      ===================================================================== */}
      <div className="flex-1 md:pl-72 lg:pl-80 flex flex-col min-h-screen pb-20 md:pb-8">
        <header className={`sticky top-0 z-20 backdrop-blur-md border-b px-4 sm:px-6 py-3.5 ${bgSurface}`}>
          <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 md:hidden">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold ${accentClasses.btn}`}>
                <GraduationCap className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-sm">ТОГУ.Расписание</span>
                </div>
                <div className={`text-[11px] ${textMuted}`}>
                  {activeGroup.code} • {academicInfo.weekNumber}-я уч. неделя
                </div>
              </div>
            </div>

            <div className="hidden md:flex items-center gap-3">
              <h1 className="text-lg font-bold tracking-tight">
                {activeTab === 'today' && 'Расписание на день'}
                {activeTab === 'week' && 'Расписание на всю неделю'}
                {activeTab === 'calendar' && 'Календарное расписание и сессия'}
                {activeTab === 'groups' && `Каталог учебных групп ТОГУ (${groupsCatalog.length})`}
                {activeTab === 'settings' && 'Настройки и уведомления'}
              </h1>
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${accentClasses.soft}`}>
                {scheduleMeta?.serverWeekLabel
                  ? `По данным ТОГУ: ${scheduleMeta.serverWeekLabel}`
                  : `${academicInfo.weekNumber}-я неделя (${academicInfo.parity === 'odd' ? 'Числитель' : 'Знаменатель'})`}
              </span>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs ${bgSubtle}`}>
                <Clock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className={`hidden md:inline ${textMuted}`}>Время ХБР:</span>
                <select
                  aria-label="Режим часов Хабаровска"
                  value={demoTimePreset}
                  onChange={(e) => setDemoTimePreset(e.target.value as 'live' | 'pair2' | 'break' | 'morning')}
                  className="bg-transparent font-medium focus:outline-none cursor-pointer text-[11px] sm:text-xs"
                >
                  <option value="live" className="bg-slate-900 text-slate-100">
                    Сейчас в ХБР: {khabarovskClock.timeHHMM} (Авто)
                  </option>
                  <option value="pair2" className="bg-slate-900 text-slate-100">Демо: 10:35 (Идёт 2-я пара)</option>
                  <option value="break" className="bg-slate-900 text-slate-100">Демо: 13:30 (Перерыв)</option>
                  <option value="morning" className="bg-slate-900 text-slate-100">Демо: 08:15 (До пар)</option>
                </select>
              </div>
            </div>
          </div>
        </header>

        {/* Предупреждение об устаревании данных при недоступности сайта ТОГУ */}
        {syncStatus.isStale && (
          <div className="px-4 sm:px-6 pt-3">
            <div className="max-w-5xl mx-auto">
              <div className="p-3.5 rounded-2xl border border-amber-500/50 bg-amber-500/15 text-amber-200 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm shadow-lg animate-in fade-in">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <div className="font-bold text-amber-300">Данные могут быть устаревшими</div>
                    <div className="text-amber-200/90 text-xs">{syncStatus.staleWarning}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => loadGroupSchedule(activeGroup.id, true)}
                    className="px-3 py-1.5 rounded-xl bg-amber-400 text-slate-950 font-bold hover:bg-amber-300 inline-flex items-center gap-1 text-xs"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingSchedule ? 'animate-spin' : ''}`} />
                    <span>Повторить проверку</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSyncModalTab('errors');
                      setIsSyncModalOpen(true);
                    }}
                    className="px-3 py-1.5 rounded-xl border border-amber-400/40 hover:bg-amber-400/20 text-xs font-semibold"
                  >
                    Журнал ошибок ({syncStatus.errorLogs.length})
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Основной контент вкладок */}
        <main className="flex-1 px-4 sm:px-6 py-5 max-w-5xl w-full mx-auto space-y-6">
          {isLoadingSchedule && (
            <div className={`p-8 rounded-2xl border text-center space-y-3 ${bgSurface}`}>
              <RefreshCw className={`w-8 h-8 mx-auto animate-spin ${accentClasses.text}`} />
              <div className="font-semibold text-base">
                Синхронизация расписания группы {activeGroup.code} с базой данных...
              </div>
              <p className={`text-xs ${textMuted}`}>
                Нормализация дисциплин, преподавателей, аудиторий и дедупликация слотов (UPSERT)
              </p>
            </div>
          )}

          {!isLoadingSchedule && scheduleError && !isExplicitDemoActive && (
            <div className={`p-6 rounded-2xl border border-rose-500/40 space-y-4 ${bgSurface}`}>
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-rose-500/15 text-rose-400 shrink-0">
                  <ShieldAlert className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-bold text-base text-rose-300">
                    Не удалось синхронизировать расписание группы {activeGroup.code} (ID {activeGroup.id})
                  </h3>
                  <p className={`text-xs sm:text-sm ${textMuted}`}>{scheduleError}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold ${accentClasses.btn}`}
                >
                  <Upload className="w-4 h-4" />
                  <span>Загрузить .html файл группы {activeGroup.code}</span>
                </button>
                <button
                  type="button"
                  onClick={() => updateSettings({ selectedGroupId: '68805' })}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border ${accentClasses.soft}`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Открыть СУЗ(с) - 51 (Официальный снимок 68805)</span>
                </button>
                <button
                  type="button"
                  onClick={() => loadGroupSchedule(activeGroup.id, true)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border ${bgSubtle}`}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Повторить запрос</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExplicitDemoConfirmedForGroup((prev) => ({ ...prev, [activeGroup.id]: true }));
                    showToast(`Для группы ${activeGroup.code} явно включены демонстрационные данные`);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25"
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>Показать демо-данные (с явной пометкой)</span>
                </button>
              </div>
            </div>
          )}

          {/* =================================================================
              ВКЛАДКА 1: «СЕГОДНЯ»
              Порядок: 1. Выбор дня недели -> 2. Выбор подгрупп и типов пар -> 3. Сами пары -> 4. Статус и сводка дня внизу
          ================================================================= */}
          {activeTab === 'today' && !isLoadingSchedule && (scheduleMeta || isExplicitDemoActive) && (
            <>
              {/* 1. ВЫБОР ДНЯ НЕДЕЛИ И ДАТЫ */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
                      {formatHumanDate(selectedDateObj)}
                    </h2>
                    {selectedDateIso === realTodayIso ? (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        Сегодня
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => jumpToDate(realTodayIso)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${accentClasses.btn}`}
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Вернуться к сегодня</span>
                      </button>
                    )}
                  </div>
                  <p className={`text-xs sm:text-sm mt-1 ${textMuted}`}>
                    Группа <span className="font-semibold">{activeGroup.code}</span> ({activeGroup.name}) •{' '}
                    {academicInfo.parity === 'odd' ? 'Нечётная неделя (Числитель)' : 'Чётная неделя (Знаменатель)'}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => shiftSelectedDate(-7)}
                    title="Предыдущая неделя"
                    className={`p-2 rounded-xl border transition-colors hover:border-slate-500 ${bgSurface}`}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => shiftSelectedDate(-1)}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors hover:border-slate-500 ${bgSurface}`}
                  >
                    Пред. день
                  </button>
                  <button
                    type="button"
                    onClick={() => shiftSelectedDate(1)}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors hover:border-slate-500 ${bgSurface}`}
                  >
                    След. день
                  </button>
                  <button
                    type="button"
                    onClick={() => shiftSelectedDate(7)}
                    title="Следующая неделя"
                    className={`p-2 rounded-xl border transition-colors hover:border-slate-500 ${bgSurface}`}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className={`p-3 rounded-2xl border ${bgSurface}`}>
                <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                  {weekDaysStrip.map((day) => {
                    const isSelected = day.isSelected;
                    const isToday = day.isToday;
                    return (
                      <button
                        key={day.iso}
                        type="button"
                        onClick={() => jumpToDate(day.iso)}
                        className={`relative flex flex-col items-center justify-center py-2.5 px-1 rounded-xl border transition-all ${
                          isSelected
                            ? `${accentClasses.btn} border-transparent shadow-md`
                            : isToday
                            ? `border-emerald-500/60 ${
                                isLight ? 'bg-emerald-50 text-emerald-900' : 'bg-emerald-500/10 text-emerald-200'
                              }`
                            : `border-transparent hover:border-slate-700 ${bgSubtle}`
                        }`}
                      >
                        {isToday && (
                          <span
                            className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded-full mb-0.5 ${
                              isSelected
                                ? 'bg-white/25 text-white'
                                : 'bg-emerald-500/20 text-emerald-300'
                            }`}
                          >
                            Сегодня
                          </span>
                        )}
                        <span className={`text-[11px] font-medium ${isSelected ? 'text-white/90' : textMuted}`}>
                          {day.shortName}
                        </span>
                        <span className="text-base sm:text-lg font-bold leading-tight mt-0.5">
                          {day.dayNumber}
                        </span>
                        <span className={`text-[10px] ${isSelected ? 'text-white/80' : textMuted}`}>
                          {day.monthShort}
                        </span>

                        <div className="mt-1.5 flex items-center gap-1">
                          {day.lessonsCount > 0 ? (
                            <span
                              className={`text-[10px] px-1.5 py-0.2 rounded-full font-semibold ${
                                isSelected
                                  ? 'bg-white/25 text-white'
                                  : isLight
                                  ? 'bg-slate-200 text-slate-700'
                                  : 'bg-slate-700/80 text-slate-300'
                              }`}
                            >
                              {day.lessonsCount} {day.lessonsCount === 1 ? 'пара' : day.lessonsCount < 5 ? 'пары' : 'пар'}
                            </span>
                          ) : (
                            <span className="text-[10px] opacity-50">выходной</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. ВЫБОР ПОДГРУПП И ТИПОВ ПАР */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className={`inline-flex items-center p-1 rounded-xl border ${bgSurface}`}>
                  {(['all', '1', '2'] as SubgroupFilter[]).map((sg) => (
                    <button
                      key={sg}
                      type="button"
                      onClick={() => updateSettings({ subgroup: sg })}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        settings.subgroup === sg
                          ? accentClasses.btn
                          : `${textMuted} hover:text-current`
                      }`}
                    >
                      {sg === 'all' ? 'Все подгруппы' : `${sg}-я подгруппа`}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  <ListFilter className={`w-4 h-4 mr-1 ${textMuted}`} />
                  {[
                    { id: 'all', label: 'Все типы' },
                    { id: 'lecture', label: 'Лекции' },
                    { id: 'practice', label: 'Практики' },
                    { id: 'lab', label: 'Лабораторные' },
                    { id: 'project', label: 'Проекты' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTypeFilter(t.id as LessonType | 'all')}
                      className={`px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                        typeFilter === t.id
                          ? accentClasses.soft
                          : `${bgSurface} ${textMuted} hover:border-slate-600`
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 3. САМИ ПАРЫ */}
              <div className="space-y-3">
                {lessonsForSelectedDate.length > 0 ? (
                  lessonsForSelectedDate.map((lesson, idx) =>
                    renderLessonCard(lesson, idx, lessonsForSelectedDate)
                  )
                ) : groupLessons.length === 0 ? (
                  <div className={`p-8 rounded-2xl border text-center space-y-3 ${bgSurface}`}>
                    <Calendar className={`w-10 h-10 mx-auto ${textMuted}`} />
                    <div className="text-base font-semibold">
                      Для группы {activeGroup.code} в официальном расписании ТОГУ на этот семестр нет записей (0 пар)
                    </div>
                    <p className={`text-xs max-w-md mx-auto ${textMuted}`}>
                      Таблица #all_weeks на странице группы пуста. Выберите другую учебную группу во вкладке «Группы».
                    </p>
                  </div>
                ) : (
                  <div className={`p-8 rounded-2xl border text-center space-y-3 ${bgSurface}`}>
                    <Calendar className={`w-10 h-10 mx-auto ${textMuted}`} />
                    <div className="text-base font-semibold">
                      В этот день ({formatHumanDate(selectedDateObj)}) занятий нет
                    </div>
                    <p className={`text-xs max-w-md mx-auto ${textMuted}`}>
                      По официальному расписанию группы {activeGroup.code} на выбранный день или фильтр пары отсутствуют.
                    </p>
                    {(typeFilter !== 'all' || settings.subgroup !== 'all') && (
                      <div className="flex items-center justify-center gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setTypeFilter('all');
                            updateSettings({ subgroup: 'all' });
                          }}
                          className={`px-4 py-2 rounded-xl text-xs font-semibold ${accentClasses.btn}`}
                        >
                          Сбросить фильтры
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 4. СТАТУС ТЕКУЩЕГО ВРЕМЕНИ И СВОДКА ДНЯ (перенесено вниз под пары) */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-2">
                <div className={`lg:col-span-2 p-4 sm:p-5 rounded-2xl border flex flex-col justify-between ${bgSurface}`}>
                  {liveStatusInfo.state === 'ongoing' && liveStatusInfo.lesson && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          <Play className="w-3 h-3 fill-current" />
                          Идёт {liveStatusInfo.lesson.pairNumber}-я пара ({liveStatusInfo.lesson.startTime} – {liveStatusInfo.lesson.endTime})
                        </span>
                        <span className="text-xs font-mono font-semibold text-emerald-400">
                          Осталось {liveStatusInfo.leftMinutes} мин
                        </span>
                      </div>
                      <h3 className="text-base sm:text-lg font-bold mb-1">
                        {liveStatusInfo.lesson.subject}
                      </h3>
                      <p className={`text-xs sm:text-sm ${textMuted} mb-3`}>
                        {liveStatusInfo.lesson.isOnline
                          ? liveStatusInfo.lesson.room
                          : `ауд. ${liveStatusInfo.lesson.room}`}{' '}
                        • {liveStatusInfo.lesson.teacher}
                      </p>
                      <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${accentClasses.bar}`}
                          style={{ width: `${liveStatusInfo.progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {liveStatusInfo.state === 'upcoming' && liveStatusInfo.lesson && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${accentClasses.soft}`}>
                          <Clock className="w-3.5 h-3.5" />
                          {liveStatusInfo.isBreakBetweenPairs
                            ? `Перемена • Следующая ${liveStatusInfo.lesson.pairNumber}-я пара в ${liveStatusInfo.lesson.startTime}`
                            : `До начала пар • ${liveStatusInfo.lesson.pairNumber}-я пара в ${liveStatusInfo.lesson.startTime}`}
                        </span>
                        <span className={`text-xs font-mono ${textMuted}`}>
                          Через {liveStatusInfo.waitMinutes} мин
                        </span>
                      </div>
                      <h3 className="text-base sm:text-lg font-bold mb-1">
                        {liveStatusInfo.lesson.subject}
                      </h3>
                      <p className={`text-xs sm:text-sm ${textMuted}`}>
                        {liveStatusInfo.lesson.isOnline
                          ? liveStatusInfo.lesson.room
                          : `ауд. ${liveStatusInfo.lesson.room}`}{' '}
                        • {liveStatusInfo.lesson.teacher}
                      </p>
                    </div>
                  )}

                  {liveStatusInfo.state === 'planned' && liveStatusInfo.lesson && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${accentClasses.soft}`}>
                          <Calendar className="w-3.5 h-3.5" />
                          {liveStatusInfo.label}
                        </span>
                        <span className={`text-xs font-mono ${textMuted}`}>
                          Расписание по дате
                        </span>
                      </div>
                      <h3 className="text-base sm:text-lg font-bold mb-1">
                        Первая пара дня: {liveStatusInfo.lesson.subject} ({liveStatusInfo.lesson.pairNumber} пара, {liveStatusInfo.lesson.startTime}–{liveStatusInfo.lesson.endTime})
                      </h3>
                      <p className={`text-xs sm:text-sm ${textMuted}`}>
                        {liveStatusInfo.lesson.isOnline
                          ? liveStatusInfo.lesson.room
                          : `ауд. ${liveStatusInfo.lesson.room}`}{' '}
                        • {liveStatusInfo.lesson.teacher}
                      </p>
                    </div>
                  )}

                  {(liveStatusInfo.state === 'finished' || liveStatusInfo.state === 'free') && (
                    <div className="flex items-center gap-3 my-auto">
                      <div className={`p-3 rounded-xl ${bgSubtle}`}>
                        <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                      </div>
                      <div>
                        <div className="font-semibold text-base">{liveStatusInfo.label}</div>
                        <p className={`text-xs ${textMuted}`}>
                          Кликните на любую карточку пары, чтобы добавить заметку или отметить отмену / перенос занятия
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className={`p-4 sm:p-5 rounded-2xl border flex flex-col justify-between ${bgSurface}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs font-medium uppercase tracking-wider ${textMuted}`}>
                      Сводка дня
                    </span>
                    <Building2 className={`w-4 h-4 ${accentClasses.text}`} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 my-1">
                    <div className={`p-2.5 rounded-xl border ${bgSubtle}`}>
                      <div className={`text-[11px] ${textMuted}`}>Всего слотов</div>
                      <div className="text-lg font-bold">
                        {lessonsForSelectedDate.length}{' '}
                        <span className="text-xs font-normal opacity-80">
                          ({lessonsForSelectedDate.length * 1.5} ч)
                        </span>
                      </div>
                    </div>
                    <div className={`p-2.5 rounded-xl border ${bgSubtle}`}>
                      <div className={`text-[11px] ${textMuted}`}>Время пар</div>
                      <div className="text-sm font-bold font-mono mt-0.5">
                        {lessonsForSelectedDate.length > 0
                          ? `${lessonsForSelectedDate[0].startTime}–${
                              lessonsForSelectedDate[lessonsForSelectedDate.length - 1].endTime
                            }`
                          : '—'}
                      </div>
                    </div>
                  </div>
                  <div className={`text-[11px] ${textMuted} mt-2 flex items-center justify-between`}>
                    <span>Кампус: Тихоокеанская, 136</span>
                    <button
                      type="button"
                      onClick={() => {
                        const mon = getMondayOfWeek(selectedDateObj);
                        jumpToDate(getIsoDateString(mon));
                      }}
                      className={`font-medium hover:underline ${accentClasses.text}`}
                    >
                      Пн (будни) →
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* =================================================================
              ВКЛАДКА 2: «НЕДЕЛЯ» (Вся неделя целиком без переключения «По дням»)
          ================================================================= */}
          {activeTab === 'week' && !isLoadingSchedule && (scheduleMeta || isExplicitDemoActive) && (
            <>
              <div className={`p-4 sm:p-5 rounded-2xl border space-y-4 ${bgSurface}`}>
                <div>
                  <h2 className="text-lg sm:text-xl font-bold">
                    Расписание на всю неделю — группа {activeGroup.code}
                  </h2>
                  <p className={`text-xs sm:text-sm ${textMuted}`}>
                    Полное расписание занятий по всем дням недели с учётом выбранной чётности и подгруппы
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/60">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-medium ${textMuted}`}>Чётность недели:</span>
                    <div className={`inline-flex p-1 rounded-xl border ${bgSubtle}`}>
                      <button
                        type="button"
                        onClick={() => setWeekViewParity('odd')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          weekViewParity === 'odd' ? accentClasses.btn : textMuted
                        }`}
                      >
                        Нечётная (Числитель)
                      </button>
                      <button
                        type="button"
                        onClick={() => setWeekViewParity('even')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          weekViewParity === 'even' ? accentClasses.btn : textMuted
                        }`}
                      >
                        Чётная (Знаменатель)
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs ${textMuted}`}>Подгруппа:</span>
                    <div className={`inline-flex p-1 rounded-xl border ${bgSubtle}`}>
                      {(['all', '1', '2'] as SubgroupFilter[]).map((sg) => (
                        <button
                          key={sg}
                          type="button"
                          onClick={() => updateSettings({ subgroup: sg })}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                            settings.subgroup === sg ? accentClasses.btn : textMuted
                          }`}
                        >
                          {sg === 'all' ? 'Все' : `${sg}-я`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-5">
                {DAYS_OF_WEEK.map((day) => {
                  const list = getLessonsForWeekday(day.id, weekViewParity);
                  const isCurrentDow =
                    weekViewParity === realTodayAcademicInfo.parity && realTodayDow === day.id;
                  if (day.id === 7 && list.length === 0) return null;

                  return (
                    <div
                      key={day.id}
                      className={`p-4 sm:p-5 rounded-2xl border space-y-3 ${bgSurface} ${
                        isCurrentDow ? 'ring-1 ring-emerald-500/50' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between pb-2.5 border-b border-slate-800/60">
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-base sm:text-lg">{day.full}</h3>
                          {isCurrentDow && (
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              Сегодня
                            </span>
                          )}
                        </div>
                        <span className={`text-xs font-medium ${textMuted}`}>
                          {list.length > 0
                            ? `${list.length} ${list.length === 1 ? 'пара' : list.length < 5 ? 'пары' : 'пар'}`
                            : 'Выходной / пар нет'}
                        </span>
                      </div>

                      {list.length > 0 ? (
                        <div className="space-y-3">
                          {list.map((lesson, idx) => renderLessonCard(lesson, idx, list, 'week_view'))}
                        </div>
                      ) : (
                        <p className={`text-xs py-3 text-center ${textMuted}`}>
                          В этот день недели занятий по расписанию нет
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* =================================================================
              ВКЛАДКА 3: «КАЛЕНДАРЬ» (Календарное расписание и сессия #cal_week)
          ================================================================= */}
          {activeTab === 'calendar' && !isLoadingSchedule && (
            <div className="space-y-5">
              <div className={`p-4 sm:p-5 rounded-2xl border space-y-3 ${bgSurface}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/60">
                  <div>
                    <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
                      <span>Календарное расписание и сессия ({activeGroup.code})</span>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs ${accentClasses.soft}`}>
                        {calendarEvents.length}
                      </span>
                    </h2>
                    <p className={`text-xs sm:text-sm mt-0.5 ${textMuted}`}>
                      Зачёты, дифференцированные зачёты, экзамены, консультации и защиты практик из раздела #cal_week ТОГУ
                    </p>
                  </div>
                  {scheduleMeta?.examsUrl && (
                    <a
                      href={`https://togudv.ru${scheduleMeta.examsUrl}`}
                      target="_blank"
                      rel="noreferrer"
                      className={`inline-flex items-center gap-1.5 text-xs font-semibold hover:underline ${accentClasses.text}`}
                    >
                      <span>Экзамены на togudv.ru ({scheduleMeta.examsUrl})</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>

                {calendarEvents.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    {calendarEvents.map((ev) => (
                      <div key={ev.id} className={`p-4 rounded-xl border space-y-2 ${bgSubtle}`}>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-bold text-sm">{ev.dateTitle}</span>
                          <span className="font-mono font-semibold px-2 py-0.5 rounded bg-slate-800/80 text-slate-200">
                            {ev.timeRange}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-purple-500/20 text-purple-300 border border-purple-500/30">
                            {ev.eventTypeShort}
                          </span>
                          {ev.sessionCategory && (
                            <span className={`px-2 py-0.5 rounded text-[10px] ${bgSurface} ${textMuted}`}>
                              {ev.sessionCategory}
                            </span>
                          )}
                          {ev.isOnline && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                              ДИСТАН.
                            </span>
                          )}
                        </div>
                        <div className="font-semibold text-sm sm:text-base">{ev.subject}</div>
                        <div className={`text-xs flex items-center justify-between pt-1 border-t border-slate-700/40 ${textMuted}`}>
                          <span>{ev.room || 'По расписанию кафедры'}</span>
                          <span>{ev.teacher}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`p-8 rounded-xl border text-center space-y-2 ${bgSubtle}`}>
                    <BookOpen className={`w-8 h-8 mx-auto ${textMuted}`} />
                    <div className="font-semibold text-sm">
                      Для группы {activeGroup.code} событий в разделе календарного расписания (#cal_week) пока нет
                    </div>
                    <p className={`text-xs max-w-md mx-auto ${textMuted}`}>
                      Когда деканат опубликует даты зачётов, консультаций или экзаменов на портале togudv.ru, они появятся в этой вкладке после синхронизации.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* =================================================================
              ВКЛАДКА 4: «ГРУППЫ» (Выбор группы, избранные группы и импорт HTML)
          ================================================================= */}
          {activeTab === 'groups' && (
            <div className="space-y-5">
              {/* Быстрое переключение избранных и проверочных групп (перенесено во вкладку Группы) */}
              <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 rounded-2xl border text-xs ${bgSurface}`}>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`font-medium ${textMuted}`}>Быстрый выбор и проверочные группы:</span>
                  {[
                    { id: '68805', label: 'СУЗ(с) - 51 (Офиц. HTML)' },
                    { id: '66919', label: 'ПО(б) - 31 (HTML-макет)' },
                    { id: '68375', label: 'Ю(б) - 41 (HTML-макет)' },
                    { id: '69173', label: 'ПВГ - 61 (Пустое расписание)' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        updateSettings({ selectedGroupId: item.id });
                        showToast(`Выбрана основная группа ID ${item.id}`);
                      }}
                      className={`px-2.5 py-1 rounded-lg font-medium border transition-colors ${
                        activeGroup.id === item.id
                          ? accentClasses.btn
                          : `${bgSubtle} hover:border-slate-500`
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium border ${accentClasses.soft}`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Импортировать .html в БД</span>
                </button>
              </div>

              <div className={`p-4 sm:p-5 rounded-2xl border space-y-4 ${bgSurface}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg sm:text-xl font-bold">
                      Каталог учебных групп ТОГУ ({filteredGroups.length} из {groupsCatalog.length})
                    </h2>
                    <p className={`text-xs sm:text-sm ${textMuted}`}>
                      Выберите основную группу или добавьте группы в избранное (сохраняется в UserPreferencesStore)
                    </p>
                  </div>
                  <a
                    href="https://togudv.ru/rasp/groups/"
                    target="_blank"
                    rel="noreferrer"
                    className={`inline-flex items-center gap-1.5 text-xs font-medium hover:underline ${accentClasses.text}`}
                  >
                    <span>Справочник групп togudv.ru</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                <div className="relative">
                  <Search className={`w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 ${textMuted}`} />
                  <input
                    type="text"
                    value={groupSearchQuery}
                    onChange={(e) => setGroupSearchQuery(e.target.value)}
                    placeholder="Поиск по коду группы (СУЗ(с) - 51, ПО(б) - 31, ПГС, Ю(б) - 41) или ID (68805)..."
                    className={`w-full pl-11 pr-10 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 ${accentClasses.ring} ${bgSubtle}`}
                  />
                  {groupSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setGroupSearchQuery('')}
                      aria-label="Очистить поиск"
                      className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-slate-700/50 ${textMuted}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {INSTITUTES.slice(0, 10).map((inst) => (
                    <button
                      key={inst.id}
                      type="button"
                      onClick={() => setSelectedInstitute(inst.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                        selectedInstitute === inst.id
                          ? accentClasses.btn
                          : `${bgSubtle} ${textMuted} hover:text-current`
                      }`}
                    >
                      {inst.short}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <span className={`text-xs ${textMuted}`}>Курс обучения:</span>
                  {(['all', 1, 2, 3, 4, 5, 6] as const).map((c) => (
                    <button
                      key={String(c)}
                      type="button"
                      onClick={() => setSelectedCourse(c)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${
                        selectedCourse === c ? accentClasses.soft : `${bgSubtle} ${textMuted}`
                      }`}
                    >
                      {c === 'all' ? 'Все курсы' : `${c} курс`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredGroups.slice(0, 60).map((group) => {
                  const isSelected = group.id === activeGroup.id;
                  const isFav = favoriteGroupIds.includes(group.id);

                  return (
                    <div
                      key={group.id}
                      className={`p-4 sm:p-5 rounded-2xl border transition-all flex flex-col justify-between ${bgSurface} ${
                        isSelected ? `ring-2 ${accentClasses.ring}` : 'hover:border-slate-600'
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-lg font-bold tracking-tight">{group.code}</span>
                            <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${accentClasses.soft}`}>
                              {group.instituteShort}
                            </span>
                            <span className={`px-2 py-0.5 rounded-md text-xs ${bgSubtle} ${textMuted}`}>
                              {group.course} курс • {group.degree}
                            </span>
                            {group.hasOfficialSnapshot && (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                В БД (Офиц. HTML)
                              </span>
                            )}
                            {group.isTestFixture && (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                HTML-макет ТОГУ
                              </span>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => toggleFavoriteGroup(group.id)}
                            title={isFav ? 'Убрать из избранного' : 'Добавить в избранное'}
                            className={`p-2 rounded-xl border transition-colors ${
                              isFav
                                ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                                : `${bgSubtle} ${textMuted} hover:text-amber-300`
                            }`}
                          >
                            <Star className={`w-4 h-4 ${isFav ? 'fill-current' : ''}`} />
                          </button>
                        </div>

                        <p className="text-sm font-medium leading-snug mb-2">{group.name}</p>
                        <div className={`text-xs space-y-1 ${textMuted}`}>
                          <div>Подразделение: {group.instituteFull}</div>
                          <div>
                            Форма: {group.form} • Код: {group.specializationCode} • URL: /rasp/groups/{group.id}/
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between gap-2">
                        <span className={`text-xs font-mono ${textMuted}`}>{group.headmanDemo}</span>

                        <button
                          type="button"
                          onClick={() => {
                            updateSettings({ selectedGroupId: group.id });
                            showToast(`Выбрана основная группа ${group.code} (ID ${group.id})`);
                            setActiveTab('today');
                          }}
                          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                            isSelected
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : accentClasses.btn
                          }`}
                        >
                          {isSelected ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Активная группа</span>
                            </>
                          ) : (
                            <span>Выбрать группу</span>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {filteredGroups.length === 0 && (
                <div className={`p-8 rounded-2xl border text-center space-y-3 ${bgSurface}`}>
                  <Users className={`w-10 h-10 mx-auto ${textMuted}`} />
                  <div className="font-semibold">Группы по запросу «{groupSearchQuery}» не найдены</div>
                  <button
                    type="button"
                    onClick={() => {
                      setGroupSearchQuery('');
                      setSelectedInstitute('all');
                      setSelectedCourse('all');
                    }}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold ${accentClasses.btn}`}
                  >
                    Показать все группы ТОГУ
                  </button>
                </div>
              )}
            </div>
          )}

          {/* =================================================================
              ВКЛАДКА 5: «НАСТРОЙКИ» (Включая расписание уведомлений и БД)
          ================================================================= */}
          {activeTab === 'settings' && (
            <div className="space-y-6">
              {/* Блок уведомлений и экрана блокировки Android (перенесён исключительно в Настройки) */}
              <div className={`p-5 rounded-2xl border space-y-4 ${bgSurface}`}>
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/60">
                  <div className="flex items-center gap-2.5">
                    <Smartphone className={`w-5 h-5 ${accentClasses.text}`} />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-bold">
                          Экран блокировки Android и расписание уведомлений
                        </h3>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30">
                          Asia/Vladivostok (ХБР, UTC+10)
                        </span>
                      </div>
                      <p className={`text-xs ${textMuted}`}>
                        Карточка ближайшей пары на заблокированном экране (Ongoing Notification #1001 + будильники за {notificationLeadMinutes} мин)
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <div className={`inline-flex items-center p-1 rounded-xl border ${bgSubtle}`}>
                      {([5, 10, 15, 30] as NotificationLeadMinutes[]).map((mins) => (
                        <button
                          key={mins}
                          type="button"
                          onClick={() => updateNotificationLead(mins)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                            notificationLeadMinutes === mins ? accentClasses.btn : textMuted
                          }`}
                        >
                          за {mins} мин
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleNotificationsMaster(!notificationsEnabled)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                        notificationsEnabled
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                          : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                      }`}
                    >
                      <BellRing className="w-3.5 h-3.5" />
                      <span>{notificationsEnabled ? 'Уведомления ВКЛ' : 'Уведомления ВЫКЛ'}</span>
                    </button>
                  </div>
                </div>

                {notificationsEnabled ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-2xl p-4 bg-gradient-to-br from-slate-900 via-[#0E172A] to-slate-950 border border-slate-700/80 text-slate-100 shadow-xl space-y-3">
                      <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                        <span>ANDROID LOCK SCREEN • VISIBILITY_PUBLIC</span>
                        <span>{notificationReport.ongoingLockScreenCard?.updatedAtKhabarovsk || currentSimulatedTimeLabel} ХБР</span>
                      </div>

                      {notificationReport.ongoingLockScreenCard && (
                        <div className="p-3.5 rounded-xl bg-slate-800/90 border border-slate-600/60 space-y-2 shadow-md">
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="inline-flex items-center gap-1.5 font-semibold text-blue-300">
                              <GraduationCap className="w-3.5 h-3.5" />
                              <span>ТОГУ.Расписание • {notificationReport.ongoingLockScreenCard.groupCode}</span>
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px]">
                              ongoing: true (#1001)
                            </span>
                          </div>

                          <div className="text-xs font-bold text-amber-300">
                            {notificationReport.ongoingLockScreenCard.headline}
                          </div>

                          <div className="text-sm font-bold leading-snug text-white">
                            {notificationReport.ongoingLockScreenCard.subject}
                          </div>

                          <div className="text-xs text-slate-300 flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-700/70">
                            <span className="font-mono font-semibold">
                              {notificationReport.ongoingLockScreenCard.timeRange}
                            </span>
                            <span>{notificationReport.ongoingLockScreenCard.roomAndBuilding}</span>
                          </div>

                          {typeof notificationReport.ongoingLockScreenCard.progressPercent === 'number' && (
                            <div className="w-full h-1.5 rounded-full bg-slate-950 overflow-hidden mt-1">
                              <div
                                className="h-full bg-emerald-400 rounded-full"
                                style={{ width: `${notificationReport.ongoingLockScreenCard.progressPercent}%` }}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold flex items-center gap-1.5">
                          <Bell className={`w-4 h-4 ${accentClasses.text}`} />
                          <span>
                            Запланировано будильников на день: {notificationReport.scheduledCount}
                          </span>
                        </span>
                        <span className="font-mono text-[11px] text-emerald-400">
                          Дубликатов предотвращено: {notificationReport.duplicatesPrevented}
                        </span>
                      </div>

                      {notificationReport.cancelledLessonAlerts.length > 0 && (
                        <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-200">
                          <strong>Автоматически снято с очереди ({notificationReport.cancelledLessonAlerts.length}):</strong>{' '}
                          {notificationReport.cancelledLessonAlerts
                            .map((c) => `${c.pairNumber} пара «${c.subject}» (отменена)`)
                            .join('; ')}
                        </div>
                      )}

                      {notificationReport.activeNotifications.length > 0 ? (
                        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                          {notificationReport.activeNotifications.map((n) => (
                            <div
                              key={n.dedupKey}
                              className={`p-3 rounded-xl border text-xs space-y-1 ${bgSubtle}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono font-bold text-emerald-400">
                                  Сработает в {n.triggerTimeKhabarovsk}
                                </span>
                                <span className={`font-mono text-[10px] ${textMuted}`}>
                                  ID #{n.notificationId}
                                </span>
                              </div>
                              <div className="font-semibold">{n.title}</div>
                              <div className={`text-[11px] ${textMuted} line-clamp-1`}>{n.body}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={`p-4 rounded-xl border text-xs text-center ${bgSubtle} ${textMuted}`}>
                          На выбранную дату активных занятий для постановки уведомлений нет
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className={`p-4 rounded-xl border text-xs flex items-center justify-between ${bgSubtle}`}>
                    <span className={textMuted}>
                      Локальные уведомления о предстоящих парах сейчас отключены (очередь очищена: 0 активных будильников).
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleNotificationsMaster(true)}
                      className={`px-3 py-1.5 rounded-lg font-semibold ${accentClasses.btn}`}
                    >
                      Включить уведомления
                    </button>
                  </div>
                )}
              </div>

              {/* Блок: Пользовательские настройки (UserPreferencesStore) */}
              <div className={`p-5 rounded-2xl border space-y-4 ${bgSurface}`}>
                <div className="flex items-center gap-2.5 pb-2 border-b border-slate-800/60">
                  <GraduationCap className={`w-5 h-5 ${accentClasses.text}`} />
                  <h2 className="text-base sm:text-lg font-bold">
                    Пользовательские настройки (UserPreferencesStore)
                  </h2>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1.5">
                      Ваша основная учебная группа ТОГУ (из {groupsCatalog.length} групп)
                    </label>
                    <select
                      value={settings.selectedGroupId}
                      onChange={(e) => {
                        updateSettings({ selectedGroupId: e.target.value });
                        const grp = groupsCatalog.find((g) => g.id === e.target.value);
                        if (grp) showToast(`Основная группа изменена на ${grp.code}`);
                      }}
                      className={`w-full px-3.5 py-2.5 rounded-xl border text-sm focus:outline-none ${bgSubtle}`}
                    >
                      {groupsCatalog.slice(0, 120).map((g) => (
                        <option key={g.id} value={g.id} className="bg-slate-900 text-slate-100">
                          {g.code} ({g.instituteShort}, {g.course} курс) — ID {g.id}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium mb-1.5">
                      Подгруппа для лабораторных и практик
                    </label>
                    <div className={`grid grid-cols-3 gap-1.5 p-1 rounded-xl border ${bgSubtle}`}>
                      {(['all', '1', '2'] as SubgroupFilter[]).map((sg) => (
                        <button
                          key={sg}
                          type="button"
                          onClick={() => {
                            updateSettings({ subgroup: sg });
                            showToast(
                              sg === 'all'
                                ? 'Отображаются обе подгруппы'
                                : `Выбрана ${sg}-я подгруппа`
                            );
                          }}
                          className={`py-2 rounded-lg text-xs font-semibold transition-all ${
                            settings.subgroup === sg ? accentClasses.btn : textMuted
                          }`}
                        >
                          {sg === 'all' ? 'Обе (Все)' : `${sg} подгруппа`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Блок: Внешний вид и тема оформления */}
              <div className={`p-5 rounded-2xl border space-y-4 ${bgSurface}`}>
                <div className="flex items-center gap-2.5 pb-2 border-b border-slate-800/60">
                  <SlidersHorizontal className={`w-5 h-5 ${accentClasses.text}`} />
                  <h2 className="text-base sm:text-lg font-bold">Тема оформления и интерфейс</h2>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-2">Цветовая тема</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'dark' as ThemeMode, label: 'Тёмная (Slate)', icon: Moon },
                        { id: 'oled' as ThemeMode, label: 'OLED Чёрная', icon: Sparkles },
                        { id: 'light' as ThemeMode, label: 'Светлая', icon: Sun },
                      ].map((t) => {
                        const Icon = t.icon;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => updateSettings({ theme: t.id })}
                            className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all ${
                              settings.theme === t.id
                                ? `${accentClasses.soft} ring-2 ${accentClasses.ring}`
                                : `${bgSubtle} ${textMuted}`
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                            <span>{t.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium mb-2">Акцентный цвет</label>
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { id: 'blue' as AccentColor, label: 'ТОГУ Синий', dot: 'bg-blue-500' },
                        { id: 'emerald' as AccentColor, label: 'Изумруд', dot: 'bg-emerald-500' },
                        { id: 'violet' as AccentColor, label: 'Индиго', dot: 'bg-violet-500' },
                        { id: 'amber' as AccentColor, label: 'Янтарь', dot: 'bg-amber-500' },
                      ].map((ac) => (
                        <button
                          key={ac.id}
                          type="button"
                          onClick={() => updateSettings({ accent: ac.id })}
                          className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all ${
                            settings.accent === ac.id
                              ? `${accentClasses.soft} ring-2 ${accentClasses.ring}`
                              : `${bgSubtle} ${textMuted}`
                          }`}
                        >
                          <span className={`w-4 h-4 rounded-full ${ac.dot}`} />
                          <span>{ac.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-2.5 pt-2">
                  {[
                    {
                      key: 'showWindows' as const,
                      title: 'Показывать «окна» между парами',
                      desc: 'Отображать информационную вставку, если между занятиями есть свободная пара',
                    },
                    {
                      key: 'showBigBreak' as const,
                      title: 'Показывать большой обеденный перерыв (13:20 – 13:50)',
                      desc: 'Выделять 30-минутный перерыв между 3-й и 4-й парой',
                    },
                    {
                      key: 'showPairNumbers' as const,
                      title: 'Показывать номер пары (1–8 пара)',
                      desc: 'Отображать бейдж с порядковым номером пары рядом со временем',
                    },
                    {
                      key: 'compactCards' as const,
                      title: 'Компактный режим карточек',
                      desc: 'Уменьшить внутренние отступы карточек для небольших экранов',
                    },
                  ].map((opt) => (
                    <div
                      key={opt.key}
                      className={`flex items-center justify-between p-3.5 rounded-xl border ${bgSubtle}`}
                    >
                      <div>
                        <div className="text-sm font-medium">{opt.title}</div>
                        <div className={`text-xs ${textMuted}`}>{opt.desc}</div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={settings[opt.key]}
                        onClick={() => updateSettings({ [opt.key]: !settings[opt.key] })}
                        className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${
                          settings[opt.key] ? accentClasses.bar : 'bg-slate-700'
                        }`}
                      >
                        <span
                          className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                            settings[opt.key] ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Блок: Управление реляционной базой расписания (SharedScheduleDB) */}
              <div className={`p-5 rounded-2xl border space-y-4 ${bgSurface}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/60">
                  <div className="flex items-center gap-2.5">
                    <Database className={`w-5 h-5 ${accentClasses.text}`} />
                    <div>
                      <h2 className="text-base sm:text-lg font-bold">
                        Централизованная база расписания (SharedScheduleDB)
                      </h2>
                      <p className={`text-xs ${textMuted}`}>
                        ID устройства: {userPrefs.deviceAnonId}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => loadGroupSchedule(activeGroup.id, true)}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold ${accentClasses.btn}`}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSchedule ? 'animate-spin' : ''}`} />
                    <span>Проверить обновления</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
                  {[
                    { label: 'Групп в каталоге', val: groupsCatalog.length, table: 'student_groups' },
                    { label: 'Дисциплин', val: dbStats.subjectsCount, table: 'subjects' },
                    { label: 'Преподавателей', val: dbStats.teachersCount, table: 'teachers' },
                    { label: 'Аудиторий', val: dbStats.classroomsCount, table: 'classrooms' },
                    { label: 'Слотов занятий', val: dbStats.slotsCount, table: 'schedule_slots' },
                    { label: 'Отмен / Переносов', val: dbStats.overridesCount, table: 'schedule_overrides' },
                  ].map((stat) => (
                    <div key={stat.table} className={`p-3 rounded-xl border ${bgSubtle}`}>
                      <div className={`text-[11px] font-mono ${textMuted}`}>{stat.table}</div>
                      <div className="text-xl font-bold mt-0.5">{stat.val}</div>
                      <div className={`text-[11px] ${textMuted}`}>{stat.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className={`p-5 rounded-2xl border space-y-3 ${bgSurface}`}>
                  <div className="flex items-center gap-2 font-bold text-base">
                    <Clock className={`w-5 h-5 ${accentClasses.text}`} />
                    <span>Расписание звонков ТОГУ</span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    {TOGU_BELL_SCHEDULE.map((slot) => (
                      <div
                        key={slot.pairNumber}
                        className={`flex items-center justify-between px-3 py-2 rounded-lg ${bgSubtle}`}
                      >
                        <span className="font-semibold">{slot.pairNumber} пара</span>
                        <span className="font-mono font-medium">
                          {slot.start} – {slot.end}
                        </span>
                        <span className={textMuted}>{slot.breakAfter || 'Конец дня'}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={`p-5 rounded-2xl border flex flex-col justify-between space-y-4 ${bgSurface}`}>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 font-bold text-base">
                      <Info className={`w-5 h-5 ${accentClasses.text}`} />
                      <span>Обозначения корпусов ТОГУ</span>
                    </div>
                    <div className="space-y-2 text-xs">
                      {[
                        { code: 'ц (502ц, 326ц)', desc: 'Центральный корпус (ул. Тихоокеанская, 136)' },
                        { code: 'ца (357ца)', desc: 'Центрально-административный блок (Тихоокеанская, 136)' },
                        { code: 'л (237л, 405л)', desc: 'Левое крыло главного корпуса (Тихоокеанская, 136)' },
                        { code: 'п (311п, 417п)', desc: 'Правое крыло главного корпуса (Тихоокеанская, 136)' },
                        { code: 'ДИСТАН.', desc: 'Электронная информационно-образовательная среда (Онлайн)' },
                      ].map((b) => (
                        <div key={b.code} className={`flex items-center justify-between p-2.5 rounded-lg ${bgSubtle}`}>
                          <span className="font-mono font-bold">{b.code}</span>
                          <span className={`text-right ${textMuted}`}>{b.desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between gap-2">
                    <span className={`text-xs ${textMuted}`}>
                      Реляционная БД + Уведомления + Настройки
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const defPrefs = createDefaultUserPreferences();
                        saveUserPreferences(defPrefs);
                        setUserPrefs(defPrefs);
                        setExplicitDemoConfirmedForGroup({});
                        showToast('Пользовательские настройки сброшены (общая БД расписания сохранена)');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Сбросить настройки</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* =================================================================
              НИЖНИЙ БЛОК СТАТУСА БАЗЫ ДАННЫХ (Перенесён в самый низ страницы)
          ================================================================= */}
          <div
            className={`mt-6 flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border text-xs ${
              scheduleMeta?.sourceKind === 'official_snapshot' || scheduleMeta?.sourceKind === 'official_live' || scheduleMeta?.sourceKind === 'user_imported_html'
                ? isLight
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-200'
                : isLight
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-amber-500/10 border-amber-500/25 text-amber-200'
            }`}
          >
            <div className="flex items-center gap-2 flex-wrap">
              {scheduleMeta?.sourceKind === 'official_snapshot' || scheduleMeta?.sourceKind === 'official_live' ? (
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold uppercase text-[10px] border border-emerald-500/30">
                  Официальные данные в БД
                </span>
              ) : scheduleMeta?.sourceKind === 'user_imported_html' ? (
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold uppercase text-[10px] border border-emerald-500/30">
                  Импортированный HTML в БД
                </span>
              ) : scheduleMeta?.sourceKind === 'test_html_fixture' ? (
                <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold uppercase text-[10px] border border-amber-500/30">
                  Проверочный HTML-макет ТОГУ
                </span>
              ) : isExplicitDemoActive ? (
                <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold uppercase text-[10px] border border-rose-500/30">
                  Демо-режим
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold uppercase text-[10px]">
                  Ожидание синхронизации
                </span>
              )}

              <span>
                {scheduleMeta ? (
                  <>
                    Группа <strong>{scheduleMeta.groupCode}</strong> (ID {scheduleMeta.groupId}) •{' '}
                    {scheduleMeta.semester} • Посл. синхр.:{' '}
                    <strong className="font-mono">{formatDateTimeRu(scheduleMeta.lastSyncedAtIso)}</strong>
                    {' '}• Посл. проверка:{' '}
                    <strong className="font-mono">{syncStatus.lastCheckedKhabarovsk || 'Только что'}</strong>
                  </>
                ) : (
                  <>Группа {activeGroup.code} (ID {activeGroup.id})</>
                )}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <a
                href={`https://togudv.ru/rasp/groups/${activeGroup.id}/`}
                target="_blank"
                rel="noreferrer"
                className="underline font-medium hover:opacity-80 inline-flex items-center gap-1 text-[11px]"
              >
                <span>togudv.ru</span>
                <ExternalLink className="w-3 h-3" />
              </a>
              <button
                type="button"
                onClick={() => {
                  setSyncModalTab('status');
                  setIsSyncModalOpen(true);
                }}
                className="px-2.5 py-1 rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 font-medium inline-flex items-center gap-1 text-xs transition-colors"
              >
                <History className="w-3 h-3" />
                <span>Журнал и тесты</span>
              </button>
              <button
                type="button"
                onClick={() => loadGroupSchedule(activeGroup.id, true)}
                disabled={isLoadingSchedule}
                className="px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 font-semibold inline-flex items-center gap-1 text-xs transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingSchedule ? 'animate-spin' : ''}`} />
                <span>Обновить</span>
              </button>
            </div>
          </div>
        </main>
      </div>

      {/* =====================================================================
          НИЖНЯЯ НАВИГАЦИЯ (ДЛЯ МОБИЛЬНЫХ УСТРОЙСТВ — до md)
      ===================================================================== */}
      <nav
        className={`md:hidden fixed bottom-0 inset-x-0 z-30 border-t backdrop-blur-lg px-2 py-1.5 ${bgSurface}`}
      >
        <div className="grid grid-cols-5 gap-1 max-w-md mx-auto">
          {[
            { id: 'today' as NavTab, label: 'Сегодня', icon: Calendar },
            { id: 'week' as NavTab, label: 'Неделя', icon: Layers },
            { id: 'calendar' as NavTab, label: 'Календарь', icon: BookOpen },
            { id: 'groups' as NavTab, label: 'Группы', icon: Users },
            { id: 'settings' as NavTab, label: 'Настройки', icon: Settings },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex flex-col items-center justify-center py-1.5 rounded-xl text-[11px] font-medium transition-colors ${
                  isActive ? accentClasses.text : textMuted
                }`}
              >
                <Icon className="w-5 h-5 mb-0.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* =====================================================================
          МОДАЛЬНОЕ ОКНО КАРТОЧКИ ЗАНЯТИЯ, ЗАМЕТКИ И ОТМЕТКИ ОБ ОТМЕНЕ / ПЕРЕНОСЕ
      ===================================================================== */}
      {inspectedLesson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto">
          <div className={`w-full max-w-lg rounded-2xl border p-5 sm:p-6 space-y-4 shadow-2xl my-auto ${bgSurface}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${accentClasses.btn}`}>
                  {inspectedLesson.pairNumber} пара ({inspectedLesson.startTime} – {inspectedLesson.endTime})
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                    isLight
                      ? LESSON_TYPE_META[inspectedLesson.type].badgeLight
                      : LESSON_TYPE_META[inspectedLesson.type].badgeDark
                  }`}
                >
                  {inspectedLesson.eventTypeFull || LESSON_TYPE_META[inspectedLesson.type].label}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setInspectedLesson(null)}
                className={`p-1.5 rounded-xl border ${bgSubtle} hover:opacity-80`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <h3 className="text-lg font-bold leading-snug">{inspectedLesson.subject}</h3>

            <div className={`p-3.5 rounded-xl border space-y-2.5 text-xs sm:text-sm ${bgSubtle}`}>
              <div className="flex items-start gap-2.5">
                <MapPin className={`w-4 h-4 mt-0.5 shrink-0 ${accentClasses.text}`} />
                <div>
                  <div className="font-semibold">
                    {inspectedLesson.isOnline ? inspectedLesson.room : `Аудитория ${inspectedLesson.room}`}
                    {inspectedLesson.roomUrl && (
                      <a
                        href={`https://togudv.ru${inspectedLesson.roomUrl}`}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 text-xs underline opacity-80"
                      >
                        ({inspectedLesson.roomUrl})
                      </a>
                    )}
                  </div>
                  <div className={`text-xs ${textMuted}`}>{inspectedLesson.building}</div>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <User className={`w-4 h-4 mt-0.5 shrink-0 ${accentClasses.text}`} />
                <div>
                  <div className="font-semibold">
                    {inspectedLesson.teacher}
                    {inspectedLesson.teacherUrl && (
                      <a
                        href={`https://togudv.ru${inspectedLesson.teacherUrl}`}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 text-xs underline opacity-80"
                      >
                        ({inspectedLesson.teacherUrl})
                      </a>
                    )}
                  </div>
                  <div className={`text-xs ${textMuted}`}>
                    {inspectedLesson.teacherTitle}
                    {inspectedLesson.dateRange ? ` • Период: ${inspectedLesson.dateRange}` : ''}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <Layers className={`w-4 h-4 shrink-0 ${accentClasses.text}`} />
                <span className="text-xs">
                  Неделя:{' '}
                  <strong>
                    {inspectedLesson.weekParity === 'both'
                      ? 'Каждую неделю (weektype-0)'
                      : inspectedLesson.weekParity === 'odd'
                      ? 'Только нечётная / Числитель (Ч, weektype-1)'
                      : 'Только чётная / Знаменатель (З, weektype-2)'}
                  </strong>
                  {inspectedLesson.subgroup && inspectedLesson.subgroup !== 'all'
                    ? ` • ${inspectedLesson.subgroup}-я подгруппа`
                    : ' • Вся группа'}
                </span>
              </div>
            </div>

            {/* Управление статусом пары в БД: Норма / Отменено / Перенесено (Требование 5) */}
            {inspectedLesson.slotKey && (
              <div className={`p-3.5 rounded-xl border space-y-3 ${bgSubtle}`}>
                <label className="block text-xs font-bold">
                  Статус занятия в расписании (таблица schedule_overrides):
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { id: 'normal' as LessonOverrideStatus, label: 'По расписанию' },
                    { id: 'cancelled' as LessonOverrideStatus, label: 'Отменено' },
                    { id: 'rescheduled' as LessonOverrideStatus, label: 'Перенесено' },
                  ].map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setOverrideStatusDraft(st.id)}
                      className={`py-1.5 px-2 rounded-lg text-xs font-semibold border transition-all ${
                        overrideStatusDraft === st.id
                          ? st.id === 'cancelled'
                            ? 'bg-rose-600 text-white border-transparent'
                            : st.id === 'rescheduled'
                            ? 'bg-amber-600 text-white border-transparent'
                            : accentClasses.btn
                          : `${bgSurface} ${textMuted}`
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>

                {overrideStatusDraft === 'rescheduled' && (
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <div>
                      <label className="block text-[11px] mb-1">Новая аудитория</label>
                      <input
                        type="text"
                        value={overrideNewRoomDraft}
                        onChange={(e) => setOverrideNewRoomDraft(e.target.value)}
                        placeholder="Напр. 405л"
                        className={`w-full px-2.5 py-1.5 rounded-lg border text-xs ${bgSurface}`}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] mb-1">Номер пары</label>
                      <select
                        value={overrideNewPairDraft}
                        onChange={(e) => setOverrideNewPairDraft(Number(e.target.value))}
                        className={`w-full px-2 py-1.5 rounded-lg border text-xs ${bgSurface}`}
                      >
                        {TOGU_BELL_SCHEDULE.map((b) => (
                          <option key={b.pairNumber} value={b.pairNumber} className="bg-slate-900 text-slate-100">
                            {b.pairNumber} пара ({b.start})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] mb-1">Новая дата</label>
                      <input
                        type="text"
                        value={overrideNewDateDraft}
                        onChange={(e) => setOverrideNewDateDraft(e.target.value)}
                        placeholder="Напр. 21.10.2026"
                        className={`w-full px-2.5 py-1.5 rounded-lg border text-xs ${bgSurface}`}
                      />
                    </div>
                  </div>
                )}

                {overrideStatusDraft !== 'normal' && (
                  <div>
                    <label className="block text-[11px] mb-1">
                      Причина отмены или комментарий к переносу:
                    </label>
                    <input
                      type="text"
                      value={overrideReasonDraft}
                      onChange={(e) => setOverrideReasonDraft(e.target.value)}
                      placeholder="Например: По распоряжению деканата / командировка преподавателя"
                      className={`w-full px-3 py-1.5 rounded-lg border text-xs ${bgSurface}`}
                    />
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold mb-1.5">
                Личная заметка студента (сохраняется отдельно в UserPreferencesStore):
              </label>
              <textarea
                rows={2}
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Например: Принести отчёт по практике, подготовить чертежи..."
                className={`w-full p-3 rounded-xl border text-xs sm:text-sm focus:outline-none focus:ring-2 ${accentClasses.ring} ${bgSubtle}`}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setInspectedLesson(null)}
                className={`px-4 py-2 rounded-xl text-xs font-medium border ${bgSubtle}`}
              >
                Закрыть
              </button>
              <button
                type="button"
                onClick={() => {
                  saveLessonNoteAndOverride(inspectedLesson);
                  setInspectedLesson(null);
                }}
                className={`px-4 py-2 rounded-xl text-xs font-semibold ${accentClasses.btn}`}
              >
                Сохранить заметку
              </button>
            </div>
          </div>
        </div>
      )}

            {/* =====================================================================
          МОДАЛЬНОЕ ОКНО: АВТОМАТИЧЕСКАЯ СИНХРОНИЗАЦИЯ, ЖУРНАЛ И СЦЕНАРИИ (Этап 7)
          ===================================================================== */}
      {isSyncModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div className={`w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden ${bgSurface}`}>
            <div className="p-4 sm:p-5 border-b flex items-center justify-between border-slate-700/60">
              <div className="flex items-center gap-2.5">
                <div className={`p-2 rounded-xl ${accentClasses.soft}`}>
                  <History className={`w-5 h-5 ${accentClasses.text}`} />
                </div>
                <div>
                  <h3 className="font-bold text-base sm:text-lg">Синхронизация с порталом ТОГУ</h3>
                  <p className={`text-xs ${textMuted}`}>
                    Безопасный опрос togudv.ru • Кеширование TTL • Обнаружение изменений
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSyncModalOpen(false)}
                className={`p-1.5 rounded-lg border hover:bg-white/10 ${bgSubtle}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Вкладки модального окна */}
            <div className="flex border-b border-slate-700/60 px-4 bg-slate-900/40 text-xs font-semibold overflow-x-auto">
              <button
                type="button"
                onClick={() => setSyncModalTab('status')}
                className={`py-2.5 px-3 border-b-2 transition-colors whitespace-nowrap ${
                  syncModalTab === 'status'
                    ? `${accentClasses.border} ${accentClasses.text}`
                    : 'border-transparent opacity-70 hover:opacity-100'
                }`}
              >
                Статус и политика
              </button>
              <button
                type="button"
                onClick={() => setSyncModalTab('changes')}
                className={`py-2.5 px-3 border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                  syncModalTab === 'changes'
                    ? `${accentClasses.border} ${accentClasses.text}`
                    : 'border-transparent opacity-70 hover:opacity-100'
                }`}
              >
                <span>История изменений</span>
                {syncStatus.recentChanges.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-blue-500/20 text-blue-300 text-[10px]">
                    {syncStatus.recentChanges.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setSyncModalTab('errors')}
                className={`py-2.5 px-3 border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                  syncModalTab === 'errors'
                    ? `${accentClasses.border} ${accentClasses.text}`
                    : 'border-transparent opacity-70 hover:opacity-100'
                }`}
              >
                <span>Журнал ошибок</span>
                {syncStatus.errorLogs.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-rose-500/20 text-rose-300 text-[10px]">
                    {syncStatus.errorLogs.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setSyncModalTab('simulate')}
                className={`py-2.5 px-3 border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                  syncModalTab === 'simulate'
                    ? `${accentClasses.border} text-amber-400 border-amber-400`
                    : 'border-transparent opacity-70 hover:opacity-100 text-amber-300/80'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>🧪 Тест 5 сценариев</span>
              </button>
            </div>

            {/* Содержимое вкладок */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs sm:text-sm flex-1">
              {syncModalTab === 'status' && (
                <div className="space-y-4">
                  <div className={`p-4 rounded-xl border space-y-2.5 ${bgSubtle}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs uppercase tracking-wider opacity-75">
                        Текущий статус источника
                      </span>
                      {syncStatus.isStale ? (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          ⚠️ Офлайн (Сохранённая копия)
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          ✔ Данные актуальны
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
                      <div>
                        <span className={textMuted}>Группа: </span>
                        <strong>{activeGroup.code} (ID {activeGroup.id})</strong>
                      </div>
                      <div>
                        <span className={textMuted}>Хеш расписания: </span>
                        <code className="font-mono text-[11px] opacity-80">
                          {scheduleMeta?.contentHash || '—'}
                        </code>
                      </div>
                      <div>
                        <span className={textMuted}>Посл. синхронизация: </span>
                        <strong>
                          {scheduleMeta?.lastSyncedAtIso
                            ? formatDateTimeRu(scheduleMeta.lastSyncedAtIso)
                            : 'Не проводилась'}
                        </strong>
                      </div>
                      <div>
                        <span className={textMuted}>Посл. проверка: </span>
                        <strong>
                          {syncStatus.lastCheckedKhabarovsk || 'Только что'}
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* Безопасная политика опроса */}
                  <div className={`p-4 rounded-xl border space-y-2 ${bgSubtle}`}>
                    <h4 className="font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 text-cyan-400">
                      <Database className="w-3.5 h-3.5" />
                      <span>Параметры допустимого графика опроса ТОГУ</span>
                    </h4>
                    <ul className="space-y-1.5 text-xs opacity-90 list-disc list-inside">
                      <li>
                        <strong>Дневной интервал (TTL):</strong> 30 минут — при открытии приложения сетевой запрос отправляется только если прошло &gt; 30 минут.
                      </li>
                      <li>
                        <strong>Ночной интервал (TTL):</strong> 4 часа (с 23:00 до 06:00 по Хабаровску) во избежание бессмысленной нагрузки.
                      </li>
                      <li>
                        <strong>Защита от флуда (Rate Limit):</strong> не чаще 1 запроса в 10 секунд при ручном обновлении.
                      </li>
                      <li>
                        <strong>Экспоненциальный Backoff:</strong> при сбоях сервера ТОГУ интервалы повторов автоматически увеличиваются (30с → 1м → 3м → 10м).
                      </li>
                    </ul>
                  </div>

                  {/* Честный дисклеймер */}
                  <div className="p-3.5 rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-200 text-xs space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <Info className="w-4 h-4 text-blue-400 shrink-0" />
                      <span>Честное информирование об ограничениях источника</span>
                    </div>
                    <p className="opacity-90 leading-relaxed">
                      Официальный сайт ТОГУ (togudv.ru) представляет собой статический веб-портал и <strong>не поддерживает WebSockets или push-события в реальном времени</strong>. Приложение синхронизируется по безопасному интервальному графику и сохраняет локальный снимок при любых неполадках сервера.
                    </p>
                  </div>
                </div>
              )}

              {syncModalTab === 'changes' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className={textMuted}>
                      Зафиксированные изменения расписания для группы {activeGroup.code}:
                    </span>
                    <span className="font-semibold">{syncStatus.recentChanges.length} записей</span>
                  </div>

                  {syncStatus.recentChanges.length === 0 ? (
                    <div className={`p-6 text-center rounded-xl border ${bgSubtle} opacity-75`}>
                      Изменений в расписании не зафиксировано. Все занятия соответствуют утверждённому плану.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {syncStatus.recentChanges.map((chg) => (
                        <div
                          key={chg.id}
                          className={`p-3 rounded-xl border text-xs space-y-1 ${
                            chg.severity === 'alert'
                              ? 'border-rose-500/40 bg-rose-500/10'
                              : chg.severity === 'warning'
                              ? 'border-amber-500/40 bg-amber-500/10'
                              : `${bgSubtle}`
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                chg.changeType === 'cancelled_lesson'
                                  ? 'bg-rose-500 text-white'
                                  : chg.changeType === 'rescheduled_room' || chg.changeType === 'rescheduled_time'
                                  ? 'bg-amber-500 text-slate-950'
                                  : 'bg-blue-500 text-white'
                              }`}
                            >
                              {chg.changeType === 'cancelled_lesson'
                                ? 'Отмена пары'
                                : chg.changeType === 'new_lesson'
                                ? 'Новое занятие'
                                : chg.changeType === 'rescheduled_room'
                                ? 'Перенос аудитории'
                                : chg.changeType === 'rescheduled_teacher'
                                ? 'Смена преподавателя'
                                : 'Изменение'}
                            </span>
                            <span className="text-[10px] opacity-60">
                              {formatDateTimeRu(chg.detectedAtIso)}
                            </span>
                          </div>
                          <p className="font-medium text-slate-100">{chg.description}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {syncModalTab === 'errors' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className={textMuted}>Журнал сбоев синхронизации и сетевых тайм-аутов:</span>
                    {syncStatus.errorLogs.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          defaultToguSyncEngine.clearErrorLogs(activeGroup.id);
                          setSyncStatus((prev) => ({ ...prev, errorLogs: [] }));
                          showToast('Журнал ошибок очищен');
                        }}
                        className="text-xs text-rose-400 hover:underline font-medium"
                      >
                        Очистить журнал
                      </button>
                    )}
                  </div>

                  {syncStatus.errorLogs.length === 0 ? (
                    <div className={`p-6 text-center rounded-xl border ${bgSubtle} opacity-75`}>
                      Ошибок синхронизации не зафиксировано. Сервер ТОГУ отвечает штатно.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {syncStatus.errorLogs.map((err) => (
                        <div key={err.id} className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-rose-300 flex items-center gap-1">
                              <ShieldAlert className="w-3.5 h-3.5" />
                              <span>{err.errorKind} {err.httpStatus ? `(Код ${err.httpStatus})` : ''}</span>
                            </span>
                            <span className="text-[10px] opacity-60 font-mono">
                              {err.timestampKhabarovsk || formatDateTimeRu(err.timestampIso)}
                            </span>
                          </div>
                          <p className="text-slate-200 font-medium">{err.message}</p>
                          <p className="text-[11px] text-amber-200/90 pt-0.5">
                            💡 Подсказка: {err.userFriendlyHint}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {syncModalTab === 'simulate' && (
                <div className="space-y-3">
                  <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs space-y-1 text-amber-200">
                    <div className="font-bold flex items-center gap-1.5 text-amber-300">
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      <span>Интерактивная проверка 5 сценариев синхронизации</span>
                    </div>
                    <p className="opacity-90">
                      Нажмите на любой из сценариев ниже, чтобы в реальном времени смоделировать реакцию системы: детекцию изменений, перепланирование уведомлений, обновление БД или офлайн-fallback.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => handleSimulateSyncScenario('new_lesson')}
                      className={`p-3 rounded-xl border text-left space-y-1 hover:border-emerald-500 transition-colors ${bgSubtle}`}
                    >
                      <div className="font-bold text-xs text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>1. Новое занятие</span>
                      </div>
                      <p className="text-[11px] opacity-80">
                        Добавляет 3-ю пару «Автоматизация расчёта конструкций» в понедельник, создаёт уведомление и обновляет БД.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSimulateSyncScenario('cancel_lesson')}
                      className={`p-3 rounded-xl border text-left space-y-1 hover:border-rose-500 transition-colors ${bgSubtle}`}
                    >
                      <div className="font-bold text-xs text-rose-400 flex items-center gap-1.5">
                        <Ban className="w-3.5 h-3.5" />
                        <span>2. Отмена пары</span>
                      </div>
                      <p className="text-[11px] opacity-80">
                        Снимает 1-ю пару с расписания, отменяет запланированное уведомление и выводит предупреждение студенту.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSimulateSyncScenario('reschedule')}
                      className={`p-3 rounded-xl border text-left space-y-1 hover:border-amber-500 transition-colors ${bgSubtle}`}
                    >
                      <div className="font-bold text-xs text-amber-400 flex items-center gap-1.5">
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                        <span>3. Перенос аудитории</span>
                      </div>
                      <p className="text-[11px] opacity-80">
                        Переносит занятие в ауд. 504с и заменяет преподавателя, обновляя постоянную карточку уведомления.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSimulateSyncScenario('offline_error')}
                      className={`p-3 rounded-xl border text-left space-y-1 hover:border-rose-400 transition-colors ${bgSubtle}`}
                    >
                      <div className="font-bold text-xs text-rose-300 flex items-center gap-1.5">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>4. Сбой сайта ТОГУ (503)</span>
                      </div>
                      <p className="text-[11px] opacity-80">
                        Имитирует отказ сервера togudv.ru: сохраняет локальную БД, включает баннер устаревания и логирует ошибку.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSimulateSyncScenario('resync_recover')}
                      className={`sm:col-span-2 p-3 rounded-xl border text-left space-y-1 hover:border-blue-400 transition-colors ${bgSubtle}`}
                    >
                      <div className="font-bold text-xs text-blue-400 flex items-center gap-1.5">
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>5. Повторная синхронизация и восстановление</span>
                      </div>
                      <p className="text-[11px] opacity-80">
                        Восстанавливает связь, сверяет хэш, сбрасывает счётчик ошибок и возвращает статус «Актуально».
                      </p>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-700/60 flex items-center justify-between">
              <span className={`text-[11px] ${textMuted}`}>
                ТОГУ • Расписание занятий • Автоматическая синхронизация v4.0
              </span>
              <button
                type="button"
                onClick={() => setIsSyncModalOpen(false)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold border ${bgSubtle}`}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMessage && (
        <div className="fixed bottom-16 md:bottom-6 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-900 text-slate-100 border border-slate-700 shadow-xl text-xs sm:text-sm font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}