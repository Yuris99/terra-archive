@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local-site.ps1"
if errorlevel 1 (
    echo Terra Archive could not start. See the error above.
    pause
    exit /b 1
)
start "" "http://127.0.0.1:3010/search"
