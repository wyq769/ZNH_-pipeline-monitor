@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================================
echo   Push to GitHub : wyq769/ZNH_-pipeline-monitor
echo ============================================================
echo.
echo [1/4] Local commits waiting to be pushed:
git --no-pager log --oneline origin/main..HEAD
echo.
echo [2/4] Pushing...
git push origin main
if errorlevel 1 goto failed
echo.
echo [3/4] Verifying remote...
for /f "tokens=1" %%i in ('git rev-parse HEAD') do set LOCAL=%%i
for /f "tokens=1" %%i in ('git ls-remote origin main') do set REMOTE=%%i
echo   local  HEAD        = %LOCAL%
echo   remote origin/main = %REMOTE%
if /i "%LOCAL%"=="%REMOTE%" (
  echo   [OK] remote matches local - push verified
) else (
  echo   [WARN] remote differs from local, check the output above
)
echo.
echo [4/4] Done. Repo: https://github.com/wyq769/ZNH_-pipeline-monitor
echo       Netlify: https://app.netlify.com/teams/wyq769/projects
goto end

:failed
echo.
echo [FAILED] push did not complete. Common causes:
echo   1^) Not signed in. When a browser window or prompt appears, sign in to GitHub.
echo      If it asks for a password, use a Personal Access Token (classic, scope: repo).
echo   2^) Token lacks repo permission.
echo   3^) Network or proxy problem.
echo.
echo Quick fix - force re-login and retry:
echo   git config --global --unset credential.helper
echo   git config --global credential.helper manager
echo   git push origin main
echo.
pause
exit /b 1

:end
echo.
pause