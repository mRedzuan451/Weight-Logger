@echo off
setlocal ENABLEDELAYEDEXPANSION

set "SCRIPT_DIR=%~dp0"
set "BASH_BIN="

set "CANDIDATES=%BASH% %PROGRAMFILES%\Git\bin\bash.exe %PROGRAMFILES(X86)%\Git\bin\bash.exe %LOCALAPPDATA%\Programs\Git\bin\bash.exe"
for %%I in (%CANDIDATES%) do (
    if not defined BASH_BIN (
        if exist "%%~I" (
            set "BASH_BIN=%%~I"
        )
    )
)

if not defined BASH_BIN (
    echo Could not find bash.exe. Install Git for Windows or set the BASH environment variable.>&2
    exit /b 1
)

"%BASH_BIN%" -lc "cd '%SCRIPT_DIR%' && chmod +x run.sh && ./run.sh"
endlocal
