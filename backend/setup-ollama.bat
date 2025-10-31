@echo off
echo Checking if Ollama is installed...

ollama --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing Ollama...
    curl -fsSL https://ollama.ai/install.sh | sh
) else (
    echo Ollama is already installed.
)

echo.
echo Pulling llama3.2:3b model...
ollama pull llama3.2:3b

echo.
echo Setup complete!
echo.
echo Now run these commands in SEPARATE terminals:
echo Terminal 1: ollama serve
echo Terminal 2: cd backend && npm start  
echo Terminal 3: cd frontend && npm run dev
pause