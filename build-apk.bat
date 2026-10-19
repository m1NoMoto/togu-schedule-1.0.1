@echo off
echo === Сборка Android APK приложения «ТОГУ.Расписание» ===
call npm install
call npm install @capacitor/core @capacitor/android @capacitor/local-notifications
call npm install -D @capacitor/cli
call npm run build
call npx cap add android
call npx cap sync android
cd android
call gradlew.bat assembleDebug
echo.
echo ГОТОВО! Установочный файл APK создан по пути:
echo   android\app\build\outputs\apk\debug\app-debug.apk
pause
