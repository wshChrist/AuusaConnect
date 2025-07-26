@echo on
pushd "%~dp0"
echo === Compilation du plugin Matchmaking (statique) ===
echo Répertoire de travail : %CD%

REM ============================ À ADAPTER ============================
set "VS_PATH=C:\Program Files\Microsoft Visual Studio\2022\Community"
set "BM_SDK=D:\BakkesModSDK"
set "VCPKG_ROOT=D:\Travail\Travaux\AuusaConnect\vcpkg"
set "SRC=plugin\MatchmakingPlugin.cpp"
set "DLL=MatchmakingPlugin.dll"
set "DEST=%APPDATA%\bakkesmod\bakkesmod\plugins"
REM ===================================================================

echo 1) Initialisation de l'environnement VS...
call "%VS_PATH%\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 (
    echo [Erreur] Impossible d'initialiser VS.
    pause & exit /b 1
)

echo 2) Compilation et linkage (C++17, cpr static + dépendances)...
cl /std:c++17 /LD /EHsc ^
    /I "%BM_SDK%\include" ^
    /I "%VCPKG_ROOT%\installed\x64-windows-static\include" ^
    /I "%VCPKG_ROOT%\installed\x64-windows\include" ^
    "%SRC%" ^
    /link ^
    /LIBPATH:"%BM_SDK%\lib" ^
    /LIBPATH:"%VCPKG_ROOT%\installed\x64-windows-static\lib" ^
    pluginsdk.lib ^
    cpr.lib ^
    libcurl.lib ^
    zlib.lib ^
    Ws2_32.lib ^
    Iphlpapi.lib ^
    Crypt32.lib ^
    advapi32.lib ^
    Secur32.lib ^
    Bcrypt.lib ^
    Winmm.lib ^
    /OUT:"%DLL%"
if errorlevel 1 (
    echo [Erreur] compilation/linkage échouée.
    pause & exit /b 1
)

echo 3) Copie de la DLL vers %DEST%...
mkdir "%DEST%" 2>nul
copy /Y "%DLL%" "%DEST%"
if errorlevel 1 (
    echo [Erreur] copie échouée.
    pause & exit /b 1
)

echo [SUCCÈS] %DLL% générée et copiée dans %DEST%.
pause
popd
@echo off
