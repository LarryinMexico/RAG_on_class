// 全局常數
const API_BASE_URL = 'http://localhost:8000';

// 全局變數
let currentQuestions = [];

// DOM 元素
document.addEventListener('DOMContentLoaded', () => {
    // Tab 切換
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabPanes = document.querySelectorAll('.tab-pane');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.getAttribute('data-tab');
            
            // 移除所有 active 類別
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabPanes.forEach(pane => pane.classList.remove('active'));
            
            // 添加 active 類別到當前選中的標籤
            button.classList.add('active');
            document.getElementById(tabId).classList.add('active');
        });
    });
    
    // 文件上傳處理
    const fileInput = document.getElementById('file-input');
    const fileList = document.getElementById('file-list');
    const uploadBtn = document.getElementById('upload-btn');
    const uploadStatus = document.getElementById('upload-status');
    
    fileInput.addEventListener('change', () => {
        fileList.innerHTML = '';
        
        if (fileInput.files.length > 0) {
            Array.from(fileInput.files).forEach(file => {
                const fileItem = document.createElement('div');
                fileItem.className = 'file-item';
                fileItem.textContent = file.name;
                fileList.appendChild(fileItem);
            });
        }
    });
    
    uploadBtn.addEventListener('click', async () => {
        if (fileInput.files.length === 0) {
            showStatus(uploadStatus, '請選擇要上傳的文件', 'error');
            return;
        }
        
        uploadBtn.disabled = true;
        uploadBtn.innerHTML = '<span class="loading"></span> 處理中...';
        
        const formData = new FormData();
        Array.from(fileInput.files).forEach(file => {
            formData.append('files', file);
        });
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/upload`, {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (response.ok) {
                showStatus(uploadStatus, data.message, 'success');
            } else {
                showStatus(uploadStatus, data.detail || '上傳失敗', 'error');
            }
        } catch (error) {
            console.error('上傳錯誤:', error);
            showStatus(uploadStatus, '連接伺服器時發生錯誤', 'error');
        } finally {
            uploadBtn.disabled = false;
            uploadBtn.textContent = '處理上傳的文件';
        }
    });
    
    // 問答系統處理
    const questionInput = document.getElementById('question-input');
    const queryBtn = document.getElementById('query-btn');
    const answerOutput = document.getElementById('answer-output');
    const sourceOutput = document.getElementById('source-output');
    
    queryBtn.addEventListener('click', async () => {
        const question = questionInput.value.trim();
        
        if (!question) {
            return;
        }
        
        queryBtn.disabled = true;
        queryBtn.innerHTML = '<span class="loading"></span> 思考中...';
        answerOutput.innerHTML = '正在處理您的問題...';
        sourceOutput.innerHTML = '';
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/query`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ question })
            });
            
            const data = await response.json();
            
            answerOutput.textContent = data.answer || '無法獲取回答';
            sourceOutput.textContent = data.sources || '';
            
        } catch (error) {
            console.error('查詢錯誤:', error);
            answerOutput.textContent = '連接伺服器時發生錯誤';
        } finally {
            queryBtn.disabled = false;
            queryBtn.textContent = '提交問題';
        }
    });
    
    // 生成題目處理
    const numQuestionsInput = document.getElementById('num-questions');
    const generateBtn = document.getElementById('generate-btn');
    const questionsOutput = document.getElementById('questions-output');
    const showAnswersBtn = document.getElementById('show-answers-btn');
    const answersContainer = document.getElementById('answers-container');
    const answersOutput = document.getElementById('answers-output');
    
    generateBtn.addEventListener('click', async () => {
        const numQuestions = parseInt(numQuestionsInput.value) || 5;
        
        generateBtn.disabled = true;
        generateBtn.innerHTML = '<span class="loading"></span> 生成中...';
        questionsOutput.innerHTML = '正在生成題目，這可能需要一些時間...';
        answersContainer.style.display = 'none';
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/generate-questions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ num_questions: numQuestions })
            });
            
            const data = await response.json();
            
            if (data.error) {
                questionsOutput.textContent = data.error;
                return;
            }
            
            if (data.questions && data.questions.length > 0) {
                currentQuestions = data.questions;
                displayQuestions(currentQuestions, questionsOutput);
            } else {
                questionsOutput.textContent = '無法生成題目';
            }
            
        } catch (error) {
            console.error('生成題目錯誤:', error);
            questionsOutput.textContent = '連接伺服器時發生錯誤';
        } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = '生成題目';
        }
    });
    
    showAnswersBtn.addEventListener('click', () => {
        if (currentQuestions.length === 0) {
            return;
        }
        
        if (answersContainer.style.display === 'none') {
            displayAnswers(currentQuestions, answersOutput);
            answersContainer.style.display = 'block';
            showAnswersBtn.textContent = '隱藏標準答案';
        } else {
            answersContainer.style.display = 'none';
            showAnswersBtn.textContent = '顯示標準答案';
        }
    });
});

// 輔助函數
function showStatus(element, message, type) {
    element.textContent = message;
    element.className = 'status-message';
    element.classList.add(type);
    element.style.display = 'block';
    
    // 5 秒後自動隱藏
    setTimeout(() => {
        element.style.display = 'none';
    }, 5000);
}

function displayQuestions(questions, container) {
    container.innerHTML = '';
    
    questions.forEach(question => {
        const questionItem = document.createElement('div');
        questionItem.className = 'question-item';
        
        const questionTitle = document.createElement('div');
        questionTitle.className = 'question-title';
        questionTitle.textContent = `第${question.id}題：${question.question}`;
        
        const optionsList = document.createElement('ul');
        optionsList.className = 'options-list';
        
        question.options.forEach(option => {
            const optionItem = document.createElement('li');
            optionItem.className = 'option-item';
            optionItem.textContent = option;
            optionsList.appendChild(optionItem);
        });
        
        questionItem.appendChild(questionTitle);
        questionItem.appendChild(optionsList);
        container.appendChild(questionItem);
    });
}

function displayAnswers(questions, container) {
    container.innerHTML = '';
    
    questions.forEach(question => {
        const answerItem = document.createElement('div');
        answerItem.className = 'answer-item';
        answerItem.textContent = `第${question.id}題答案：${question.answer}`;
        container.appendChild(answerItem);
    });
} 