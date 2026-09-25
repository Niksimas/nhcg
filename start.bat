@echo off
chcp 65001 >nul
rem Запуск игры на Windows: двойной щелчок по этому файлу
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Не найден Node.js. Установите LTS-версию с https://nodejs.org и запустите этот файл снова.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Первый запуск: устанавливаю зависимости - нужен интернет, 1-2 минуты...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

node server\index.js %*
pause
