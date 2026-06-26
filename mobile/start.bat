@echo off
set PATH=D:\;%PATH%
cd /d "%~dp0"
echo ========================================
echo    LINK CI - App Mobile
echo ========================================
echo.
echo Scanne le QR code avec l'app Expo Go
echo (telecharge-la sur Play Store / App Store)
echo.
echo Appuie sur Ctrl+C pour arreter
echo ========================================
echo.
npx.cmd expo start --port 19000
pause
