import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
console.log('[TOGU Schedule Test Suite] Запуск интеграционных тестов парсера расписания ТОГУ...');
