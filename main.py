import os
import json
import pickle
import gradio as gr
import numpy as np
import requests
import re  # 添加 re 模組導入
from typing import List, Dict, Tuple
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
from dotenv import load_dotenv
import warnings
import uuid
import shutil
import atexit
import time
warnings.filterwarnings('ignore')

# 載入環境變數
load_dotenv()

class RAGSystem:
    def __init__(self, model_name: str = 'all-mpnet-base-v2'):
        """初始化 RAG 系統"""
        self.model = SentenceTransformer(model_name)
        self.course_data = []
        self.embeddings = []
        self.api_key = os.getenv('GROQ_API_KEY')
        self.data_dir = "uploads"
        self.last_api_call = 0  # 記錄上次 API 呼叫時間
        os.makedirs(self.data_dir, exist_ok=True)
        self.current_session = None
        # 啟動時不自動載入資料
        # self.load_data()
    
    def split_text_into_chunks(self, text: str, chunk_size: int = 150) -> List[str]:
        """將文本分割成指定大小的段落"""
        words = text.split()
        chunks = []
        current_chunk = []
        current_length = 0
        
        for word in words:
            if current_length + len(word) + 1 <= chunk_size:
                current_chunk.append(word)
                current_length += len(word) + 1
            else:
                if current_chunk:
                    chunks.append(' '.join(current_chunk))
                current_chunk = [word]
                current_length = len(word)
        
        if current_chunk:
            chunks.append(' '.join(current_chunk))
        
        return chunks
    
    def prepare_course_data(self, course_texts: List[str]) -> None:
        """準備課程資料並生成嵌入向量"""
        print("正在處理課程資料...")
        all_chunks = []
        for text in course_texts:
            chunks = self.split_text_into_chunks(text)
            all_chunks.extend(chunks)
        self.course_data = all_chunks
        print("正在生成嵌入向量...")
        self.embeddings = self.model.encode(self.course_data)
        # 新增唯一資料夾
        session_id = str(uuid.uuid4())
        session_path = os.path.join(self.data_dir, session_id)
        os.makedirs(session_path, exist_ok=True)
        self.current_session = session_path
        # 存檔
        with open(os.path.join(session_path, 'course_data.json'), 'w', encoding='utf-8') as f:
            json.dump({'course_data': self.course_data}, f, ensure_ascii=False, indent=2)
        with open(os.path.join(session_path, 'embeddings.pkl'), 'wb') as f:
            pickle.dump(self.embeddings, f)
        print(f"已處理 {len(self.course_data)} 個段落")
    
    def clear_all_data(self):
        shutil.rmtree(self.data_dir)
        os.makedirs(self.data_dir, exist_ok=True)
        self.current_session = None
        self.course_data = []
        self.embeddings = []
    
    def load_data(self) -> None:
        # 不再於啟動時自動載入
        pass
    
    def retrieve_relevant_chunks(self, query: str, k: int = 3) -> List[Tuple[str, float]]:
        """檢索相關段落"""
        if not self.course_data:
            return []
        
        # 對查詢進行編碼
        query_embedding = self.model.encode([query])
        
        # 計算餘弦相似度
        similarities = cosine_similarity(query_embedding, self.embeddings)[0]
        
        # 獲取前 k 個最相似的段落
        top_indices = np.argsort(similarities)[::-1][:k]
        
        relevant_chunks = []
        for idx in top_indices:
            if similarities[idx] > 0.1:  # 設定最低相似度閾值
                relevant_chunks.append((self.course_data[idx], similarities[idx]))
        
        return relevant_chunks
    
    def call_groq_api(self, messages, max_retries=3, initial_wait=30):
        """處理 Groq API 呼叫，包含重試機制"""
        current_time = time.time()
        # 確保與上次 API 呼叫間隔至少 1 秒
        time_since_last_call = current_time - self.last_api_call
        if time_since_last_call < 1:
            time.sleep(1 - time_since_last_call)

        headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json'
        }
        
        data = {
            "model": "llama3-70b-8192",
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 3000
        }

        for attempt in range(max_retries):
            try:
                response = requests.post(
                    'https://api.groq.com/openai/v1/chat/completions',
                    headers=headers,
                    json=data,
                    timeout=30
                )
                self.last_api_call = time.time()

                if response.status_code == 200:
                    return response.json()
                elif response.status_code == 429:  # Rate limit error
                    wait_time = initial_wait * (attempt + 1)  # 逐次增加等待時間
                    print(f"遇到速率限制，等待 {wait_time} 秒後重試...")
                    time.sleep(wait_time)
                    continue
                else:
                    print(f"API 錯誤：{response.status_code} - {response.text}")
                    return None

            except Exception as e:
                print(f"API 呼叫出錯：{str(e)}")
                if attempt < max_retries - 1:
                    time.sleep(initial_wait)
                    continue
                return None

        return None

    def generate_questions(self, num_questions=5):
        """生成題目的主要函數"""
        print("開始生成題目...")
        
        # 檢查課程資料是否存在
        if not self.course_data:
            print("錯誤：沒有課程資料可用")
            return []
        
        print(f"課程資料段落數: {len(self.course_data)}")
        
        # 使用部分課程內容來避免超過 token 限制
        max_context_length = 2000  # 字元數限制
        context = ""
        for chunk in self.course_data:
            if len(context) + len(chunk) + 1 <= max_context_length:
                context += chunk + "\n"
            else:
                break
        
        print(f"使用的上下文長度: {len(context)} 字元")
        
        # 更明確的提示詞，強調格式要求
        prompt = f"""請根據以下課程內容，生成{num_questions}題繁體中文單選題。每題必須嚴格按照以下格式：

題目1：[題目內容]
A. [選項A內容]
B. [選項B內容]
C. [選項C內容]
D. [選項D內容]
答案：[A或B或C或D]

題目2：[題目內容]
...以此類推

注意事項：
1. 每題必須以「題目X：」開頭，X為題號
2. 選項必須為A、B、C、D四個，每個選項單獨一行
3. 答案必須標明為「答案：X」，X為A、B、C、D其中之一
4. 請勿使用「以上皆是」、「以上皆非」等模糊選項
5. 題目必須與提供的課程內容直接相關
6. 所有內容必須使用繁體中文

課程內容：
{context}"""

        print("呼叫 API 生成題目...")
        result = self.call_groq_api([{"role": "user", "content": prompt}])
        if result:
            print("成功獲取 API 回應")
            full_content = result['choices'][0]['message']['content'].strip()
            # 輸出前50個字元，幫助調試
            print(f"API回應開頭: {full_content[:100]}...")
            
            # 嘗試直接處理數字題號的情況
            if "題目1：" not in full_content and "題目1:" not in full_content:
                print("處理替代格式...")
                modified_content = ""
                # 尋找數字開頭的行
                lines = full_content.split('\n')
                for i, line in enumerate(lines):
                    # 如果行以數字+點/頓號開頭，將其轉換為「題目X：」格式
                    if re.match(r'^\d+[\.\、\:]', line):
                        num = re.match(r'^\d+', line).group(0)
                        rest = re.sub(r'^\d+[\.\、\:\s]+', '', line)
                        modified_content += f"題目{num}：{rest}\n"
                    else:
                        modified_content += line + "\n"
                full_content = modified_content
            
            qa_list = self.parse_questions_and_answers(full_content)
            print(f"解析出 {len(qa_list)} 題")
            return qa_list
        else:
            print("API 回應失敗或為空")
            return []

    def parse_questions_and_answers(self, full_content):
        """將 LLM 回傳的題目與答案分開，回傳 [(題目, [A,B,C,D], 答案)]"""
        import re
        print("開始解析題目與答案...")
        print(f"原始內容長度: {len(full_content)} 字元")
        
        qa_list = []
        
        # 嘗試多種可能的題目格式
        patterns = [
            # 標準「題目X：」格式
            r'題目\d+[：:](.*?)(?=題目\d+[：:]|$)',
            # 數字+點/頓號格式
            r'\d+[\.\、](.*?)(?=\d+[\.\、]|$)',
            # 直接「題目：」格式
            r'題目[：:](.*?)(?=題目[：:]|$)'
        ]
        
        for pattern in patterns:
            matches = re.findall(pattern, full_content, re.DOTALL)
            if matches:
                print(f"使用模式 '{pattern}' 找到 {len(matches)} 個匹配")
                break
        
        if not matches:
            print("無法識別任何題目格式，嘗試按行分析...")
            # 如果沒有找到任何題目格式，嘗試直接按行分析
            lines = full_content.split('\n')
            current_question = None
            current_options = []
            current_answer = None
            
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                
                # 檢查是否是新題目
                q_match = re.match(r'^\d+[\.\、\:]?\s*(.*)', line)
                if q_match and not re.match(r'^[A-D][\.\、\:]', line):
                    # 保存之前的題目
                    if current_question and current_options and current_answer:
                        qa_list.append((current_question, current_options, current_answer))
                    
                    # 開始新題目
                    current_question = q_match.group(1)
                    current_options = []
                    current_answer = None
                    continue
                
                # 檢查是否是選項
                opt_match = re.match(r'^([A-D])[\.\、\:]?\s*(.*)', line)
                if opt_match:
                    current_options.append(f"{opt_match.group(1)}. {opt_match.group(2)}")
                    continue
                
                # 檢查是否是答案
                ans_match = re.match(r'^答案[\.\、\:\s]*([A-D])', line)
                if ans_match:
                    current_answer = ans_match.group(1)
                    continue
                
                # 如果都不是，可能是題目的一部分
                if current_question:
                    current_question += " " + line
            
            # 保存最後一題
            if current_question and current_options and current_answer:
                qa_list.append((current_question, current_options, current_answer))
            
            return qa_list
        
        # 處理找到的題目區塊
        for block in matches:
            try:
                # 取選項 (支援多種格式)
                options = re.findall(r'([A-D])[\.\、\:\s]+(.*?)(?=[A-D][\.\、\:]|答案|$)', block, re.DOTALL)
                if not options:
                    print(f"警告: 在區塊中未找到選項")
                    continue
                
                # 格式化選項
                formatted_options = [f"{opt[0]}. {opt[1].strip()}" for opt in options]
                
                # 取題幹 - 從區塊開始到第一個選項之前
                first_option_match = re.search(r'[A-D][\.\、\:\s]+', block)
                if first_option_match:
                    question_end = first_option_match.start()
                    question = block[:question_end].strip()
                else:
                    question = block.strip()
                
                # 如果題幹為空，使用區塊的前50個字元
                if not question:
                    question = block[:50].strip() + "..."
                
                # 取答案 (支援多種格式)
                ans_match = re.search(r'答案[\.\、\:\s]*([A-D])', block)
                answer = ans_match.group(1) if ans_match else ''
                
                if not answer and len(formatted_options) > 0:
                    # 如果沒找到答案但有選項，默認使用A
                    print("警告: 未找到答案，默認使用A")
                    answer = 'A'
                
                print(f"成功解析題目: '{question[:20]}...' 選項數: {len(formatted_options)} 答案: {answer}")
                qa_list.append((question, formatted_options, answer))
                
            except Exception as e:
                print(f"解析區塊時出錯: {str(e)}")
                continue
        
        print(f"最終解析出 {len(qa_list)} 題完整問答")
        return qa_list

    def get_standard_answers(self, qa_list, idx):
        # 回傳第 idx 題的標準答案
        if not qa_list or idx >= len(qa_list):
            return "無法取得答案"
        return f"標準答案：{qa_list[idx][2]}"
    
    def analyze_user_answers(self, user_answers, num_questions=5):
        if not self.course_data:
            return "請先上傳課程資料"
        context = "\n".join(self.course_data[:10])
        prompt = f"以下是學生的作答結果，請根據標準答案進行批改，並給予每題簡短講評與總結建議。\n\n課程內容：\n{context}\n\n學生作答：\n{user_answers}\n\n請用繁體中文回答。"
        try:
            headers = {
                'Authorization': f'Bearer {self.api_key}',
                'Content-Type': 'application/json'
            }
            data = {
                "model": "llama3-70b-8192",
                "messages": [
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.3,
                "max_tokens": 3000
            }
            response = requests.post(
                'https://api.groq.com/openai/v1/chat/completions',
                headers=headers,
                json=data,
                timeout=30
            )
            if response.status_code == 200:
                result = response.json()
                return result['choices'][0]['message']['content'].strip()
            else:
                return f"API 錯誤：{response.status_code} - {response.text}"
        except Exception as e:
            return f"分析作答時發生錯誤：{str(e)}"
    
    def answer_query(self, query: str) -> Tuple[str, str]:
        """回答用戶問題的主要函數，返回答案和相關段落"""
        if not query.strip():
            return "請輸入您的問題", ""
        
        relevant_chunks = self.retrieve_relevant_chunks(query, k=3)
        
        is_course_related = False
        if self.course_data:
            query_embedding = self.model.encode([query])
            max_similarity = max(cosine_similarity(query_embedding, self.embeddings)[0])
            is_course_related = max_similarity > 0.3

        if is_course_related and relevant_chunks:
            context = "\n\n".join([chunk for chunk, score in relevant_chunks])
            source_info = "\n\n相關段落：\n" + "\n---\n".join([f"相似度 {score:.2f}：{chunk}" for chunk, score in relevant_chunks])
            prompt = f"""請使用繁體中文回答以下問題。根據上下文回答，如果上下文資訊不足，你可以根據你的知識補充回答，但請明確指出哪些是來自上下文，哪些是你的補充說明。請確保回答完全使用繁體中文，不要使用任何英文。

上下文：
{context}

問題：{query}

請提供詳細的繁體中文回答："""
        else:
            prompt = f"""請使用繁體中文回答以下問題，提供詳細且有幫助的資訊。請確保回答完全使用繁體中文，不要使用任何英文。

問題：{query}

請提供詳細的繁體中文回答："""
            source_info = "此回答來自 AI 的一般知識，未參考上傳的課程內容。"

        result = self.call_groq_api([{"role": "user", "content": prompt}])
        if result:
            answer = result['choices'][0]['message']['content'].strip()
            return answer, source_info
        return "抱歉，暫時無法生成回答，請稍後再試。", source_info

# 初始化 RAG 系統
rag_system = RAGSystem()

def upload_and_process_files(files):
    """處理上傳的文件"""
    if not files:
        return "請選擇要上傳的文件"
    course_texts = []
    for file in files:
        try:
            if hasattr(file, 'read') and callable(file.read):
                # gradio 3.x/4.x 上傳時是 file-like object
                file.seek(0)
                content = file.read()
                if isinstance(content, bytes):
                    content = content.decode('utf-8')
            elif hasattr(file, 'name'):
                # gradio 某些情境是 NamedString
                with open(file.name, 'r', encoding='utf-8') as f:
                    content = f.read()
            else:
                return f"無法識別的檔案型態"
            course_texts.append(content)
        except Exception as e:
            return f"讀取文件時發生錯誤：{str(e)}"
    # 準備課程資料
    rag_system.prepare_course_data(course_texts)
    return f"成功處理 {len(files)} 個文件，共 {len(rag_system.course_data)} 個段落"

def answer_question(question):
    """回答問題的介面函數"""
    answer, source_info = rag_system.answer_query(question)
    return answer, source_info

def create_interface():
    with gr.Blocks(title="RAG ON CLASS - 課程問答系統") as interface:
        gr.Markdown("# 📚 RAG ON CLASS - 課程問答系統")
        gr.Markdown("上傳您的課程資料，然後詢問任何相關問題！")
        with gr.Tab("📁 資料上傳"):
            file_upload = gr.File(
                label="上傳課程文件 (支援 .txt 文件)",
                file_count="multiple",
                file_types=[".txt"]
            )
            upload_btn = gr.Button("處理上傳的文件", variant="primary")
            upload_status = gr.Textbox(label="處理狀態", interactive=False)
            upload_btn.click(
                upload_and_process_files,
                inputs=[file_upload],
                outputs=[upload_status]
            )
        with gr.Tab("❓ 作答系統"):
            question_input = gr.Textbox(
                label="請輸入您的問題",
                placeholder="例如：什麼是機器學習？",
                lines=2
            )
            submit_btn = gr.Button("提交問題", variant="primary")
            answer_output = gr.Textbox(
                label="回答",
                lines=15,
                interactive=False
            )
            source_output = gr.Textbox(
                label="參考來源",
                lines=10,
                interactive=False
            )
            submit_btn.click(
                answer_question,
                inputs=[question_input],
                outputs=[answer_output, source_output]
            )
            question_input.submit(
                answer_question,
                inputs=[question_input],
                outputs=[answer_output, source_output]
            )
        with gr.Tab("📝 一鍵生成題目"):
            questions_state = gr.State([])
            with gr.Row():
                with gr.Column(scale=1):
                    generate_btn = gr.Button("一鍵生成題目", variant="primary")
                    questions_output = gr.Textbox(
                        label="生成的題目",
                        lines=15,
                        interactive=False
                    )
                with gr.Column(scale=1):
                    show_answer_btn = gr.Button("顯示標準答案", variant="secondary")
                    answers_output = gr.Textbox(
                        label="標準答案",
                        lines=15,
                        interactive=False
                    )

            def generate_and_show():
                print("觸發生成題目按鈕...")
                qa_list = rag_system.generate_questions()
                if not qa_list:
                    print("未能生成題目")
                    # 嘗試使用更簡單的方法生成題目
                    print("嘗試使用備用方法生成題目...")
                    # 創建一些示例題目
                    if rag_system.course_data:
                        qa_list = [
                            ("根據課程內容，這是一個示例題目？", ["A. 第一個選項", "B. 第二個選項", "C. 第三個選項", "D. 第四個選項"], "A"),
                            ("這是第二個示例題目？", ["A. 選項A", "B. 選項B", "C. 選項C", "D. 選項D"], "B")
                        ]
                        print("已創建示例題目")
                
                # 格式化題目顯示
                questions_text = ""
                if qa_list:
                    print(f"成功生成 {len(qa_list)} 題")
                    for idx, (q, opts, _) in enumerate(qa_list, 1):
                        questions_text += f"第{idx}題：{q}\n"
                        for opt in opts:
                            questions_text += f"{opt}\n"
                        questions_text += "\n"
                else:
                    questions_text = "無法產生題目，請確認已上傳課程資料"
                
                return qa_list, questions_text

            def show_answers(qa_list):
                print(f"顯示答案按鈕被點擊，qa_list長度: {len(qa_list) if qa_list else 0}")
                if not qa_list:
                    return "請先生成題目"
                
                # 格式化答案顯示
                answers_text = ""
                for idx, (_, _, ans) in enumerate(qa_list, 1):
                    answers_text += f"第{idx}題答案：{ans}\n"
                
                return answers_text

            # 設置按鈕事件
            generate_btn.click(
                generate_and_show,
                inputs=[],
                outputs=[questions_state, questions_output]
            )

            show_answer_btn.click(
                show_answers,
                inputs=[questions_state],
                outputs=[answers_output]
            )
        with gr.Tab("ℹ️ 系統資訊"):
            gr.Markdown("""
            ## 使用說明
            1. **上傳資料**：在「資料上傳」標籤中上傳您的課程文件（.txt 格式）
            2. **處理資料**：點擊「處理上傳的文件」按鈕，系統會自動分割文本並生成嵌入向量
            3. **提問**：在「作答系統」標籤中輸入您的問題
            4. **獲得回答**：系統會檢索相關內容並生成回答
            5. **一鍵生成題目/答案**：在「一鍵生成題目」標籤點擊按鈕自動生成題目與標準答案
            ## 系統特色
            - 🔍 使用 Sentence-BERT 進行語義檢索
            - 🧠 整合 Groq API 生成智能回答與自動出題
            - 📊 餘弦相似度匹配最相關內容
            - 💾 本地儲存處理後的資料
            - 🌐 友好的網頁介面
            ## 注意事項
            - 請確保在 .env 文件中設定 GROQ_API_KEY
            - 支援的文件格式：.txt
            - 系統會將文本分割成約150字的段落進行處理
            """)
    return interface

# 程式結束時自動清空 uploads
atexit.register(rag_system.clear_all_data)

if __name__ == "__main__":
    # 創建並啟動介面
    interface = create_interface()
    interface.launch(
        server_name="0.0.0.0",
        server_port=7860,
        share=False
    )