@echo off
cd /d "%~dp0"
call 启动MySQL.bat
start "" http://127.0.0.1:8787/
node server/index.js
pause