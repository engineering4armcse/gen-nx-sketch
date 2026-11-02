@echo off
REM Makes a "Gen NX Sketch" shortcut on the Desktop with the app logo. It opens BUKA INI.bat with its window minimised.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop'); $s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'Gen NX Sketch.lnk')); $s.TargetPath='%~dp0BUKA INI.bat'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%~dp0gen-nx-sketch-app.ico,0'; $s.WindowStyle=7; $s.Description='Gen NX Sketch - drafting sketches from a MIDAS Gen NX model'; $s.Save()"
if %errorlevel%==0 (echo Shortcut "Gen NX Sketch" dibuat di Desktop.) else (echo Gagal membuat shortcut.)
pause
