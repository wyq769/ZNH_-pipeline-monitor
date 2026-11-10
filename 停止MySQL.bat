@echo off
cd /d "%~dp0mysql"
echo Stopping MySQL ...
bin\mysqladmin.exe -u pipe -pPipe2026! -h 127.0.0.1 -P 3306 shutdown
timeout /t 3 >nul
echo Done.