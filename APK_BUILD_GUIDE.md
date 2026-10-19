# Сборка установочного `.apk` файла «ТОГУ.Расписание» для Android

В проекте полностью настроена интеграция с **Capacitor Android (`@capacitor/android` + `@capacitor/local-notifications`)**, включая:
- `capacitor.config.ts` (`appId: ru.togudv.schedule.student`, `appName: ТОГУ.Расписание`);
- `android/app/src/main/AndroidManifest.xml` со всеми разрешениями для экрана блокировки (`POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `android:showWhenLocked="true"`);
- автоматические скрипты сборки `build-apk.sh` (Linux/macOS), `build-apk.bat` (Windows) и облачный пайплайн `.github/workflows/build-android-apk.yml`.

## Способ 1: Сборка APK в облаке через GitHub Actions (без установки Android Studio)

Если вы не хотите устанавливать Android SDK и Android Studio (4+ ГБ) на свой компьютер:
1. Создайте репозиторий на GitHub и загрузите туда файлы из папки `togu-schedule`.
2. Перейдите во вкладку **Actions** → workflow **Build TOGU Schedule Android APK** запустится автоматически (или нажмите **Run workflow**).
3. Через ~2,5 минуты скачайте готовый установочный файл **`togu-schedule-android-apk` (`app-debug.apk`)** в блоке **Artifacts** и установите его на свой Android-смартфон.

## Способ 2: Локальная сборка APK одной командой на компьютере

Если у вас установлены Node.js 18+, JDK 17 и Android SDK:

**На Windows:**
```cmd
build-apk.bat
```

**На Linux / macOS:**
```bash
chmod +x build-apk.sh
./build-apk.sh
```

Готовый файл для установки на телефон появится по пути:
`android/app/build/outputs/apk/debug/app-debug.apk`
