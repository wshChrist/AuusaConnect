@echo on
REM Test simple de l'appel à vcvars64.bat

set "VS_PATH=C:\Program Files\Microsoft Visual Studio\2022\Community"

echo VS_PATH = [%VS_PATH%]
echo Appel de vcvars64.bat…
call "%VS_PATH%\VC\Auxiliary\Build\vcvars64.bat"
echo Code de retour: %ERRORLEVEL%
pause
