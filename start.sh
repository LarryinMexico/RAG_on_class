#!/bin/bash

# 檢查 Python 環境
if [ -d ".venv" ]; then
    echo "使用 .venv 虛擬環境..."
    source .venv/bin/activate
elif [ -d "venv" ]; then
    echo "使用 venv 虛擬環境..."
    source venv/bin/activate
else
    echo "未找到虛擬環境，請先創建虛擬環境並安裝依賴"
    echo "python -m venv .venv"
    echo "source .venv/bin/activate"
    echo "pip install -r requirements.txt"
    exit 1
fi

# 啟動後端 API 服務
echo "啟動 RAG ON CLASS API 服務..."
python backend.py 