# 3. Инструкция по сборке мобильного приложения (Android APK / AAB)

## Способ 1. Автоматическая облачная сборка через GitHub Actions
В проект включён готовый пайплайн `.github/workflows/build-android-apk.yml` (Node.js 22, Java JDK 21, предустановленный Android SDK):
1. Загрузите файлы проекта в репозиторий GitHub.
2. Откройте вкладку **Actions** → выберите workflow **Build TOGU Schedule Android APK**.
3. По завершении сборки скачайте артефакт **`togu-schedule-android-apk`**, содержащий готовый к установке файл **`app-debug.apk`**.

## Способ 2. Локальная сборка через Capacitor и Gradle
1. Установите **JDK 21** и **Android SDK**.
2. Соберите веб-приложение и синхронизируйте нативный проект:
   ```bash
   npm install @capacitor/core @capacitor/android @capacitor/local-notifications
   npm install -D @capacitor/cli
   npx vite build
   npx cap sync android
   ```
3. Запустите сборку APK:
   ```bash
   cd android && ./gradlew assembleDebug --no-daemon
   ```
   Файл APK будет создан по пути `android/app/build/outputs/apk/debug/app-debug.apk`.
4. Для сборки релизного подписанного пакета (`AAB`) для публикации в RuStore / Google Play:
   ```bash
   cd android && ./gradlew bundleRelease
   ```
