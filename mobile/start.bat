@echo off
rem Node portable (dossier utilisateur) ; D:\ seulement si ce lecteur est branche
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
if exist D:\node.exe set PATH=D:\;%PATH%
rem Annoncer l'adresse Wi-Fi du PC : sinon Expo peut choisir celle de VirtualBox
rem (192.168.56.x), injoignable depuis le telephone
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi' -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress"`) do set "REACT_NATIVE_PACKAGER_HOSTNAME=%%i"
cd /d "%~dp0"
rem Le projet est lie au compte Expo : on s'authentifie avec EXPO_TOKEN lu dans ..\.env
for /f "usebackq tokens=1,* delims==" %%a in ("..\.env") do if "%%a"=="EXPO_TOKEN" set "EXPO_TOKEN=%%b"
echo ========================================
echo    LINK CI - App Mobile
echo ========================================
echo.
echo Scanne le QR code avec l'app Expo Go
echo (telecharge-la sur Play Store / App Store)
echo.
echo Adresse du PC sur le Wi-Fi : %REACT_NATIVE_PACKAGER_HOSTNAME%
echo Appuie sur Ctrl+C pour arreter
echo ========================================
echo.
npx.cmd expo start --port 19000
pause
