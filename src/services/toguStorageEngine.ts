// ============================================================================
// ЧАСТЬ 2: РЕЛЯЦИОННОЕ ХРАНИЛИЩЕ РАСПИСАНИЯ (SharedScheduleDB) И
// ИЗОЛИРОВАННОЕ ХРАНИЛИЩЕ ПОЛЬЗОВАТЕЛЬСКИХ НАСТРОЕК (UserPreferencesStore)
// ============================================================================

import {
  OfficialLessonType,
  OfficialWeekParity,
  ParsedCalendarEvent,
  ParsedLessonSlot,
  ParsedScheduleDocument,
} from './toguParser';

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
