@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js LTS from https://nodejs.org then run this again.
  pause
  exit /b
)
if not exist node_modules call npm install
set ELECTRON_RUN_AS_NODE=
call npm start
