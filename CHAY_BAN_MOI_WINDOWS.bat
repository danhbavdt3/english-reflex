@echo off
chcp 65001 >nul
cd /d "%~dp0"
title English Reflex V1.4 - BAN MOI
python run_server.py
if errorlevel 1 py run_server.py
pause
