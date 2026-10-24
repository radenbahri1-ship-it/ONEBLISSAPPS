@echo off
rem Unggah seluruh isi folder ini ke https://github.com/radenbahri1-ship-it/ONEBLISSAPPS
rem Syarat: Git for Windows terpasang. Isi repo di GitHub akan DIGANTI dengan isi folder ini.
cd /d "%~dp0"
where git >nul 2>&1 || (echo Git belum terpasang: https://git-scm.com/download/win & pause & exit /b 1)
if not exist .git git init
git branch -M main
git config user.name >nul 2>&1 || git config user.name "radenbahri1-ship-it"
git config user.email >nul 2>&1 || git config user.email "radenbahri1-ship-it@users.noreply.github.com"
git add -A
git commit -m "ONE BLISS online: versi bersih" 
git remote remove origin >nul 2>&1
git remote add origin https://github.com/radenbahri1-ship-it/ONEBLISSAPPS.git
git push -u origin main --force
echo.
echo Selesai. Buka https://github.com/radenbahri1-ship-it/ONEBLISSAPPS
pause
