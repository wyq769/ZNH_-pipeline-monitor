@echo off
setlocal
cd /d "%~dp0mysql"
netstat -ano | findstr ":3306" | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo [OK] MySQL already running on 127.0.0.1:3306
  exit /b 0
)
echo Starting MySQL ...
start "MySQL" /min bin\mysqld.exe --defaults-file=my.ini
timeout /t 6 >nul
netstat -ano | findstr ":3306" | findstr "LISTENING" >nul
if errorlevel 1 (
  echo [FAIL] see mysql\data\*.err
) else (
  echo [OK] MySQL listening on 127.0.0.1:3306
)