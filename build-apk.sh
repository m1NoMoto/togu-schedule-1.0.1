#!/usr/bin/env bash
set -e

echo "=== Сборка Android APK приложения «ТОГУ.Расписание» ==="
echo "1. Установка зависимостей и плагинов Capacitor..."
npm install
npm install @capacitor/core @capacitor/android @capacitor/local-notifications
npm install -D @capacitor/cli

echo "2. Сборка production-бандла React + TypeScript + Vite..."
npm run build

echo "3. Синхронизация веб-ресурсов с нативным Android-проектом..."
if [ ! -d "android/gradlerw" ] && [ ! -f "android/gradlew" ]; then
  npx cap add android || true
fi
npx cap sync android

echo "4. Компиляция APK через Gradle (assembleDebug)..."
cd android
chmod +x gradlew
./gradlew assembleDebug

echo ""
echo "ГОТОВО! Установочный файл APK создан по пути:"
echo "  android/app/build/outputs/apk/debug/app-debug.apk"
