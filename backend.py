import os
import json
import pickle
import numpy as np
import requests
import re
import uuid
import shutil
import atexit
import time
import traceback
import tempfile
from typing import List, Dict, Tuple, Optional, Any
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks, Depends, Cookie, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
from dotenv import load_dotenv
import warnings
import uvicorn

# PDF 和 OCR 相關
import PyPDF2
from pdf2image import convert_from_bytes
import pytesseract
from PIL import Image

warnings.filterwarnings('ignore')

# 載入環境變數
load_dotenv()

class QueryRequest(BaseModel):
    question: str
    session_id: Optional[str] = None

class QuestionGenRequest(BaseModel):
    num_questions: int = 5

class ConversationResponse(BaseModel):
    answer: str
    sources: str
    history: List[Dict[str, str]]
    session_id: str

# 用於存儲對話歷史的類
class Conversation:
    def __init__(self, session_id: str = None):
        self.session_id = session_id or str(uuid.uuid4())
        self.history = []
    
    def add_message(self, role: str, content: str):
        self.history.append({"role": role, "content": content})
    
    def get_history(self, max_messages: int = 10):
        # 返回最近的對話歷史，限制數量以避免超出token限制
        return self.history[-max_messages:] if len(self.history) > max_messages else self.history
    
    def to_dict(self):
        return {
            "session_id": self.session_id,
            "history": self.history
        }

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
        # 保存所有對話的字典
        self.conversations = {}
    
    def get_or_create_conversation(self, session_id: Optional[str] = None) -> Conversation:
        """獲取現有對話或創建新對話"""
        if session_id and session_id in self.conversations:
            return self.conversations[session_id]
        
        # 創建新對話
        conversation = Conversation(session_id)
        self.conversations[conversation.session_id] = conversation
        return conversation
    
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
    
    def extract_text_from_pdf(self, pdf_content: bytes) -> str:
        """從PDF文件中提取文字內容"""
        text = ""
        try:
            # 嘗試直接從PDF提取文字
            with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as temp_file:
                temp_file.write(pdf_content)
                temp_file_path = temp_file.name

            with open(temp_file_path, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)
                for page_num in range(len(pdf_reader.pages)):
                    page = pdf_reader.pages[page_num]
                    page_text = page.extract_text()
                    if page_text:
                        text += page_text + "\n\n"
            
            # 如果提取的文字內容太少，可能是掃描PDF，使用OCR
            if len(text.strip()) < 100:
                print("直接提取的文字內容太少，嘗試使用OCR...")
                text = self.process_pdf_with_ocr(pdf_content)
            
            os.unlink(temp_file_path)
            return text
        except Exception as e:
            print(f"提取PDF文字時出錯: {str(e)}")
            # 嘗試使用OCR
            return self.process_pdf_with_ocr(pdf_content)
    
    def process_pdf_with_ocr(self, pdf_content: bytes) -> str:
        """使用OCR處理PDF掃描文件"""
        print("開始OCR處理PDF...")
        all_text = ""
        try:
            # 將PDF轉換為圖像
            images = convert_from_bytes(pdf_content, dpi=300)
            
            # 對每個圖像進行OCR處理
            for i, image in enumerate(images):
                print(f"處理第{i+1}頁...")
                # 使用pytesseract進行OCR (指定中文語言)
                page_text = pytesseract.image_to_string(image, lang='chi_tra+eng')
                all_text += page_text + "\n\n"
                
                # 添加圖像描述
                image_description = self.get_image_description(image)
                if image_description:
                    all_text += f"圖片描述: {image_description}\n\n"
            
            print(f"OCR處理完成，提取了{len(all_text)}個字符")
            return all_text
        except Exception as e:
            print(f"OCR處理失敗: {str(e)}")
            return ""
    
    def get_image_description(self, image) -> str:
        """使用 Groq API 為圖像生成描述"""
        # 轉換圖像為 base64 字符串
        try:
            # 如果圖像太大，調整大小
            max_size = (800, 800)
            image.thumbnail(max_size, Image.LANCZOS)
            
            # 不實際呼叫 API 來生成描述
            # 這裡只返回一個提示，實際集成時可調用圖像描述API
            return "圖像內容無法直接描述，已進行OCR文字提取。"
        except Exception as e:
            print(f"生成圖像描述失敗: {str(e)}")
            return ""
    
    def prepare_course_data(self, course_texts: List[str], file_types: List[str] = None) -> str:
        """準備課程資料並生成嵌入向量"""
        print("正在處理課程資料...")
        all_chunks = []
        file_info = []
        
        for i, text in enumerate(course_texts):
            # 檢查文件類型，若為PDF則特殊處理
            file_type = file_types[i] if file_types and i < len(file_types) else "txt"
            file_name = f"文件{i+1}.{file_type}"
            
            print(f"處理文件 {i+1}: {file_type} 類型")
            
            # 分割文本
            chunks = self.split_text_into_chunks(text)
            start_idx = len(all_chunks)
            all_chunks.extend(chunks)
            end_idx = len(all_chunks) - 1
            
            # 記錄文件信息
            file_info.append({
                "file_name": file_name,
                "file_type": file_type,
                "chunk_range": (start_idx, end_idx),
                "chunk_count": len(chunks)
            })
            
            print(f"文件 {i+1} 已處理: 生成了 {len(chunks)} 個段落")
        
        # 更新課程數據
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
            json.dump({
                'course_data': self.course_data,
                'file_info': file_info
            }, f, ensure_ascii=False, indent=2)
        
        with open(os.path.join(session_path, 'embeddings.pkl'), 'wb') as f:
            pickle.dump(self.embeddings, f)
        
        # 生成處理報告
        file_report = "\n".join([f"- {info['file_name']}: {info['chunk_count']} 個段落" for info in file_info])
        report = f"成功處理 {len(course_texts)} 個文件，共 {len(self.course_data)} 個段落\n\n文件詳情:\n{file_report}"
        
        print(f"已處理 {len(course_texts)} 個文件，共 {len(self.course_data)} 個段落")
        return report
    
    def clear_all_data(self):
        shutil.rmtree(self.data_dir)
        os.makedirs(self.data_dir, exist_ok=True)
        self.current_session = None
        self.course_data = []
        self.embeddings = []
        return "已清除所有資料"
    
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
        prompt = f"""請以一位專業教師的角度，根據以下課程內容，設計{num_questions}題高質量的繁體中文單選題。這些題目將用於測驗學生對課程內容的理解和掌握程度。

請確保題目具有教學價值，能夠測試學生的理解深度而非僅是記憶，並且難度適中。每題必須嚴格按照以下格式：

題目1：[題目內容，應該是有思考性的問題，能夠考察學生對概念的理解]
A. [選項A內容]
B. [選項B內容]
C. [選項C內容]
D. [選項D內容]
答案：B

題目2：[題目內容]
A. [選項A內容]
B. [選項B內容]
C. [選項C內容]
D. [選項D內容]
答案：D

注意事項：
1. 每題必須以「題目X：」開頭，X為題號
2. 選項必須為A、B、C、D四個，每個選項單獨一行
3. 答案必須標明為「答案：X」，X為A、B、C、D其中之一，且必須位於每個題目的最後一行
4. 請勿使用「以上皆是」、「以上皆非」等模糊選項
5. 題目必須與提供的課程內容直接相關
6. 所有內容必須使用繁體中文
7. 請確保答案的選項是隨機的，不要全部選A
8. 每個題目的答案必須明確標出，格式為「答案：X」，且必須是最後一行，X必須是A、B、C或D其中之一
9. 題目應該有教育意義，能夠幫助學生鞏固和深化對課程內容的理解
10. 設計的題目應該涵蓋課程內容的不同方面，不要集中在單一概念

課程內容：
{context}"""

        print("呼叫 API 生成題目...")
        result = self.call_groq_api([{"role": "user", "content": prompt}])
        if result:
            print("成功獲取 API 回應")
            full_content = result['choices'][0]['message']['content'].strip()
            # 輸出前100個字元，幫助調試
            print(f"API回應開頭: {full_content[:100]}...")
            
            # 記錄完整回應，方便調試
            print("完整API回應:")
            print("=" * 50)
            print(full_content)
            print("=" * 50)
            
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
                
                # 輸出處理後的內容
                print("處理後的內容:")
                print("-" * 50)
                print(full_content)
                print("-" * 50)
            
            qa_list = self.parse_questions_and_answers(full_content)
            print(f"解析出 {len(qa_list)} 題")
            
            # 轉換為前端可用的格式，但分離題目和答案
            formatted_questions = []
            answers_only = []
            
            for idx, (question, options, answer) in enumerate(qa_list):
                question_data = {
                    "id": idx + 1,
                    "question": question,
                    "options": options
                }
                
                answer_data = {
                    "id": idx + 1,
                    "answer": answer
                }
                
                formatted_questions.append(question_data)
                answers_only.append(answer_data)
            
            # 檢查答案分佈
            answer_distribution = {}
            for q in answers_only:
                answer_distribution[q['answer']] = answer_distribution.get(q['answer'], 0) + 1
            print(f"答案分佈: {answer_distribution}")
            
            return {
                "questions": formatted_questions,
                "answers": answers_only
            }
        else:
            print("API 回應失敗或為空")
            return {
                "questions": [],
                "answers": []
            }

    def parse_questions_and_answers(self, content):
        """
        解析LLM生成的問題和答案文本
        返回三個列表：questions（問題和選項）, answers（答案）和explanations（解析）
        """
        questions = []
        answers = []
        explanations = []
        
        print("開始解析問題，內容長度:", len(content))
        print("內容預覽:", content[:200] + "...")
        
        # 移除常見的介紹性文字
        content = self.remove_introductory_text(content)
        
        # 尋找並移除"答案是X"或"答案為X"等片段
        content = self.remove_answer_text(content)
        
        # 首先嘗試最常見的格式：數字加點/頓號開頭
        question_blocks = []
        
        # 方法1：使用數字+點/頓號作為分割點 (1. 2. 3. etc)
        pattern1 = r'(?:^|\n)\s*(\d+)[\.\、\:]'
        matches = list(re.finditer(pattern1, content))
        
        if matches:
            print(f"找到 {len(matches)} 個數字標題格式的問題")
            for i in range(len(matches)):
                start = matches[i].start()
                end = matches[i+1].start() if i < len(matches) - 1 else len(content)
                block = content[start:end].strip()
                
                # 檢查並剔除這個區塊中可能包含的"答案"部分
                answer_index = self.find_answer_position(block)
                if answer_index > -1:
                    block = block[:answer_index].strip()
                
                question_blocks.append((int(matches[i].group(1)), block))
        else:
            # 方法2：使用「題目X:」格式分割
            pattern2 = r'(?:^|\n)\s*題目\s*(\d+)[\.\、\:]'
            matches = list(re.finditer(pattern2, content))
            
            if matches:
                print(f"找到 {len(matches)} 個「題目X:」格式的問題")
                for i in range(len(matches)):
                    start = matches[i].start()
                    end = matches[i+1].start() if i < len(matches) - 1 else len(content)
                    block = content[start:end].strip()
                    
                    # 檢查並剔除這個區塊中可能包含的"答案"部分
                    answer_index = self.find_answer_position(block)
                    if answer_index > -1:
                        block = block[:answer_index].strip()
                    
                    question_blocks.append((int(matches[i].group(1)), block))
            else:
                # 方法3：使用連續行的題目標記，如空行分隔的題目
                lines = content.split('\n')
                current_block = []
                current_question_num = None
                
                for line in lines:
                    # 檢查是否是答案行
                    if re.search(r'(?:答案|Answer)[\s\:\：][A-D]', line, re.IGNORECASE):
                        if current_block and current_question_num is not None:
                            # 之前的區塊結束，但不包含答案行
                            block_text = '\n'.join(current_block)
                            question_blocks.append((current_question_num, block_text))
                            current_block = []
                            current_question_num = None
                        continue  # 跳過答案行
                    
                    # 檢測新題目標記
                    q_match = re.match(r'\s*(\d+)[\.\、\:]', line)
                    q_match2 = re.search(r'\*\*(?:題目|問題|Question)\s*(\d+)\*\*', line, re.IGNORECASE)
                    
                    if (q_match or q_match2) and (not current_block or line.strip() == '' or len(current_block) > 5):
                        # 保存先前的題目區塊
                        if current_block and current_question_num is not None:
                            block_text = '\n'.join(current_block)
                            question_blocks.append((current_question_num, block_text))
                        
                        # 開始新區塊
                        current_block = [line]
                        current_question_num = int(q_match.group(1) if q_match else q_match2.group(1))
                    else:
                        if current_block:  # 只有在已有區塊時才添加行
                            current_block.append(line)
                
                # 添加最後一個區塊
                if current_block and current_question_num is not None:
                    block_text = '\n'.join(current_block)
                    question_blocks.append((current_question_num, block_text))
                
                print(f"使用行分析方法找到 {len(question_blocks)} 個問題")
        
        # 如果仍然沒有找到問題區塊，則嘗試直接拆分整個文本
        if not question_blocks:
            print("未找到標準格式的問題，嘗試直接拆分文本...")
            # 查找所有可能的選項組
            option_groups = re.findall(r'([A-D][\.\、\:][^\n]+\n[A-D][\.\、\:][^\n]+\n[A-D][\.\、\:][^\n]+\n[A-D][\.\、\:][^\n]+)', content, re.DOTALL)
            
            for i, options_text in enumerate(option_groups):
                # 查找這組選項前面的文本作為問題
                if i == 0:
                    question_text = content.split(options_text)[0].strip()
                else:
                    prev_options = option_groups[i-1]
                    parts = content.split(prev_options)[1].split(options_text)
                    if len(parts) > 0:
                        question_text = parts[0].strip()
                        
                        # 檢查問題文字中是否包含答案標記，如果有則剔除
                        answer_index = self.find_answer_position(question_text)
                        if answer_index > -1:
                            question_text = question_text[:answer_index].strip()
                    else:
                        question_text = f"Question {i+1}"
                
                # 移除問題中可能的數字前綴
                question_text = re.sub(r'^\s*\d+[\.\、\:]\s*', '', question_text)
                
                # 移除問題中可能的 "Answer: X" 文本
                question_text = self.remove_answer_text(question_text)
                
                # 格式化選項
                options = []
                for line in options_text.split('\n'):
                    if re.match(r'^[A-D][\.\、\:]', line):
                        options.append(line.strip())
                
                # 查找答案標記
                answer = None
                answer_section = content.split(options_text)[1].split('答案')[1:2]
                if answer_section:
                    answer_match = re.search(r'[：:]*\s*([A-D])', answer_section[0])
                    if answer_match:
                        answer = answer_match.group(1)
                
                # 如果沒找到答案，默認為A
                if not answer:
                    answer = "A"
                
                question_blocks.append((i+1, f"{i+1}. {question_text}\n{options_text}"))
            
            print(f"通過選項組分析找到 {len(question_blocks)} 個問題")
        
        # 處理找到的問題區塊
        for question_num, block in question_blocks:
            try:
                print(f"處理問題 #{question_num}: {block[:50]}...")
                
                # 先剔除可能存在的答案文本
                clean_block = self.remove_answer_text(block)
                
                # 提取問題內容 - 先移除題號
                first_line = clean_block.split('\n')[0]
                
                # 處理可能帶有 Markdown 標記的問題標題
                if '**' in first_line:
                    md_match = re.search(r'\*\*(?:題目|問題|Question)\s*\d+\*\*\s*(.*)', first_line)
                    if md_match:
                        question_text = md_match.group(1).strip()
                    else:
                        question_text = re.sub(r'^\s*\d+[\.\、\:]\s*', '', first_line)
                        question_text = re.sub(r'\*\*', '', question_text) # 移除剩餘的星號
                else:
                    question_text = re.sub(r'^\s*\d+[\.\、\:]\s*', '', first_line)
                
                # 提取選項
                options = []
                for line in clean_block.split('\n')[1:]:  # 跳過第一行（問題文本）
                    line = line.strip()
                    if re.match(r'^[A-D][\.\、\:]', line):
                        option_text = line  # 保留完整格式的選項
                        options.append(option_text)
                
                # 提取答案
                answer = None
                explanation = None
                for i, line in enumerate(block.split('\n')):
                    answer_match = re.search(r'(?:答案|Answer)[\s\:\：]([A-D])', line, re.IGNORECASE)
                    if answer_match:
                        answer = answer_match.group(1)
                        # 嘗試從答案行之後提取解析
                        explanation_lines = []
                        explanation_started = False
                        
                        lines_after = block.split('\n')[i+1:]
                        for exp_line in lines_after:
                            if re.search(r'(?:解析|解釋|Explanation)', exp_line, re.IGNORECASE):
                                explanation_started = True
                                # 去除"解析:"前綴
                                exp_content = re.sub(r'^(?:解析|解釋|Explanation)[\s\:\：]', '', exp_line).strip()
                                if exp_content:
                                    explanation_lines.append(exp_content)
                            elif explanation_started:
                                # 如果已經開始收集解析，添加後續行
                                if exp_line.strip() and not re.match(r'^\d+[\.\、\:]', exp_line):
                                    explanation_lines.append(exp_line.strip())
                        
                        # 組合解析文本
                        if explanation_lines:
                            explanation = ' '.join(explanation_lines)
                        break
                
                # 如果沒有找到答案，默認使用A
                if not answer and options:
                    answer = "A"  # 默認答案
                
                # 確保有足夠的選項
                while len(options) < 4:
                    missing_option = chr(65 + len(options))  # A, B, C, D
                    options.append(f"{missing_option}. 選項{missing_option}")
                
                # 構建問題數據
                question_data = {
                    "id": question_num,
                    "question": question_text,
                    "options": options
                }
                
                answer_data = {
                    "id": question_num,
                    "answer": answer
                }
                
                # 如果沒有找到解析，創建一個簡單的解析
                if not explanation:
                    explanation = f"題目{question_num}的正確答案是{answer}，這是基於課程內容得出的結論。"
                
                questions.append(question_data)
                answers.append(answer_data)
                explanations.append(explanation)
                
                print(f"成功解析問題 #{question_num}, 選項數: {len(options)}, 答案: {answer}")
                
            except Exception as e:
                print(f"解析問題時出錯: {str(e)}")
                traceback.print_exc()
                continue
        
        print(f"最終解析出 {len(questions)} 個問題")
        return questions, answers, explanations

    def find_answer_position(self, text):
        """查找文本中第一個答案關鍵字的位置"""
        match = re.search(r'(?:^|\n|\s)(?:答案|Answer|正確答案)[^A-Da-d]{0,10}[A-D]', text, re.IGNORECASE)
        if match:
            return match.start()
        return -1

    def remove_answer_text(self, text):
        """移除文本中的答案提示"""
        if not text:
            return text
        
        # 常見的答案文字模式
        answer_patterns = [
            r'(?:^|\n|\s)(?:答案|Answer|正確答案)[^A-Da-d]{0,10}[A-D].*?(?:\n|$)',
            r'(?:^|\n|\s)(?:the answer is|answer is)[^A-Da-d]{0,10}[A-D].*?(?:\n|$)',
        ]
        
        # 檢查每個模式並移除匹配的文字
        for pattern in answer_patterns:
            text = re.sub(pattern, '\n', text, flags=re.IGNORECASE)
        
        return text

    def remove_introductory_text(self, text):
        """
        移除LLM生成的問題前面常見的介紹性文字
        例如：「以下是三個多選題」、「Here are three multiple-choice questions based on the provided content:」等
        """
        if not text:
            return text
        
        # 更安全的處理方式 - 使用簡單字符串檢查而非複雜的正則匹配
        lower_text = text.lower()
        intro_phrases = [
            "here are",
            "following are",
            "i'll create",
            "based on the",
            "以下是",
            "下面是",
            "根據"
        ]
        
        # 只檢查前50個字符
        first_50_chars = lower_text[:50] if len(lower_text) > 50 else lower_text
        
        # 如果文本開頭包含這些短語，嘗試找到第一個換行符
        for phrase in intro_phrases:
            if phrase in first_50_chars:
                # 查找第一個實質性內容的換行符
                lines = text.split('\n')
                for i, line in enumerate(lines):
                    # 如果找到以數字開頭的行，從那行開始
                    if i > 0 and (re.match(r'^\s*\d+[\.\、\:]', line.strip()) or 
                                 re.match(r'^\s*題目\s*\d+[\.\、\:]', line.strip())):
                        return '\n'.join(lines[i:])
                
                # 如果沒找到適合的分割點，只返回原文
                return text
        
        return text

    def answer_query(self, question: str, session_id: Optional[str] = None) -> ConversationResponse:
        """回答用戶問題，實現 RAG 功能"""
        # 檢查課程資料是否存在
        if not self.course_data:
            return ConversationResponse(
                answer="請先上傳課程文件以便我能回答相關問題。",
                sources="",
                history=[],
                session_id=session_id or str(uuid.uuid4())
            )
        
        # 獲取或創建對話
        conversation = self.get_or_create_conversation(session_id)
        
        # 添加用戶問題到對話歷史
        conversation.add_message("user", question)
        
        try:
            # 檢索與問題相關的段落
            relevant_chunks = self.retrieve_relevant_chunks(question, k=3)
            
            if not relevant_chunks:
                answer = "很抱歉，我在課程內容中找不到與您問題相關的信息。請嘗試使用不同的問題或上傳更多相關資料。"
                sources = ""
            else:
                # 構建提示詞
                context = "\n\n".join([chunk for chunk, _ in relevant_chunks])
                
                # 構建消息列表
                messages = [
                    {"role": "system", "content": "你是一個專業的中文教育助手，負責回答關於課程內容的問題。請基於提供的課程內容回答，如果問題沒有相關內容，請誠實地說明。使用繁體中文回覆，給出簡潔明了的答案。"},
                    {"role": "user", "content": f"基於以下課程內容回答我的問題：\n\n{context}\n\n問題：{question}"}
                ]
                
                # 呼叫 LLM API
                response = self.call_groq_api(messages)
                
                if response and 'choices' in response:
                    answer = response['choices'][0]['message']['content']
                    # 準備來源引用
                    sources = "\n\n".join([
                        f"來源 {i+1} (相關度: {score:.2f}):\n{chunk[:150]}..."
                        for i, (chunk, score) in enumerate(relevant_chunks)
                    ])
                else:
                    answer = "很抱歉，我在生成回答時遇到了問題。請稍後再試。"
                    sources = ""
            
            # 添加助手回答到對話歷史
            conversation.add_message("assistant", answer)
            
            # 返回結果
            return ConversationResponse(
                answer=answer,
                sources=sources,
                history=conversation.get_history(),
                session_id=conversation.session_id
            )
            
        except Exception as e:
            error_message = f"處理您的問題時發生錯誤: {str(e)}"
            print(error_message)
            traceback.print_exc()
            
            # 添加錯誤訊息到對話歷史
            conversation.add_message("assistant", error_message)
            
            return ConversationResponse(
                answer=error_message,
                sources="",
                history=conversation.get_history(),
                session_id=conversation.session_id
            )

