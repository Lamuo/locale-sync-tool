@echo off
setlocal

cd /d "%~dp0"

if exist "tools\SyncLocales.exe" (
  tools\SyncLocales.exe --pause %*
) else (
  node sync-locales.cjs --pause %*
)

set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Locale sync failed with exit code %EXIT_CODE%.
  exit /b %EXIT_CODE%
)

echo.
echo Locale sync completed.
exit /b 0
