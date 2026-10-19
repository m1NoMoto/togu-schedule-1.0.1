// ============================================================================
// МОДУЛЬ АВТОМАТИЧЕСКОЙ СИНХРОНИЗАЦИИ РАСПИСАНИЯ С ОФИЦИАЛЬНЫМ ИСТОЧНИКОМ ТОГУ
// ============================================================================

import {
  ParsedLessonSlot,
  ParsedScheduleDocument,
  OfficialWeekParity,
} from './toguParser';
import {
  SharedScheduleDatabaseState,
  HydratedScheduleSlot,
  selectGroupScheduleFromDb,
  syncGroupScheduleToDatabase,
  DbSyncLogRecord,
} from './toguStorageEngine';
import {
  reconcileScheduleNotifications,
  NotificationReconcileReport,
  ScheduledLessonNotification,
  NotificationLeadMinutes,
  KHABAROVSK_TIMEZONE,
  formatKhabarovskDateTime,
} from './notificationEngine';

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
