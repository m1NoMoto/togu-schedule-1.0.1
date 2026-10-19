# 2. Инструкция по развёртыванию сервера и базы данных

## 2.1. Развёртывание базы данных PostgreSQL / Supabase
1. Создайте проект в **Supabase** (или разверните экземпляр PostgreSQL 15+).
2. В разделе **SQL Editor** выполните миграцию:
   ```text
   supabase/migrations/001_togu_schedule_schema.sql
   ```
3. Скрипт создаёт:
   * Нормализованные таблицы расписания: `study_groups`, `subjects`, `teachers`, `classrooms`, `schedule_slots`, `schedule_overrides`, `calendar_events`, `sync_logs`.
   * Таблицу пользовательских настроек `user_preferences` (привязка по анонимному `device_anon_id` без регистрации).
   * Уникальный композитный индекс `ux_schedule_slots_natural` для идемпотентного `UPSERT` без дубликатов.
   * Политики **Row Level Security (RLS)**: чтение (`SELECT`) открыто для всех клиентов, запись разрешена только сервисному процессу синхронизации.

## 2.2. Развёртывание серверного шлюза (`server/toguServer.mjs`)
1. На VPS-сервере (Ubuntu 22.04 / 24.04) установите Node.js 22 и процесс-менеджер PM2:
   ```bash
   npm install -g pm2
   TOGU_SERVER_PORT=3001 CORS_ALLOWED_ORIGIN=https://your-domain.ru pm2 start server/toguServer.mjs --name togu-proxy
   pm2 save && pm2 startup
   ```
2. Настройте обратный прокси Nginx с HTTPS (Let's Encrypt) для маршрутизации `/api/togu/` на `http://127.0.0.1:3001/api/togu/` и отдачи статики из папки `dist/`.
