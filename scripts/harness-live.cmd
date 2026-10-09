@echo off
setlocal DisableDelayedExpansion
set "ELECTRON_RUN_AS_NODE=1"
if not defined EVOFORGE_HARNESS_RUNTIME set "EVOFORGE_HARNESS_RUNTIME=%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\app.asar\dsh"
set "PATH=%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin;%ProgramFiles%\Docker\Docker\resources\bin;%PATH%"
"%LOCALAPPDATA%\Programs\DeepSeek Harness\DeepSeek Harness.exe" --expose-internals "%~dp0harness-live.mjs" %*
exit /b %errorlevel%
