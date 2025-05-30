# RAG ON CLASS - 課程問答系統

這是一個基於 RAG (Retrieval-Augmented Generation) 技術的課程問答系統，可以根據上傳的課程內容回答問題並自動生成練習題。

## 功能特色

- 📚 上傳課程文件 (.txt 格式)
- ❓ 智能問答系統，根據課程內容回答問題
- 📝 一鍵生成練習題和標準答案
- 🔍 使用 Sentence-BERT 進行語義檢索
- 🧠 整合 Groq API 生成智能回答
- 🌐 前後端分離架構

## 系統架構

- **後端**: 使用 FastAPI 建立 RESTful API
- **前端**: 純 HTML/CSS/JavaScript 實現
- **資料處理**: Sentence-BERT + 餘弦相似度檢索
- **AI 生成**: 整合 Groq API (LLama3-70B)

## 安裝與設置

1. 克隆此倉庫
```bash
git clone https://github.com/LarryinMexico/RAG_on_class.git
cd RAG_on_class
```

2. 創建虛擬環境
```bash
python -m venv .venv
source .venv/bin/activate  # Linux/Mac
# 或者
.\.venv\Scripts\activate  # Windows
```

3. 安裝依賴
```bash
pip install -r requirements.txt
```

4. 創建 .env 文件並添加你的 Groq API 密鑰
```
GROQ_API_KEY=your_api_key_here
```

## 使用方法

### 啟動後端 API 服務

Linux/Mac:
```bash
chmod +x start.sh
./start.sh
```

Windows:
```bash
start.bat
```

或者直接運行:
```bash
python backend.py
```

後端 API 將在 http://localhost:8000 啟動

### 使用前端

直接在瀏覽器中打開 `frontend/index.html` 文件，或使用簡易的 HTTP 服務器:

```bash
# Python 3 內建的 HTTP 服務器
cd frontend
python -m http.server 8080
```

然後在瀏覽器中訪問 http://localhost:8080

## API 端點

- `POST /api/upload` - 上傳課程文件
- `POST /api/query` - 提交問題
- `POST /api/generate-questions` - 生成練習題
- `GET /api/clear-data` - 清除所有數據

## 系統流程

1. **上傳資料**：上傳課程文件（.txt 格式）
2. **處理資料**：系統自動分割文本並生成嵌入向量
3. **提問**：輸入問題獲得基於課程內容的回答
4. **生成題目**：一鍵生成練習題與標準答案 