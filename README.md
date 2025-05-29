# RAG ON CLASS - 課程問答系統

這是一個基於 RAG (Retrieval-Augmented Generation) 技術的課程問答系統，可以根據上傳的課程內容回答問題並自動生成練習題。

## 功能特色

- 📚 上傳課程文件 (.txt 格式)
- ❓ 智能問答系統，根據課程內容回答問題
- 📝 一鍵生成練習題和標準答案
- 🔍 使用 Sentence-BERT 進行語義檢索
- 🧠 整合 Groq API 生成智能回答

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

運行應用程序：
```bash
python main.py
```

然後在瀏覽器中訪問 http://localhost:7860

## 系統流程

1. **上傳資料**：上傳課程文件（.txt 格式）
2. **處理資料**：系統自動分割文本並生成嵌入向量
3. **提問**：輸入問題獲得基於課程內容的回答
4. **生成題目**：一鍵生成練習題與標準答案 