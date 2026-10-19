// ============================================================================
// ТИПЫ ДАННЫХ (TypeScript Interfaces)
// ============================================================================

export type LessonType = 'lecture' | 'practice' | 'lab' | 'seminar' | 'project';
export type WeekParity = 'odd' | 'even'; // Нечётная (Числитель) / Чётная (Знаменатель)
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
  pairNumber: number;
  startTime: string;
  endTime: string;
  subject: string;
  type: LessonType;
  room: string;
  building: string;
  teacher: string;
  teacherTitle: string;
  subgroup?: 'all' | '1' | '2';
  weekParity: 'both' | WeekParity;
  dayOfWeek: number; // 1 = Понедельник ... 7 = Воскресенье
  isOnline?: boolean;
  department?: string;
  defaultNote?: string;
}

export interface StudentGroup {
  id: string;
  code: string;
  name: string;
  specializationCode: string;
  instituteShort: string;
  instituteFull: string;
  course: number;
  degree: 'Бакалавриат' | 'Специалитет' | 'Магистратура';
  form: 'Очная' | 'Заочная';
  studentsCount: number;
  headmanDemo: string;
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
