@echo off
setlocal
REM Always run from this script's own folder
cd /d "%~dp0"

REM First-time setup: create the local repo + point it at GitHub
IF NOT EXIST ".git" (
  echo First run: initialising git repository...
  git init
  git branch -M main
  git remote add origin https://github.com/rajkumarpattabi/portfolioguidance.git
)

REM Make sure the remote is set even if .git already existed
git remote get-url origin >nul 2>&1 || git remote add origin https://github.com/rajkumarpattabi/portfolioguidance.git

REM Ensure a commit identity exists (uses global config if already set)
git config user.email >nul 2>&1 || git config user.email "rajkumar.pattabi@expleogroup.com"
git config user.name  >nul 2>&1 || git config user.name  "Rajkumar Pattabi"

echo.
echo === Changes to be committed ===
git status --short
echo.

set /p msg="Commit message (blank = 'Update PortfolioGuidance'): "
if "%msg%"=="" set msg=Update PortfolioGuidance

git add -A
git commit -m "%msg%"
git push -u origin main

echo.
echo If a GitHub sign-in window appears, complete it once.
echo If the push is REJECTED because the GitHub repo already has a README, run:
echo     git pull origin main --rebase --allow-unrelated-histories
echo   then double-click push.bat again.
echo.
echo Done. GitHub Pages refreshes a minute or two after a successful push.
pause
