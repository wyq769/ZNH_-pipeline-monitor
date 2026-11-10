@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   Push to GitHub: wyq769/ZNH_-pipeline-monitor
echo ============================================
echo.
git remote -v
echo.
git push -u origin main
echo.
if errorlevel 1 (
  echo [FAILED] common causes:
  echo   1^) not signed in to GitHub - use a Personal Access Token as the password
  echo   2^) token has no repo permission
  echo   3^) network / proxy issue
) else (
  echo [OK] pushed. Now import the repo on Netlify.
)
echo.
pause
