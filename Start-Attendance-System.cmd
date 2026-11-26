@echo off
setlocal
cd /d "%~dp0attendance-monitoring-system"
if not exist package.json (
  echo The attendance project folder could not be found.
  pause
  exit /b 1
)
call npm run local
pause
