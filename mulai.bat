@echo off
title ONE BLISS - Server Hotel
cd /d "%~dp0"
set PY=
where py >nul 2>nul && set PY=py -3
if "%PY%"=="" where python >nul 2>nul && set PY=python
if "%PY%"=="" (
  echo Python belum terpasang. Pasang dari https://www.python.org/downloads/ ^(centang Add python.exe to PATH^)
  pause
  exit /b 1
)
:ulang
%PY% server.py
echo.
echo Server berhenti. Mulai ulang 5 detik... ^(tutup jendela untuk berhenti^)
timeout /t 5 >nul
goto ulang
