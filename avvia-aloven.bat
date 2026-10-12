@echo off
setlocal
title Aloven
cd /d "%~dp0"
if errorlevel 1 goto errore

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js non trovato. Installa Node.js 22.13 o successivo.
    goto errore
)

node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)"
if errorlevel 1 (
    echo E' richiesto Node.js 22.13 o successivo.
    goto errore
)

echo Avvio di Aloven...
echo Apri nel browser l'indirizzo mostrato dal server.
echo Per arrestare l'app premi Ctrl+C in questa finestra.
echo.
node server.mjs
if errorlevel 1 goto errore
exit /b 0

:errore
echo.
echo Avvio non riuscito. Controlla il messaggio precedente.
pause
exit /b 1
