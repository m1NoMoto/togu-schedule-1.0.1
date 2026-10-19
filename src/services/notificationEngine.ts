import { HydratedScheduleSlot } from './toguStorageEngine';
import { OfficialWeekParity } from './toguParser';

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
