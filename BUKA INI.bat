@echo off
REM Switch to the folder this .bat file lives in
cd /d "%~dp0"

REM Server already running (opened before)? Just open the browser.
netstat -ano | findstr /r /c:":8080 .*LISTENING" >nul
if %errorlevel%==0 (
  start "" http://localhost:8080
  exit /b
)

REM Open the browser after a short delay so the server has time to start
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8080"

REM Run the server (keeps this window open; close it or press Ctrl+C to stop)
node server.mjs

pause