# 初始化 RAG 系統
rag_system = RAGSystem()

# 建立 FastAPI 應用
app = FastAPI(title="RAG ON CLASS API", description="課程問答系統 API")

# 設定 CORS 允許跨來源請求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 允許所有來源，實際部署時應該限制
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 掛載靜態文件
app.mount("/frontend", StaticFiles(directory="frontend"), name="frontend")

# 在程式結束時自動清空 uploads
atexit.register(rag_system.clear_all_data)

@app.get("/", response_class=HTMLResponse)
async def root():
    # 重定向到前端頁面
    return RedirectResponse(url="/frontend/index.html")

@app.post("/api/upload")
async def upload_files(files: List[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=400, detail="請選擇要上傳的文件")
    
    course_texts = []
    file_types = []
    
    for file in files:
        try:
            content = await file.read()
            file_extension = os.path.splitext(file.filename)[1].lower()
            file_types.append(file_extension[1:] if file_extension else "txt")
            
            if file_extension.lower() == '.pdf':
                # 處理PDF文件
                print(f"處理PDF文件: {file.filename}")
                extracted_text = rag_system.extract_text_from_pdf(content)
                if not extracted_text:
                    raise HTTPException(status_code=500, detail=f"無法從PDF文件中提取文字: {file.filename}")
                course_texts.append(extracted_text)
            else:
                # 處理文本文件
                if isinstance(content, bytes):
                    content = content.decode('utf-8')
                course_texts.append(content)
                
        except UnicodeDecodeError:
            raise HTTPException(status_code=400, detail=f"無法解碼文件內容，請確保上傳的是文本文件或PDF: {file.filename}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"讀取文件時發生錯誤：{str(e)}")
    
    # 準備課程資料
    result = rag_system.prepare_course_data(course_texts, file_types)
    return {"message": result}

@app.post("/api/query")
async def query(request: QueryRequest) -> ConversationResponse:
    result = rag_system.answer_query(request.question, request.session_id)
    return result

@app.post("/generate_questions")
async def generate_questions(request: Request):
    try:
        data = await request.json()
        content = data.get("content", "")
        num_questions = data.get("num_questions", 5)
        language = data.get("language", "zh-TW")  # 預設繁體中文
        
        # 驗證問題數量
        try:
            num_questions = int(num_questions)
            if num_questions < 1 or num_questions > 20:
                return JSONResponse(
                    status_code=400,
                    content={"error": "問題數量必須在1到20之間"}
                )
        except ValueError:
            return JSONResponse(
                status_code=400,
                content={"error": "問題數量必須是數字"}
            )
        
        # 檢查課程數據是否存在
        if not rag_system.course_data:
            return JSONResponse(
                status_code=400,
                content={"error": "請先上傳課程文件"}
            )
        
        if not content:
            # 使用已有的課程內容
            max_context_length = 2000  # 限制內容長度
            content = ""
            for chunk in rag_system.course_data:
                if len(content) + len(chunk) + 1 <= max_context_length:
                    content += chunk + "\n"
                else:
                    break
            
            if not content:
                return JSONResponse(
                    status_code=400,
                    content={"error": "無法取得課程內容"}
                )
        
        # 根據語言設置提示詞
        if language == "zh-TW" or language == "zh":
            prompt = f"""
            請完全使用繁體中文，根據以下內容，生成{num_questions}個選擇題：

            {content}

            請嚴格遵循以下格式和要求：
            1. 完全使用繁體中文，不要使用英文或簡體中文
            2. 每個題目格式如下：
               - 題目開頭為數字編號，如 "1. " 
               - 四個選項分別以A、B、C、D開頭，每個選項獨立一行
               - 正確答案表示為「答案：X」，其中X是A-D中的一個字母
               - 每題之後應有解析，以「解析：」開頭

            例如：
            1. [問題內容]
            A. [選項A內容]
            B. [選項B內容]
            C. [選項C內容]
            D. [選項D內容]
            答案：B
            解析：[解釋為什麼B是正確答案]

            2. [下一題問題內容]
            ...

            ⚠️ 重要提醒：
            - 必須使用繁體中文，不可使用英文或簡體中文
            - 每個問題都必須是選擇題，有且僅有A、B、C、D四個選項
            - 每個選項的內容必須不同，不能有重複的選項文字
            - 每個問題必須有明確的一個正確答案
            - 每個題目必須包含解析，說明為什麼答案是正確的
            - 問題內容必須基於提供的材料，不要編造不相關的內容
            """
        else:
            # 預設也是繁體中文，以防萬一
            prompt = f"""
            根據以下內容，生成{num_questions}個選擇題（必須使用繁體中文）：

            {content}

            請嚴格遵循以下格式：
            1. 問題內容
            A. 選項A
            B. 選項B
            C. 選項C
            D. 選項D
            答案：X（其中X是正確選項的字母）
            解析：(簡短解釋為什麼X是正確答案)

            要求：
            1. 每個問題都必須是選擇題，有且僅有A、B、C、D四個選項
            2. 每個選項的內容必須不同，不能有重複的選項文字
            3. 每個問題都必須有明確的一個正確答案
            4. 每個題目都必須包含解析，說明為什麼答案是正確的
            5. 問題難度要適中，不要太簡單
            6. 問題內容要基於提供的材料，不要編造不相關的內容
            7. 所有內容必須使用繁體中文
            """
        
        # 調用 Groq API 生成問題
        messages = [
            {"role": "system", "content": "你是一個專業的教育測驗出題專家，擅長根據教材內容出繁體中文選擇題。你必須只使用繁體中文回應，絕對不使用英文或簡體中文。"},
            {"role": "user", "content": prompt}
        ]
        
        try:
            print(f"調用 API 生成 {num_questions} 個繁體中文問題...")
            response_data = rag_system.call_groq_api(messages)
            
            if not response_data or 'choices' not in response_data or not response_data['choices']:
                return JSONResponse(
                    status_code=500,
                    content={"error": "調用 API 生成問題失敗或回應格式不正確"}
                )

            # 解析回應
            generated_content = response_data['choices'][0]['message']['content']
            
            # 輸出生成的內容以便調試
            print(f"API返回的原始內容: {generated_content[:200]}...")
            
            # 檢查是否包含英文（除了選項A、B、C、D外）- 查找有5個以上連續英文字母
            english_content = re.findall(r'[a-zA-Z]{5,}', generated_content)
            if english_content:
                print(f"警告：生成的內容包含英文: {english_content[:5]}，嘗試重新生成...")
                # 不要直接替換成含特殊字符的文本，而是先處理英文內容，然後再解析
                # 創建一個清理後的副本用於解析
                parsed_content = generated_content
                # 不使用中文引號替換，避免干擾正則表達式
                for word in set(english_content):
                    if len(word) > 5 and word.lower() not in ["answer", "question", "explanation"]:  # 保留常見問題相關英文詞
                        parsed_content = parsed_content.replace(word, f"_{word}_")
                
                # 使用清理後的內容進行解析
                result = rag_system.parse_questions_and_answers(parsed_content)
            else:
                # 使用原始內容進行解析
                result = rag_system.parse_questions_and_answers(generated_content)
            
            if not result or len(result) < 3 or len(result[0]) == 0:
                return JSONResponse(
                    status_code=500,
                    content={"error": "未能生成有效的問題"}
                )
            
            questions, answers, explanations = result[0], result[1], result[2]
            
            print(f"成功解析 {len(questions)} 個題目和 {len(answers)} 個答案")
            return JSONResponse(content={
                "questions": questions, 
                "answers": answers,
                "explanations": explanations
            })
            
        except Exception as api_error:
            print(f"API調用錯誤: {str(api_error)}")
            traceback.print_exc()
            return JSONResponse(
                status_code=500,
                content={"error": f"API調用錯誤: {str(api_error)}"}
            )
            
    except Exception as e:
        print(f"生成問題時出錯: {str(e)}")
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"error": f"生成問題時發生錯誤: {str(e)}"}
        )

@app.get("/api/clear-data")
async def clear_data():
    result = rag_system.clear_all_data()
    return {"message": result}

@app.get("/api/conversations/{session_id}")
async def get_conversation(session_id: str):
    if session_id in rag_system.conversations:
        return rag_system.conversations[session_id].to_dict()
    raise HTTPException(status_code=404, detail=f"找不到指定的對話 ID: {session_id}")

@app.get("/api/file-content")
async def get_file_content():
    """獲取當前處理的文件內容"""
    if not rag_system.current_session:
        return JSONResponse(
            status_code=400,
            content={"error": "尚未處理任何文件"}
        )
    
    try:
        # 讀取課程數據文件
        data_path = os.path.join(rag_system.current_session, 'course_data.json')
        if not os.path.exists(data_path):
            return JSONResponse(
                status_code=404,
                content={"error": "找不到課程數據文件"}
            )
        
        with open(data_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        return JSONResponse(content=data)
    except Exception as e:
        print(f"獲取文件內容時發生錯誤: {str(e)}")
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"error": f"獲取文件內容時發生錯誤: {str(e)}"}
        )

if __name__ == "__main__":
    uvicorn.run("backend:app", host="0.0.0.0", port=8000, reload=True) 