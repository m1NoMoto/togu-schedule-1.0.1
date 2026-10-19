-- ============================================================================
-- МИГРАЦИЯ 001: СХЕМА БАЗЫ ДАННЫХ РАСПИСАНИЯ ТОГУ (PostgreSQL / Supabase)
-- ============================================================================
-- Особенности архитектуры:
-- 1. Полная нормализация общих данных: институты, группы, дисциплины, преподаватели, аудитории, слоты расписания, сессия и оверрайды (отмены/переносы).
-- 2. Защита от дубликатов при повторной синхронизации: UNIQUE композитный индекс slot_natural_key и идемпотентный UPSERT (ON CONFLICT DO UPDATE).
-- 3. Чтение расписания БЕЗ регистрации: RLS разрешает SELECT для роли anon.
-- 4. Централизованное обновление: INSERT/UPDATE/DELETE в таблицах расписания разрешены только сервисной роли (service_role).
-- 5. Пользовательские настройки (основная группа, избранные группы, подгруппа, тема) хранятся отдельно от общих таблиц расписания.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Таблица институтов и подразделений ТОГУ
CREATE TABLE IF NOT EXISTS public.institutes (
    id TEXT PRIMARY KEY,                  -- Например: 'ИАСиД', 'ПОЛИТЕХ', 'ЮИ'
    short_name TEXT NOT NULL,
    full_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Таблица учебных групп ТОГУ (753 группы)
CREATE TABLE IF NOT EXISTS public.student_groups (
    id TEXT PRIMARY KEY,                  -- Официальный ID группы с togudv.ru, напр. '68805'
    code TEXT NOT NULL,                   -- Код группы, напр. 'СУЗ(с) - 51'
    institute_id TEXT NOT NULL REFERENCES public.institutes(id) ON DELETE RESTRICT,
    course SMALLINT NOT NULL CHECK (course BETWEEN 1 AND 7),
    degree TEXT NOT NULL CHECK (degree IN ('Бакалавриат', 'Специалитет', 'Магистратура', 'Аспирантура')),
    study_form TEXT NOT NULL CHECK (study_form IN ('Очная', 'Заочная', 'Очно-заочная')),
    program_name TEXT NOT NULL,
    specialization_code TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_groups_code ON public.student_groups (code);
CREATE INDEX IF NOT EXISTS idx_student_groups_institute_course ON public.student_groups (institute_id, course);

-- 3. Справочник учебных дисциплин (Предметы)
CREATE TABLE IF NOT EXISTS public.subjects (
    id TEXT PRIMARY KEY,                  -- Детерминированный ключ предмета (slug)
    title TEXT NOT NULL UNIQUE,           -- Полное название предмета
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Справочник преподавателей ТОГУ
CREATE TABLE IF NOT EXISTS public.teachers (
    id TEXT PRIMARY KEY,                  -- Официальный ID из /rasp/teacher/<id>/ (напр. '2371')
    full_name TEXT NOT NULL,              -- Например: 'Московцева Е. А.'
    academic_title TEXT NOT NULL DEFAULT '', -- Например: 'Доцент, ученая степень кандидат наук'
    profile_url TEXT NOT NULL DEFAULT '', -- '/rasp/teacher/2371/'
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Справочник аудиторий и корпусов ТОГУ
CREATE TABLE IF NOT EXISTS public.classrooms (
    id TEXT PRIMARY KEY,                  -- Официальный ID из /rasp/rooms/<id>/ (напр. '891') или 'online'
    room_code TEXT NOT NULL,              -- Например: '502ц', '237л', '357ца', 'ДИСТАН.'
    building_name TEXT NOT NULL,          -- Расшифровка корпуса
    room_url TEXT NOT NULL DEFAULT '',    -- '/rasp/rooms/891/'
    is_online BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Таблица регулярных занятий семестра (#all_weeks)
-- Поддерживает несколько занятий в день, разные подгруппы ('all', '1', '2'),
-- правила чередования недель ('both', 'odd', 'even') и период дат (date_from .. date_to).
CREATE TABLE IF NOT EXISTS public.schedule_slots (
    slot_key TEXT PRIMARY KEY,            -- Уникальный композитный ключ дедупликации
    group_id TEXT NOT NULL REFERENCES public.student_groups(id) ON DELETE CASCADE,
    semester_code TEXT NOT NULL,          -- Например: '2026 - 2027 учебный год, осенний семестр'
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
    pair_number SMALLINT NOT NULL CHECK (pair_number BETWEEN 1 AND 8),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    week_parity TEXT NOT NULL CHECK (week_parity IN ('both', 'odd', 'even')),
    subgroup TEXT NOT NULL DEFAULT 'all' CHECK (subgroup IN ('all', '1', '2')),
    subject_id TEXT NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
    lesson_type TEXT NOT NULL CHECK (lesson_type IN ('lecture', 'practice', 'lab', 'seminar', 'project')),
    event_type_short TEXT NOT NULL,       -- 'лк', 'пр', 'лб'
    event_type_full TEXT NOT NULL,        -- 'лекция', 'практическая работа'
    teacher_id TEXT REFERENCES public.teachers(id) ON DELETE SET NULL,
    classroom_id TEXT REFERENCES public.classrooms(id) ON DELETE SET NULL,
    date_range_text TEXT NOT NULL DEFAULT '',
    date_from DATE,
    date_to DATE,
    is_online BOOLEAN NOT NULL DEFAULT false,
    content_hash TEXT NOT NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Защита от дубликатов при повторной синхронизации:
    CONSTRAINT uq_schedule_slot_natural UNIQUE (
        group_id, semester_code, day_of_week, pair_number, week_parity, subgroup, subject_id
    )
);

CREATE INDEX IF NOT EXISTS idx_schedule_slots_group_day ON public.schedule_slots (group_id, day_of_week);

-- 7. Таблица отметок об отмене и переносе занятий (schedule_overrides)
-- Хранится отдельно от базовой сетки, чтобы повторная синхронизация HTML не затирала диспетчерские отметки
CREATE TABLE IF NOT EXISTS public.schedule_overrides (
    slot_key TEXT PRIMARY KEY REFERENCES public.schedule_slots(slot_key) ON DELETE CASCADE,
    group_id TEXT NOT NULL REFERENCES public.student_groups(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('normal', 'cancelled', 'rescheduled')),
    target_date DATE,                     -- Конкретная дата отмены/переноса (или NULL для всего семестра)
    new_date TEXT,                        -- Новая дата при переносе (напр. '21.10.2026')
    new_pair_number SMALLINT CHECK (new_pair_number BETWEEN 1 AND 8),
    new_start_time TEXT,
    new_room_code TEXT,                   -- Новая аудитория при переносе (напр. '405л')
    reason TEXT NOT NULL DEFAULT '',      -- Причина отмены или комментарий к переносу
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. Таблица календарных событий и сессии (#cal_week)
CREATE TABLE IF NOT EXISTS public.calendar_events (
    event_key TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES public.student_groups(id) ON DELETE CASCADE,
    date_title TEXT NOT NULL,
    time_range TEXT NOT NULL,
    event_type_short TEXT NOT NULL,       -- 'зач', 'д.зач', 'экз'
    subject_id TEXT NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
    session_category TEXT NOT NULL DEFAULT '',
    is_online BOOLEAN NOT NULL DEFAULT false,
    classroom_id TEXT REFERENCES public.classrooms(id) ON DELETE SET NULL,
    teacher_id TEXT REFERENCES public.teachers(id) ON DELETE SET NULL,
    is_past BOOLEAN NOT NULL DEFAULT false,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_calendar_event_natural UNIQUE (
        group_id, date_title, time_range, subject_id, event_type_short
    )
);

-- 9. Журнал централизованных синхронизаций расписания
CREATE TABLE IF NOT EXISTS public.sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id TEXT NOT NULL REFERENCES public.student_groups(id) ON DELETE CASCADE,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_kind TEXT NOT NULL,
    inserted_count INT NOT NULL DEFAULT 0,
    updated_count INT NOT NULL DEFAULT 0,
    unchanged_count INT NOT NULL DEFAULT 0,
    removed_count INT NOT NULL DEFAULT 0,
    duplicates_prevented INT NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL
);

-- 10. Таблица пользовательских настроек (отдельно от общих данных расписания, без обязательной регистрации)
CREATE TABLE IF NOT EXISTS public.user_preferences (
    device_id TEXT PRIMARY KEY,           -- Анонимный идентификатор устройства (без обязательной регистрации)
    primary_group_id TEXT NOT NULL REFERENCES public.student_groups(id) ON DELETE SET DEFAULT DEFAULT '68805',
    favorite_group_ids TEXT[] NOT NULL DEFAULT ARRAY['68805'],
    subgroup TEXT NOT NULL DEFAULT 'all' CHECK (subgroup IN ('all', '1', '2')),
    theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'oled', 'light')),
    accent TEXT NOT NULL DEFAULT 'blue' CHECK (accent IN ('blue', 'emerald', 'violet', 'amber')),
    compact_cards BOOLEAN NOT NULL DEFAULT false,
    show_windows BOOLEAN NOT NULL DEFAULT true,
    show_big_break BOOLEAN NOT NULL DEFAULT true,
    show_pair_numbers BOOLEAN NOT NULL DEFAULT true,
    personal_notes JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- НАСТРОЙКА БЕЗОПАСНОСТИ ROW LEVEL SECURITY (RLS) В SUPABASE
-- ============================================================================

ALTER TABLE public.institutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- Публичное чтение расписания без регистрации (для ролей anon и authenticated)
CREATE POLICY "Public read institutes" ON public.institutes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read student_groups" ON public.student_groups FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read subjects" ON public.subjects FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read teachers" ON public.teachers FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read classrooms" ON public.classrooms FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read schedule_slots" ON public.schedule_slots FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read schedule_overrides" ON public.schedule_overrides FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read calendar_events" ON public.calendar_events FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read sync_logs" ON public.sync_logs FOR SELECT TO anon, authenticated USING (true);

-- Запись в таблицы расписания разрешена ТОЛЬКО сервисной роли централизованного парсера (service_role)
CREATE POLICY "Service role write schedule_slots" ON public.schedule_slots
    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role write schedule_overrides" ON public.schedule_overrides
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Изоляция пользовательских настроек по заголовку x-device-id (без регистрации)
CREATE POLICY "Device isolation user_preferences" ON public.user_preferences
    FOR ALL TO anon, authenticated
    USING (device_id = coalesce(current_setting('request.headers', true)::json->>'x-device-id', ''))
    WITH CHECK (device_id = coalesce(current_setting('request.headers', true)::json->>'x-device-id', ''));
