/**
 * Защищённый серверный прокси и кэширующий шлюз для официального сайта расписания ТОГУ (https://togudv.ru/rasp/groups/)
 * Запуск: node server/toguServer.mjs (по умолчанию порт 3001)
 *
 * Меры безопасности и надёжности:
 * - Строгая валидация параметров (groupId только цифры 1-8 знаков, semester по белому списку символов) — защита от SSRF и Path Traversal
 * - Заголовки безопасности: X-Content-Type-Options: nosniff, X-Frame-Options: DENY, Referrer-Policy: no-referrer
 * - Rate Limiting: глобальный интервал к togudv.ru (мин. 2.5 сек) + лимит запросов с одного IP (макс. 60 запросов/мин)
 * - In-memory кэширование ответов (TTL 30 минут) и отдача сохранённой копии (staleCache) при сбое togudv.ru
 * - Изоляция секретов: все конфигурации читаются только из переменных окружения процесса (process.env), в клиентский код ключи не попадают
 * - Безопасная обработка ошибок: клиенту возвращаются структурированные коды без внутренних стектрейсов сервера
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TOGU_SERVER_PORT || 3001);
const TOGU_BASE_URL = process.env.TOGU_BASE_URL || 'https://togudv.ru';
const CACHE_TTL_MS = Number(process.env.TOGU_CACHE_TTL_MS || 30 * 60 * 1000); // 30 минут
const MIN_INTERVAL_MS = Number(process.env.TOGU_RATE_LIMIT_MS || 2500); // 2.5 секунды между запросами к сайту вуза
const FETCH_TIMEOUT_MS = Number(process.env.TOGU_FETCH_TIMEOUT_MS || 10000);
const ALLOWED_ORIGIN = process.env.CORS_ALLOWED_ORIGIN || '*';
const MAX_IP_REQ_PER_MIN = Number(process.env.MAX_IP_REQ_PER_MIN || 60);

// Хранилище кэша в памяти сервера: key -> { html, fetchedAt, fetchedAtIso, source, url }
const htmlCache = new Map();
// Хранилище лимитов по IP: ip -> { count, windowStart }
const ipRateLimits = new Map();
let lastUpstreamRequestTime = 0;

// Проверка валидности ID группы (только цифры, 1-8 символов)
export function isValidGroupId(groupId) {
  return typeof groupId === 'string' && /^\d{1,8}$/.test(groupId);
}

// Проверка валидности кода семестра (только безопасные символы без ../ и управляющих символов)
export function isValidSemester(semester) {
  if (semester === null || semester === undefined || semester === '') return true;
  return typeof semester === 'string' && /^[0-9a-zA-Z_-]{1,24}$/.test(semester);
}

// Проверка Rate Limit по IP
export function checkIpRateLimit(ip, now = Date.now()) {
  const key = ip || 'unknown';
  const entry = ipRateLimits.get(key);
  if (!entry || now - entry.windowStart > 60_000) {
    ipRateLimits.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: MAX_IP_REQ_PER_MIN - 1 };
  }
  if (entry.count >= MAX_IP_REQ_PER_MIN) {
    return { allowed: false, remaining: 0 };
  }
  entry.count += 1;
  return { allowed: true, remaining: MAX_IP_REQ_PER_MIN - entry.count };
}

export function setSecurityHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
}

async function throttledFetchTogu(relativePath) {
  if (!relativePath.startsWith('/rasp/groups/')) {
    throw new Error('SECURITY_VIOLATION: Разрешены только запросы к разделу /rasp/groups/');
  }

  const now = Date.now();
  const cached = htmlCache.get(relativePath);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { ...cached, fromCache: true };
  }

  // Глобальный Rate Limiting к сайту вуза
  const elapsed = now - lastUpstreamRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastUpstreamRequestTime = Date.now();

  const targetUrl = `${TOGU_BASE_URL}${relativePath}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'TOGU-Schedule-Student-App/1.0 (+https://togudv.ru/rasp/groups/)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ru-RU,ru;q=0.9',
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`UPSTREAM_HTTP_${response.status}`);
    }

    const html = await response.text();
    const record = {
      html,
      fetchedAt: Date.now(),
      fetchedAtIso: new Date().toISOString(),
      source: 'live_togudv',
      url: targetUrl,
    };
    htmlCache.set(relativePath, record);
    return { ...record, fromCache: false };
  } catch (err) {
    clearTimeout(timeout);
    if (cached) {
      return {
        ...cached,
        fromCache: true,
        staleCache: true,
        upstreamError: 'Сервер ТОГУ временно недоступен, возвращена сохранённая копия из кэша шлюза',
      };
    }
    throw err;
  }
}

export async function handleApiRequest(req, res) {
  setSecurityHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED', message: 'Разрешён только метод GET' }));
    return;
  }

  const clientIp = req.socket?.remoteAddress || '127.0.0.1';
  const rateCheck = checkIpRateLimit(clientIp);
  if (!rateCheck.allowed) {
    res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        error: 'TOO_MANY_REQUESTS',
        message: 'Превышен лимит запросов с вашего IP-адреса. Пожалуйста, подождите 1 минуту.',
      })
    );
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  try {
    if (url.pathname === '/api/togu/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          status: 'ok',
          cacheEntries: htmlCache.size,
          uptimeSec: Math.floor(process.uptime()),
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    if (url.pathname === '/api/togu/groups') {
      const semester = url.searchParams.get('semester');
      if (!isValidSemester(semester)) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'INVALID_SEMESTER_PARAM', message: 'Недопустимый формат параметра semester' }));
        return;
      }
      const rel = semester ? `/rasp/groups/?semester=${encodeURIComponent(semester)}` : '/rasp/groups/';
      const data = await throttledFetchTogu(rel);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
      return;
    }

    if (url.pathname.startsWith('/api/togu/groups/')) {
      const rawId = url.pathname.replace('/api/togu/groups/', '').replace(/\/+$/, '');
      if (!isValidGroupId(rawId)) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            error: 'INVALID_GROUP_ID',
            message: 'Идентификатор группы должен содержать только цифры (1–8 символов)',
          })
        );
        return;
      }
      const rel = `/rasp/groups/${rawId}/`;
      const data = await throttledFetchTogu(rel);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'NOT_FOUND', message: 'Неизвестный маршрут API' }));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        error: 'UPSTREAM_UNAVAILABLE',
        message: 'Официальный источник расписания ТОГУ временно недоступен.',
        code: err instanceof Error ? err.message : 'UNKNOWN_ERROR',
        timestamp: new Date().toISOString(),
      })
    );
  }
}

const server = http.createServer(handleApiRequest);

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  server.listen(PORT, () => {
    console.log(`[TOGU Proxy Server] Запущен на http://localhost:${PORT}`);
  });
}

export { server };
