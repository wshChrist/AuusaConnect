@echo off
setlocal

REM -- Paramètres à adapter si nécessaire --
set "VS_PATH=C:\Program Files\Microsoft Visual Studio\2022\Community"
set "SDK=D:\BakkesModSDK"
set "SRC=plugin.cpp"
set "DLL=AuusaConnect.dll"
set "DEST=C:\Program Files\BakkesMod\plugins"
REM ---------------------------------------

set "INCLUDE=%SDK%\include"
set "LIB=%SDK%\lib"
set "LIB_BM=%LIB%\BakkesMod.lib"

call "%VS_PATH%\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 (
    echo [Erreur] Initialisation de l'environnement Visual Studio échouée.
    exit /b 1
)

cl /LD /EHsc /I "%INCLUDE%" "%SRC%" "%LIB_BM%" /link /OUT:"%DLL%"
if errorlevel 1 (
    echo [Erreur] La compilation a échoué.
    exit /b 1
)

copy /Y "%DLL%" "%DEST%"
if errorlevel 1 (
    echo [Erreur] Impossible de copier la DLL dans %DEST%.
    exit /b 1
)

echo [Succès] %DLL% compilée et copiée dans %DEST%.
endlocal
