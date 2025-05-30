@echo off
echo RAG ON CLASS 啟動腳本

REM 檢查 Python 環境
if exist .venv\Scripts\activate.bat (
    echo 使用 .venv 虛擬環境...
    call .venv\Scripts\activate.bat
) else if exist venv\Scripts\activate.bat (
    echo 使用 venv 虛擬環境...
    call venv\Scripts\activate.bat
) else (
    echo 未找到虛擬環境，請先創建虛擬環境並安裝依賴
    echo python -m venv .venv
    echo .\.venv\Scripts\activate.bat
    echo pip install -r requirements.txt
    exit /b 1
)

REM 啟動後端 API 服務
echo 啟動 RAG ON CLASS API 服務...
python backend.py 