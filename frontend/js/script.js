// 全局常數
const API_BASE_URL = '';  // 使用相對路徑

// 全局變數
let currentQuestions = [];
let currentSessionId = localStorage.getItem('session_id') || '';
let conversationHistory = [];

// 全局變量初始化
window.standardAnswers = {};
window.userAnswers = {};
window.answerExplanations = {};

// DOM 元素
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM 已加載完成，開始初始化");
    
    // 設定深色模式
    document.documentElement.style.setProperty('--primary-color', '#dd965c');
    document.documentElement.style.setProperty('--primary-dark', '#b8783e');
    document.documentElement.style.setProperty('--text-color', '#f0f0f0');
    document.documentElement.style.setProperty('--dark-gray', '#888');
    document.documentElement.style.setProperty('--light-gray', '#333');
    document.documentElement.style.setProperty('--white', '#222');
    document.documentElement.style.setProperty('--user-message-bg', '#222');
    document.documentElement.style.setProperty('--assistant-message-bg', '#333');
    document.documentElement.style.setProperty('--error-color', '#ff6b6b');
    
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
    const uploadArea = document.querySelector('.upload-area');
    
    // 拖曳上傳功能
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.add('dragover');
    });
    
    uploadArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.remove('dragover');
    });
    
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.remove('dragover');
        
        if (e.dataTransfer.files.length > 0) {
            fileInput.files = e.dataTransfer.files;
            // 觸發change事件
            const event = new Event('change');
            fileInput.dispatchEvent(event);
        }
    });
    
    fileInput.addEventListener('change', () => {
        fileList.innerHTML = '';
        
        if (fileInput.files.length > 0) {
            // 隱藏文件選擇按鈕
            document.querySelector('.file-label').style.display = 'none';
            
            Array.from(fileInput.files).forEach(file => {
                const fileItem = document.createElement('div');
                fileItem.className = 'file-item';
                
                // 添加文件類型圖標
                const fileType = file.name.split('.').pop().toLowerCase();
                let fileIcon = '📄';
                if (fileType === 'pdf') {
                    fileIcon = '📕';
                } else if (['jpg', 'jpeg', 'png', 'gif'].includes(fileType)) {
                    fileIcon = '🖼️';
                }
                
                fileItem.innerHTML = `
                    <span class="file-icon">${fileIcon}</span>
                    <span class="file-name">${file.name}</span>
                    <span class="file-size">(${formatFileSize(file.size)})</span>
                `;
                fileList.appendChild(fileItem);
            });
            
            // 添加重新選擇按鈕
            const resetBtn = document.createElement('button');
            resetBtn.className = 'secondary-btn reset-files-btn';
            resetBtn.textContent = '重新選擇文件';
            resetBtn.onclick = function() {
                document.querySelector('.file-label').style.display = 'inline-block';
                fileInput.value = '';
                fileList.innerHTML = '';
                this.remove();
            };
            fileList.appendChild(resetBtn);
        } else {
            // 確保文件選擇按鈕可見
            document.querySelector('.file-label').style.display = 'inline-block';
        }
    });
    
    uploadBtn.addEventListener('click', async () => {
        if (fileInput.files.length === 0) {
            showStatus(uploadStatus, '請選擇要上傳的文件', 'error');
            return;
        }
        
        // 顯示全屏覆蓋層
        showOverlay('正在處理上傳的文件，請稍候...');
        
        uploadBtn.disabled = true;
        // 移除按鈕上的轉圈圈效果
        uploadBtn.textContent = '處理中...';
        
        // 平滑過渡到處理狀態
        const processingResult = document.getElementById('processing-result');
        if (processingResult) {
            processingResult.innerHTML = `
                <div class="loading-container">
                    <p>正在處理文件，請稍候...</p>
                </div>
            `;
            processingResult.style.opacity = '0';
            setTimeout(() => {
                processingResult.style.opacity = '1';
            }, 50);
        }
        
        const formData = new FormData();
        const hasPdf = Array.from(fileInput.files).some(file => file.name.toLowerCase().endsWith('.pdf'));
        
        Array.from(fileInput.files).forEach(file => {
            formData.append('files', file);
        });
        
        try {
            // 如果有PDF文件，更新覆蓋層消息
            if (hasPdf) {
                showOverlay('正在處理PDF文件，這可能需要一些時間...');
                
                // 創建處理狀態更新計時器
                let processingTime = 0;
                const processingInterval = setInterval(() => {
                    processingTime += 2;
                    if (processingTime <= 60) {
                        showOverlay(`正在處理PDF文件 (${processingTime}秒)...\n正在提取文字內容和圖片信息`);
                    } else {
                        showOverlay(`PDF處理時間較長 (${processingTime}秒)...\n可能正在進行OCR處理，請耐心等待`);
                    }
                }, 2000);
            }
            
            const response = await fetch(`${API_BASE_URL}/api/upload`, {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            // 清除可能存在的處理狀態計時器
            if (hasPdf && typeof processingInterval !== 'undefined') {
                clearInterval(processingInterval);
            }
            
            if (response.ok) {
                // 隱藏覆蓋層
                hideOverlay();
                
                // 成功時不顯示狀態消息
                // showStatus(uploadStatus, data.message, 'success');
                
                // 更新處理結果預覽
                updateProcessingResult(data);
                
                // 顯示已上傳文件列表 - 移除此功能防止顯示額外內容
                // updateUploadedFilesList(fileInput.files);
                
                // 如果成功上傳，清空文件列表但不隱藏上傳按鈕
                fileList.innerHTML = '';
                fileInput.value = '';
                
                // 確保文件選擇按鈕可見
                document.querySelector('.file-label').style.display = 'inline-block';
            } else {
                // 隱藏覆蓋層
                hideOverlay();
                
                showStatus(uploadStatus, data.detail || '上傳失敗', 'error');
            }
        } catch (error) {
            // 隱藏覆蓋層
            hideOverlay();
            
            console.error('上傳錯誤:', error);
            // 移除錯誤消息顯示
            // showStatus(uploadStatus, '連接伺服器時發生錯誤', 'error');
        } finally {
            uploadBtn.disabled = false;
            uploadBtn.textContent = '處理上傳的文件';
            
            // 重置上傳區域狀態，使其可再次上傳
            document.querySelector('.file-label').style.display = 'inline-block';
        }
    });
    
    // 更新處理結果預覽
    function updateProcessingResult(data) {
        const processingResult = document.getElementById('processing-result');
        if (!processingResult) return;
        
        const message = data.message || '';
        const paragraphCount = message.match(/共\s*(\d+)\s*個段落/);
        const count = paragraphCount ? paragraphCount[1] : '0';
        
        // 設置透明度為0，準備平滑過渡
        processingResult.style.opacity = '0';
        
        // 使用延遲來創建淡入效果
        setTimeout(() => {
            let html = `
                <div class="result-summary">
                    <h5>處理完成</h5>
                    <p>成功處理 ${Array.from(fileInput.files).length} 個文件，生成了 ${count} 個文本段落。</p>
                </div>
                <div class="result-details">
                    <h5>文件列表</h5>
                    <ul class="processed-files">
            `;
            
            Array.from(fileInput.files).forEach(file => {
                const fileType = file.name.split('.').pop().toLowerCase();
                let fileIcon = '📄';
                if (fileType === 'pdf') {
                    fileIcon = '📕';
                } else if (['jpg', 'jpeg', 'png', 'gif'].includes(fileType)) {
                    fileIcon = '🖼️';
                }
                
                html += `<li>${fileIcon} ${file.name} (${formatFileSize(file.size)})</li>`;
            });
            
            html += `
                    </ul>
                    <h5>系統訊息</h5>
                    <div class="system-message">${message}</div>
                </div>
            `;
            
            processingResult.innerHTML = html;
            
            // 淡入效果
            processingResult.style.opacity = '1';
            
            // 獲取並顯示文件內容
            fetchFileContent();
        }, 300);
    }
    
    // 獲取處理後的文件內容
    async function fetchFileContent() {
        const fileContent = document.getElementById('file-content');
        if (!fileContent) return;
        
        try {
            // 顯示加載中
            fileContent.innerHTML = '<p class="loading-text">正在獲取文件內容...</p>';
            
            // 獲取當前會話的文件內容
            const response = await fetch(`${API_BASE_URL}/api/file-content`);
            
            if (!response.ok) {
                fileContent.innerHTML = '<p class="no-data">無法獲取文件內容。</p>';
                return;
            }
            
            const data = await response.json();
            
            if (data.course_data && data.course_data.length > 0) {
                // 保存數據以供切換顯示
                window.fileContentData = data;
                
                // 默認顯示文本內容
                showFileContent('text');
                
                // 設置標籤切換事件
                setupContentTabs();
            } else {
                fileContent.innerHTML = '<p class="no-data">沒有可顯示的文件內容。</p>';
            }
        } catch (error) {
            console.error('獲取文件內容錯誤:', error);
            fileContent.innerHTML = '<p class="no-data">獲取文件內容時發生錯誤。</p>';
        }
    }
    
    // 設置內容標籤切換
    function setupContentTabs() {
        const contentTabs = document.querySelectorAll('.content-tab');
        
        contentTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                // 移除所有活動狀態
                contentTabs.forEach(t => t.classList.remove('active'));
                
                // 添加當前標籤的活動狀態
                tab.classList.add('active');
                
                // 顯示對應內容
                const contentType = tab.dataset.content;
                showFileContent(contentType);
            });
        });
    }
    
    // 顯示文件內容
    function showFileContent(contentType) {
        const fileContent = document.getElementById('file-content');
        if (!fileContent || !window.fileContentData) return;
        
        if (contentType === 'text') {
            // 顯示文本內容
            const textContent = window.fileContentData.course_data.join('\n\n---\n\n');
            fileContent.innerHTML = `<pre>${escapeHtml(textContent)}</pre>`;
        } else if (contentType === 'json') {
            // 顯示JSON結構
            const jsonContent = JSON.stringify(window.fileContentData, null, 2);
            fileContent.innerHTML = `<pre>${escapeHtml(jsonContent)}</pre>`;
        }
    }
    
    // HTML轉義，防止XSS
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // 格式化文件大小
    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        else return (bytes / 1048576).toFixed(1) + ' MB';
    }
    
    // 問答系統處理
    const questionInput = document.getElementById('question-input');
    const queryBtn = document.getElementById('query-btn');
    const answerOutput = document.getElementById('answer-output');
    const sourceOutput = document.getElementById('source-output');
    const chatHistoryContainer = document.getElementById('chat-history');
    const clearChatBtn = document.getElementById('clear-chat-btn');
    
    // 載入之前的對話歷史
    if (currentSessionId) {
        loadConversationHistory();
    }
    
    queryBtn.addEventListener('click', async () => {
        const question = questionInput.value.trim();
        
        if (!question) {
            return;
        }
        
        queryBtn.disabled = true;
        // 移除轉圈效果，改為純文字
        queryBtn.textContent = '處理中...';
        
        // 先將用戶問題添加到UI
        addMessageToUI('user', question);
        answerOutput.innerHTML = '正在處理您的問題...';
        sourceOutput.innerHTML = '';
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/query`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    question, 
                    session_id: currentSessionId 
                })
            });
            
            const data = await response.json();
            
            // 保存或更新會話ID
            if (data.session_id) {
                currentSessionId = data.session_id;
                localStorage.setItem('session_id', currentSessionId);
            }
            
            // 更新對話歷史
            conversationHistory = data.history || conversationHistory;
            
            // 更新UI - 使用 innerHTML 來支援 Markdown 格式
            if (typeof marked !== 'undefined') {
                // 如果有 marked 庫，使用它來解析 Markdown
                answerOutput.innerHTML = marked.parse(data.answer || '無法獲取回答');
            } else {
                // 否則使用 innerHTML 直接設置內容，允許基本的 HTML 格式
                answerOutput.innerHTML = data.answer || '無法獲取回答';
            }
            
            sourceOutput.textContent = data.sources || '';
            
            // 添加回答到對話歷史UI
            addMessageToUI('assistant', data.answer);
            
            // 清空輸入框
            questionInput.value = '';
            
        } catch (error) {
            console.error('查詢錯誤:', error);
            answerOutput.textContent = '連接伺服器時發生錯誤';
            addMessageToUI('error', '連接伺服器時發生錯誤');
        } finally {
            queryBtn.disabled = false;
            queryBtn.textContent = '提交問題';
        }
    });
    
    // 回車鍵提交問題
    questionInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            queryBtn.click();
        }
    });
    
    // 清空對話歷史
    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', () => {
            // 清空本地存儲和UI
            localStorage.removeItem('session_id');
            currentSessionId = '';
            conversationHistory = [];
            if (chatHistoryContainer) {
                chatHistoryContainer.innerHTML = '';
            }
            answerOutput.textContent = '';
            sourceOutput.textContent = '';
            
            showStatus(document.getElementById('chat-status') || uploadStatus, '對話歷史已清空', 'success');
        });
    }
    
    // 生成題目相關初始化
    console.log("初始化生成題目功能");
    const questionsOutput = document.getElementById('questions-output');
    const checkAnswersBtn = document.getElementById('check-answers-btn');
    
    // 確保檢查答案按鈕正常工作
    if (checkAnswersBtn) {
        console.log("找到檢查答案按鈕，綁定事件");
        checkAnswersBtn.addEventListener('click', checkAllAnswers);
    } else {
        console.error("無法找到檢查答案按鈕");
    }
    
    // 注意：生成題目按鈕現在直接使用 HTML onclick 屬性綁定事件
    // 不再使用 JavaScript 添加事件監聽器
    console.log("生成題目按鈕使用 HTML onclick 屬性綁定事件");
    
    console.log("DOM 初始化完成");
});

// 輔助函數
function showStatus(element, message, type, autoHide = true) {
    // 先設置透明度為0
    element.style.opacity = '0';
    
    // 稍後更新內容並顯示
    setTimeout(() => {
        element.innerHTML = message;
        element.className = 'status-message';
        element.classList.add(type);
        element.style.display = 'block';
        
        // 淡入效果
        element.style.opacity = '1';
        
        // 如果設置了自動隱藏，5秒後自動隱藏
        if (autoHide) {
            setTimeout(() => {
                // 先淡出
                element.style.opacity = '0';
                setTimeout(() => {
                    element.style.display = 'none';
                }, 300);
            }, 5000);
        }
    }, 100);
}

function displayQuestions(questions, answers, explanations) {
    console.log("顯示題目", { 
        questions: questions ? questions.length : 0, 
        answers: answers ? answers.length : 0,
        explanations: explanations ? explanations.length : 0
    });
    
    const questionsDisplay = document.getElementById('questions-display');
    const checkAnswersBtn = document.getElementById('check-answers-btn');
    const bottomControls = document.querySelector('.bottom-controls');
    
    if (!questionsDisplay) {
        console.error("無法找到題目顯示區域");
        return;
    }
    
    // 清空顯示區域
    questionsDisplay.innerHTML = '';
    
    // 初始化標準答案
    window.standardAnswers = {};
    window.userAnswers = {};
    window.answerExplanations = {};
    
    try {
        // 檢查是否有題目
        if (!questions || questions.length === 0) {
            questionsDisplay.innerHTML = '<div class="error-message"><div class="error-icon">⚠️</div><div class="error-content"><p>沒有生成任何題目，請重試</p></div></div>';
            return;
        }
        
        console.log("題目樣本:", JSON.stringify(questions[0]).substring(0, 200));
        
        // 遍歷所有題目並顯示
        for (let index = 0; index < questions.length; index++) {
            try {
                const questionId = index + 1;
                const question = questions[index];
                
                // 存儲標準答案和解析
                if (answers && answers[index]) {
                    const answerValue = typeof answers[index] === 'object' && answers[index].answer
                        ? answers[index].answer
                        : answers[index];
                    window.standardAnswers[questionId] = answerValue;
                    console.log(`題目 #${questionId} 的標準答案:`, window.standardAnswers[questionId]);
                } else {
                    window.standardAnswers[questionId] = "A"; // 默認答案
                }
                
                if (explanations && explanations[index]) {
                    window.answerExplanations[questionId] = explanations[index];
                }
                
                // 創建問題元素
                let questionElement;
                let questionData;
                
                // 處理不同格式的問題數據
                if (typeof question === 'object' && question !== null) {
                    // 對象格式（例如{id: 1, question: "問題文本", options: ["A. 選項A", ...]}）
                    console.log(`處理對象格式題目 #${questionId}`);
                    
                    questionData = {
                        id: questionId,
                        question: question.question || `題目 ${questionId}`,
                        options: Array.isArray(question.options) ? question.options : []
                    };
                } else if (typeof question === 'string') {
                    // 字符串格式（需要解析問題和選項）
                    console.log(`處理字符串格式題目 #${questionId}`);
                    
                    // 移除介紹性文字和答案文本
                    const cleanedText = removeIntroductoryText(filterAnswerText(question));
                    
                    // 解析問題文本並提取選項
                    const questionLines = cleanedText.split('\n');
                    const questionTitle = questionLines[0].trim();
                    const options = questionLines.slice(1).filter(line => /^[A-D][\.\、\:]/.test(line.trim()));
                    
                    questionData = {
                        id: questionId,
                        question: questionTitle || `題目 ${questionId}`,
                        options: options
                    };
                } else {
                    // 不支持的格式，創建錯誤元素
                    console.error(`題目 ${questionId} 格式不支持:`, typeof question);
                    
                    const errorElement = document.createElement('div');
                    errorElement.className = 'question-item error';
                    errorElement.innerHTML = `
                        <div class="question-header">
                            <h3>題目 ${questionId} (格式錯誤)</h3>
                        </div>
                        <div class="error-message">
                            <div class="error-icon">⚠️</div>
                            <div class="error-content">
                                <p>此題目格式不支持: ${typeof question}</p>
                            </div>
                        </div>
                    `;
                    
                    questionsDisplay.appendChild(errorElement);
                    continue;
                }
                
                // 使用問題數據創建元素
                questionElement = createQuestionElement(questionData);
                
                // 添加到顯示容器
                questionsDisplay.appendChild(questionElement);
            } catch (err) {
                console.error(`處理題目 ${index + 1} 時出錯:`, err);
                
                // 創建一個錯誤題目元素
                const errorElement = document.createElement('div');
                errorElement.className = 'question-item error';
                errorElement.innerHTML = `
                    <div class="question-header">
                        <h3>題目 ${index + 1} (處理錯誤)</h3>
                    </div>
                    <div class="error-message">
                        <div class="error-icon">⚠️</div>
                        <div class="error-content">
                            <p>此題目處理時發生錯誤: ${err.message}</p>
                            <p>詳細信息: ${err.stack}</p>
                        </div>
                    </div>
                `;
                questionsDisplay.appendChild(errorElement);
            }
        }
        
        // 顯示底部的檢查答案按鈕
        if (bottomControls) {
            bottomControls.style.display = 'block';
        }
        
        // 顯示檢查答案按鈕
        if (checkAnswersBtn) {
            checkAnswersBtn.style.display = 'block';
        }
        
        // 設置返回頂部按鈕
        setupBackToTopButton();
    } catch (error) {
        console.error("顯示題目時發生錯誤:", error);
        questionsDisplay.innerHTML = `
            <div class="error-message">
                <div class="error-icon">⚠️</div>
                <div class="error-content">
                    <h4>顯示題目時發生錯誤</h4>
                    <p>${error.message}</p>
                    <p>詳細信息: ${error.stack}</p>
                </div>
            </div>
        `;
    }
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

// 對話歷史相關函數
async function loadConversationHistory() {
    if (!currentSessionId) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/conversations/${currentSessionId}`);
        
        if (!response.ok) {
            // 會話可能已過期，清除本地存儲
            localStorage.removeItem('session_id');
            currentSessionId = '';
            return;
        }
        
        const data = await response.json();
        conversationHistory = data.history || [];
        
        // 更新UI
        const chatHistoryContainer = document.getElementById('chat-history');
        if (chatHistoryContainer && conversationHistory.length > 0) {
            chatHistoryContainer.innerHTML = '';
            conversationHistory.forEach(msg => {
                addMessageToUI(msg.role, msg.content, false);
            });
        }
    } catch (error) {
        console.error('載入對話歷史失敗:', error);
    }
}

function addMessageToUI(role, content, scrollToBottom = true) {
    const chatHistoryContainer = document.getElementById('chat-history');
    if (!chatHistoryContainer) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}-message`;
    
    // 使用marked.js解析Markdown
    const parsedContent = typeof marked !== 'undefined' && role === 'assistant' ? marked.parse(content) : content;
    
    // 針對不同角色設置不同樣式
    if (role === 'user') {
        messageDiv.innerHTML = `
            <div class="message-header">
                <div class="message-avatar">👤</div>
                <div>您</div>
            </div>
            <div class="message-content">${content}</div>
        `;
    } else if (role === 'assistant') {
        messageDiv.innerHTML = `
            <div class="message-header">
                <div class="message-avatar">🤖</div>
                <div>RAG ON CLASS</div>
            </div>
            <div class="message-content markdown-content">${parsedContent}</div>
        `;
    } else {
        messageDiv.innerHTML = `
            <div class="message-content error">${content}</div>
        `;
    }
    
    chatHistoryContainer.appendChild(messageDiv);
    
    // 滾動到底部
    if (scrollToBottom) {
        chatHistoryContainer.scrollTop = chatHistoryContainer.scrollHeight;
    }
}

// 創建單個問題的 DOM 元素
function createQuestionElement({ id, question, options }) {
    console.log(`創建問題元素 #${id}:`, { 
        question: question?.substring?.(0, 30) + '...',
        options: Array.isArray(options) ? options.length : 'not an array' 
    });
    
    // 創建問題元素
    const questionElement = document.createElement('div');
    questionElement.className = 'question-item';
    questionElement.dataset.questionId = id;
    questionElement.id = `question-${id}`;
    
    // 創建標題容器
    const titleContainer = document.createElement('div');
    titleContainer.className = 'question-title-container';
    
    // 創建問題頭部
    const questionHeader = document.createElement('div');
    questionHeader.className = 'question-header';
    
    // 創建問題標題
    const questionTitle = document.createElement('h3');
    questionTitle.textContent = `題目 ${id}`;
    questionHeader.appendChild(questionTitle);
    
    // 添加問題頭部到標題容器
    titleContainer.appendChild(questionHeader);
    
    // 創建問題內容
    const questionContent = document.createElement('div');
    questionContent.className = 'question-content';
    
    // 添加問題文本
    const questionText = document.createElement('div');
    questionText.className = 'question-text';
    questionText.textContent = question;
    questionContent.appendChild(questionText);
    
    // 創建選項容器
    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'options';

    // 標準化選項
    const processedOptions = [];
    
    // 驗證選項格式
    let validOptions = [];
    if (Array.isArray(options)) {
        console.log(`題目 #${id} 有 ${options.length} 個選項`);
        validOptions = options.slice(0, 4); // 只取前4個選項
    } else if (typeof options === 'string') {
        console.log(`題目 #${id} 選項是字符串，嘗試拆分`);
        const optionLines = options.split('\n');
        validOptions = optionLines.filter(line => /^[A-D][\.\、\:]/.test(line.trim()));
        validOptions = validOptions.slice(0, 4); // 只取前4個選項
    } else {
        console.warn(`題目 #${id} 選項格式無效: ${typeof options}`);
        validOptions = [
            'A. 選項A',
            'B. 選項B',
            'C. 選項C',
            'D. 選項D'
        ];
    }
    
    // 處理選項
    if (validOptions.length > 0) {
        validOptions.forEach((option, index) => {
            let optionText = option;
            let optionLetter = '';
            
            // 提取選項字母和選項內容
            if (typeof option === 'string') {
                const match = option.match(/^([A-D])[\.。、\:\s]+(.*)/);
                if (match) {
                    optionLetter = match[1];
                    optionText = match[2];
                } else {
                    // 如果沒有匹配到標準格式，則使用索引生成選項字母
                    optionLetter = String.fromCharCode(65 + index); // A, B, C, D...
                }
            } else if (typeof option === 'object' && option !== null) {
                // 如果選項是對象格式，嘗試提取值
                if (option.text) {
                    optionText = option.text;
                    optionLetter = option.letter || String.fromCharCode(65 + index);
                } else {
                    optionLetter = String.fromCharCode(65 + index);
                    optionText = `選項${optionLetter}`;
                }
            }
            
            processedOptions.push({ letter: optionLetter, text: optionText });
        });
    }
    
    // 確保至少有A、B兩個選項，且不超過4個
    if (processedOptions.length < 2) {
        while (processedOptions.length < 2) {
            const letter = String.fromCharCode(65 + processedOptions.length);
            processedOptions.push({
                letter: letter,
                text: `選項${letter}`
            });
        }
    } else if (processedOptions.length > 4) {
        console.warn(`題目 #${id} 選項過多 (${processedOptions.length})，只顯示前4個`);
        processedOptions.splice(4); // 只保留前4個選項
    }
    
    // 創建選項元素
    processedOptions.forEach(({ letter, text }) => {
        const optionLabel = document.createElement('label');
        optionLabel.className = 'option-label';
        
        const optionInput = document.createElement('input');
        optionInput.type = 'radio';
        optionInput.name = `question-${id}`;
        optionInput.value = letter;
        
        // 添加選擇事件處理
        optionInput.addEventListener('change', function() {
            if (this.checked) {
                // 記錄用戶選擇
                window.userAnswers[id] = letter;
                console.log(`用戶選擇了題目 ${id} 的選項 ${letter}`);
            }
        });
        
        const optionText = document.createElement('span');
        optionText.textContent = `${letter}. ${text}`;
        
        optionLabel.appendChild(optionInput);
        optionLabel.appendChild(optionText);
        optionsContainer.appendChild(optionLabel);
    });

    // 添加選項到問題內容
    questionContent.appendChild(optionsContainer);
    
    // 移除單獨的查看答案按鈕
    
    // 添加標題容器和問題內容到問題元素
    questionElement.appendChild(titleContainer);
    questionElement.appendChild(questionContent);
    
    return questionElement;
}

// 顯示單個題目的答案
function showQuestionAnswer(questionId) {
    console.log(`顯示題目 ${questionId} 的答案`);
    
    // 獲取題目元素
    const questionElement = document.getElementById(`question-${questionId}`);
    if (!questionElement) return;
    
    // 檢查是否已經顯示答案
    let answerElement = questionElement.querySelector('.answer-info');
    
    // 如果已經顯示，則切換可見性
    if (answerElement) {
        answerElement.style.display = answerElement.style.display === 'none' ? 'block' : 'none';
        return;
    }
    
    // 獲取標準答案和解析
    const answer = window.standardAnswers[questionId];
    const explanation = window.answerExplanations[questionId];
    const userAnswer = window.userAnswers[questionId];
    
    // 創建答案區域
    answerElement = document.createElement('div');
    answerElement.className = 'answer-info';
    
    // 標準答案
    const standardAnswerElem = document.createElement('div');
    standardAnswerElem.className = 'standard-answer';
    standardAnswerElem.innerHTML = `<strong>標準答案:</strong> ${answer || '未設置'}`;
    answerElement.appendChild(standardAnswerElem);
    
    // 用戶答案（如果有）
    if (userAnswer) {
        const userAnswerElem = document.createElement('div');
        userAnswerElem.className = 'user-answer';
        userAnswerElem.innerHTML = `<strong>您的答案:</strong> ${userAnswer}`;
        
        // 標記答案是否正確
        if (userAnswer === answer) {
            userAnswerElem.style.color = 'green';
        } else {
            userAnswerElem.style.color = 'red';
        }
        
        answerElement.appendChild(userAnswerElem);
    }
    
    // 解析
    if (explanation) {
        const explanationElem = document.createElement('div');
        explanationElem.className = 'answer-explanation';
        explanationElem.innerHTML = `<h4>解析:</h4><p>${explanation}</p>`;
        answerElement.appendChild(explanationElem);
    }
    
    // 添加到題目元素
    questionElement.querySelector('.question-content').appendChild(answerElement);
    
    // 高亮正確選項
    highlightCorrectOption(questionId, answer);
}

// 高亮顯示正確選項
function highlightCorrectOption(questionId, correctAnswer) {
    if (!correctAnswer) return;
    
    const questionElement = document.getElementById(`question-${questionId}`);
    if (!questionElement) return;
    
    // 找到所有選項
    const options = questionElement.querySelectorAll('.option-label');
    options.forEach(optionLabel => {
        const input = optionLabel.querySelector('input');
        if (!input) return;
        
        // 如果是正確答案，添加正確樣式
        if (input.value === correctAnswer) {
            optionLabel.classList.add('correct-answer');
        } 
        // 如果用戶選擇了錯誤答案，添加錯誤樣式
        else if (input.checked) {
            optionLabel.classList.add('wrong-answer');
        }
    });
}

// 返回頂部按鈕功能
function setupBackToTopButton() {
    // 創建返回頂部按鈕
    let backToTopBtn = document.querySelector('.back-to-top');
    
    if (!backToTopBtn) {
        backToTopBtn = document.createElement('div');
        backToTopBtn.className = 'back-to-top';
        backToTopBtn.innerHTML = '↑';
        backToTopBtn.title = '返回頂部';
        document.body.appendChild(backToTopBtn);
        
        // 點擊事件
        backToTopBtn.addEventListener('click', () => {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });
    }
    
    // 滾動監聽
    window.addEventListener('scroll', () => {
        if (window.scrollY > 300) {
            backToTopBtn.classList.add('visible');
        } else {
            backToTopBtn.classList.remove('visible');
        }
    });
}

// 檢查所有答案
function checkAllAnswers() {
    console.log("checkAllAnswers 函數被調用");
    
    // 檢查是否有標準答案
    if (!window.standardAnswers || Object.keys(window.standardAnswers).length === 0) {
        console.error("沒有標準答案可用");
        alert("無法檢查答案：沒有標準答案");
        return;
    }
    
    // 檢查是否有用戶答案
    if (!window.userAnswers || Object.keys(window.userAnswers).length === 0) {
        console.warn("用戶沒有選擇任何答案");
        alert("請至少選擇一個答案後再檢查");
        return;
    }
    
    console.log("標準答案:", window.standardAnswers);
    console.log("用戶答案:", window.userAnswers);
    
    // 顯示結果區域
    const resultsArea = document.querySelector('.results-area');
    if (!resultsArea) {
        console.error("找不到結果顯示區域");
        return;
    }
    
    // 清空結果區域
    resultsArea.innerHTML = '';
    
    // 標題
    const resultsTitle = document.createElement('h3');
    resultsTitle.textContent = '檢查結果';
    resultsArea.appendChild(resultsTitle);
    
    // 計算得分
    let correctCount = 0;
    let totalCount = Object.keys(window.standardAnswers).length;
    
    // 創建結果列表
    const resultsList = document.createElement('div');
    resultsList.className = 'results-list';
    
    // 遍歷所有標準答案
    Object.keys(window.standardAnswers).forEach(questionId => {
        // 獲取標準答案和用戶答案
        const standardAnswer = getStandardAnswer(window.standardAnswers[questionId]);
        const userAnswer = window.userAnswers[questionId];
        
        // 創建結果項
        const resultItem = document.createElement('div');
        resultItem.className = 'result-item';
        
        // 題目編號
        const questionNumber = document.createElement('div');
        questionNumber.className = 'question-number';
        questionNumber.textContent = `題目 ${questionId}`;
        
        // 判斷是否正確
        const isCorrect = standardAnswer && userAnswer && standardAnswer.toUpperCase() === userAnswer.toUpperCase();
        
        // 結果圖標
        const resultIcon = document.createElement('div');
        resultIcon.className = 'result-icon';
        resultIcon.textContent = isCorrect ? '✓' : '✗';
        resultIcon.style.color = isCorrect ? 'green' : 'red';
        
        // 答案信息
        const answerInfo = document.createElement('div');
        answerInfo.className = 'answer-info';
        
        // 標準答案文本
        const standardAnswerText = document.createElement('div');
        standardAnswerText.className = 'standard-answer';
        standardAnswerText.textContent = `標準答案: ${standardAnswer || '未設置'}`;
        
        // 用戶答案文本
        const userAnswerText = document.createElement('div');
        userAnswerText.className = 'user-answer';
        userAnswerText.textContent = `您的答案: ${userAnswer || '未選擇'}`;
        
        // 添加到答案信息中
        answerInfo.appendChild(standardAnswerText);
        answerInfo.appendChild(userAnswerText);
        
        // 添加解析（如果有）
        if (window.answerExplanations && window.answerExplanations[questionId]) {
            const explanation = document.createElement('div');
            explanation.className = 'answer-explanation';
            
            const explanationTitle = document.createElement('h4');
            explanationTitle.textContent = '解析:';
            explanation.appendChild(explanationTitle);
            
            const explanationContent = document.createElement('p');
            explanationContent.textContent = window.answerExplanations[questionId];
            explanation.appendChild(explanationContent);
            
            answerInfo.appendChild(explanation);
        }
        
        // 添加到結果項
        resultItem.appendChild(questionNumber);
        resultItem.appendChild(resultIcon);
        resultItem.appendChild(answerInfo);
        
        // 添加到結果列表
        resultsList.appendChild(resultItem);
        
        // 更新計數
        if (isCorrect) correctCount++;
        
        // 高亮原題目的正確答案
        highlightCorrectAnswer(questionId, standardAnswer);
    });
    
    // 添加得分統計
    const scoreInfo = document.createElement('div');
    scoreInfo.className = 'score-info';
    scoreInfo.textContent = `總分: ${correctCount}/${totalCount} (${Math.round(correctCount / totalCount * 100)}%)`;
    
    // 添加到結果區域
    resultsArea.appendChild(scoreInfo);
    resultsArea.appendChild(resultsList);
    
    // 顯示結果區域
    resultsArea.style.display = 'block';
    
    // 隱藏檢查答案按鈕，因為已經顯示了結果
    const checkAnswersBtn = document.getElementById('check-answers-btn');
    if (checkAnswersBtn) {
        checkAnswersBtn.style.display = 'none';
    }
    
    // 滾動到結果區域
    resultsArea.scrollIntoView({ behavior: 'smooth' });
}

// 獲取標準答案（處理不同格式）
function getStandardAnswer(answerData) {
    console.log("處理答案數據:", answerData);
    
    // 如果是字串，直接返回
    if (typeof answerData === 'string') {
        return answerData.trim();
    }
    
    // 如果是對象並且有 answer 屬性
    if (answerData && typeof answerData === 'object') {
        if (answerData.answer) {
            return answerData.answer.trim();
        }
        
        // 嘗試查找包含 "answer" 的屬性
        for (const key in answerData) {
            if (key.toLowerCase().includes('answer')) {
                return answerData[key].trim();
            }
        }
    }
    
    // 無法處理的情況
    console.warn("無法解析答案數據:", answerData);
    return null;
}

// 高亮正確答案
function highlightCorrectAnswer(questionId, correctAnswer) {
    if (!correctAnswer) return;
    
    const questionElement = document.getElementById(`question-${questionId}`);
    if (!questionElement) return;
    
    // 找到所有選項
    const options = questionElement.querySelectorAll('input[type="radio"]');
    options.forEach(option => {
        const optionLabel = option.closest('.option-label');
        if (!optionLabel) return;
        
        // 如果是正確答案，添加正確樣式
        if (option.value.toUpperCase() === correctAnswer.toUpperCase()) {
            optionLabel.classList.add('correct-answer');
        } 
        // 如果用戶選擇了錯誤答案，添加錯誤樣式
        else if (option.checked) {
            optionLabel.classList.add('wrong-answer');
        }
    });
}

// 顯示加載中狀態
function showLoading(message = '處理中...') {
    // 檢查是否已有加載狀態元素
    let loadingElement = document.getElementById('loading-overlay');
    
    // 如果沒有，創建一個
    if (!loadingElement) {
        loadingElement = document.createElement('div');
        loadingElement.id = 'loading-overlay';
        loadingElement.className = 'loading-overlay';
        
        const spinner = document.createElement('div');
        spinner.className = 'loading-spinner';
        
        const messageElement = document.createElement('div');
        messageElement.id = 'loading-message';
        messageElement.className = 'loading-message';
        
        loadingElement.appendChild(spinner);
        loadingElement.appendChild(messageElement);
        document.body.appendChild(loadingElement);
    }
    
    // 更新消息
    document.getElementById('loading-message').textContent = message;
    
    // 顯示加載狀態
    loadingElement.style.display = 'flex';
}

// 隱藏加載中狀態
function hideLoading() {
    const loadingElement = document.getElementById('loading-overlay');
    if (loadingElement) {
        loadingElement.style.display = 'none';
    }
}

// 顯示消息
function showMessage(message, type = 'info', targetId = null) {
    // 如果指定了目標元素ID，則使用該元素
    if (targetId) {
        const targetElement = document.getElementById(targetId);
        if (targetElement) {
            showStatus(targetElement, message, type);
            return;
        }
    }

    // 查找狀態消息元素
    const statusElement = document.getElementById('chat-status') || document.getElementById('upload-status');
    
    if (statusElement) {
        showStatus(statusElement, message, type);
    } else {
        // 如果找不到狀態元素，創建一個臨時消息
        const tempMessage = document.createElement('div');
        tempMessage.className = `status-message ${type}`;
        tempMessage.textContent = message;
        tempMessage.style.position = 'fixed';
        tempMessage.style.bottom = '20px';
        tempMessage.style.right = '20px';
        tempMessage.style.zIndex = '1000';
        
        document.body.appendChild(tempMessage);
        
        setTimeout(() => {
            tempMessage.remove();
        }, 5000);
    }
}

// 顯示所有答案
function showAllAnswers() {
    const answersContainer = document.getElementById('answers-container');
    answersContainer.innerHTML = '';
    
    if (window.questionData && window.questionData.answers) {
        window.questionData.answers.forEach(answer => {
            const answerItem = document.createElement('div');
            answerItem.className = 'answer-item';
            answerItem.innerHTML = `
                <h4>題目 ${answer.id}</h4>
                <div class="answer-content">標準答案: ${answer.answer}</div>
            `;
            answersContainer.appendChild(answerItem);
        });
    } else {
        answersContainer.innerHTML = '<p class="no-data">尚未生成題目，無法顯示答案。</p>';
    }
}

// 全局診斷函數，可以在開發者控制台直接調用
window.testGenerateQuestions = function() {
    console.log("=== 開始診斷生成題目功能 ===");
    
    // 檢查按鈕是否存在
    const btn1 = document.getElementById('generate-questions-btn');
    console.log("找到 generate-questions-btn:", btn1 ? "是" : "否");
    
    const btn2 = document.getElementById('generate-btn');
    console.log("找到 generate-btn:", btn2 ? "是" : "否");
    
    // 檢查 questions-output 元素
    const output = document.getElementById('questions-output');
    console.log("找到 questions-output:", output ? "是" : "否");
    
    // 檢查函數是否存在
    console.log("generateQuestions 函數:", typeof generateQuestions === 'function' ? "已定義" : "未定義");
    console.log("createQuestionElement 函數:", typeof createQuestionElement === 'function' ? "已定義" : "未定義");
    
    console.log("=== 診斷完成 ===");
};

// 創建全屏覆蓋層函數
function showOverlay(message = '處理中，請稍候...') {
    // 檢查是否已有覆蓋層
    let overlay = document.getElementById('fullscreen-overlay');
    
    // 如果沒有，創建一個
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'fullscreen-overlay';
        overlay.className = 'fullscreen-overlay';
        
        const spinner = document.createElement('div');
        spinner.className = 'overlay-spinner';
        
        const messageElement = document.createElement('div');
        messageElement.id = 'overlay-message';
        messageElement.className = 'overlay-message';
        
        overlay.appendChild(spinner);
        overlay.appendChild(messageElement);
        document.body.appendChild(overlay);
    }
    
    // 更新消息
    document.getElementById('overlay-message').textContent = message;
    
    // 顯示覆蓋層
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden'; // 防止滾動
    
    // 使用透明度來平滑顯示
    setTimeout(() => {
        overlay.style.opacity = '1';
    }, 10);
}

// 隱藏全屏覆蓋層函數
function hideOverlay() {
    const overlay = document.getElementById('fullscreen-overlay');
    if (overlay) {
        // 先淡出
        overlay.style.opacity = '0';
        
        // 然後隱藏
        setTimeout(() => {
            overlay.style.display = 'none';
            document.body.style.overflow = ''; // 恢復滾動
        }, 300);
    }
}

// 添加更新已上傳文件列表的函數
function updateUploadedFilesList(files) {
    // 檢查是否已有文件列表元素
    let uploadedFilesList = document.getElementById('uploaded-files-list');
    
    // 如果沒有，創建一個
    if (!uploadedFilesList) {
        uploadedFilesList = document.createElement('div');
        uploadedFilesList.id = 'uploaded-files-list';
        uploadedFilesList.className = 'uploaded-files-list';
        
        // 找到上傳按鈕和文件處理預覽之間的位置
        const uploadBtn = document.getElementById('upload-btn');
        const processingPreview = document.querySelector('.processing-preview');
        
        if (uploadBtn && processingPreview) {
            uploadBtn.parentNode.insertBefore(uploadedFilesList, processingPreview);
        }
    }
    
    // 更新內容
    let html = `<h4>已上傳文件</h4><ul>`;
    
    Array.from(files).forEach(file => {
        const fileType = file.name.split('.').pop().toLowerCase();
        let fileIcon = '📄';
        if (fileType === 'pdf') {
            fileIcon = '📕';
        } else if (['jpg', 'jpeg', 'png', 'gif'].includes(fileType)) {
            fileIcon = '🖼️';
        }
        
        html += `<li><span class="file-icon">${fileIcon}</span> ${file.name} (${formatFileSize(file.size)})</li>`;
    });
    
    html += `</ul>`;
    uploadedFilesList.innerHTML = html;
}

// 修改 generateQuestions 函數以顯示全屏覆蓋層和改進題目處理
async function generateQuestions() {
    console.log("generateQuestions 函數被調用");
    const questionsOutput = document.getElementById('questions-output');
    const questionsDisplay = document.getElementById('questions-display');
    const statusElement = document.getElementById('questions-status');
    const bottomControls = document.querySelector('.bottom-controls');
    
    // 隱藏底部控制區域
    if (bottomControls) {
        bottomControls.style.display = 'none';
    }
    
    // 顯示問題輸出區域
    questionsOutput.style.display = 'block';
    
    // 顯示狀態訊息
    if (statusElement) {
        statusElement.textContent = "正在生成題目...";
        statusElement.style.display = "block";
    }
    
    if (!questionsDisplay) {
        console.error("無法找到 questions-display 元素");
        if (statusElement) {
            statusElement.textContent = "錯誤: 無法找到輸出容器";
        }
        return;
    }
    
    try {
        console.log("開始獲取生成題數量");
        const numQuestionsInput = document.getElementById('num-questions');
        
        // 確保題目數量是有效整數
        let numQuestions = 3; // 默認值
        if (numQuestionsInput && numQuestionsInput.value) {
            numQuestions = Math.max(1, Math.min(20, parseInt(numQuestionsInput.value) || 3));
            // 更新輸入框的值，確保界面顯示與實際值同步
            numQuestionsInput.value = numQuestions;
        }
        
        console.log(`將生成 ${numQuestions} 個題目`);
        
        // 顯示全屏覆蓋層
        showOverlay(`正在生成 ${numQuestions} 個題目，請稍候...`);
        
        // 顯示題目顯示區域
        questionsDisplay.style.display = "flex";
        
        // 更新加載信息 - 使用文本信息而非動畫
        questionsDisplay.innerHTML = `
            <div class="loading-container">
                <p>正在生成 ${numQuestions} 個題目中，請稍候...</p>
            </div>
        `;
        
        // 清空並隱藏結果區域
        const resultsArea = document.querySelector('.results-area');
        if (resultsArea) {
            resultsArea.innerHTML = '';
            resultsArea.style.display = 'none';
        }
        
        // 先獲取課程內容
        console.log("獲取當前課程內容");
        const contentResponse = await fetch(`${API_BASE_URL}/api/file-content`);
        
        if (!contentResponse.ok) {
            hideOverlay();
            throw new Error("請先上傳課程文件並處理，然後再生成題目");
        }
        
        const contentData = await contentResponse.json();
        
        if (!contentData.course_data || contentData.course_data.length === 0) {
            hideOverlay();
            throw new Error("沒有可用的課程內容，請先上傳並處理文件");
        }
        
        // 使用課程內容生成題目
        console.log(`使用 ${contentData.course_data.length} 段課程內容生成題目`);
        
        // 取出部分文本內容作為題目生成的基礎（避免內容太多）
        const maxContentLength = 2000; // 限制內容長度，避免請求過大
        let combinedContent = contentData.course_data.join('\n\n');
        if (combinedContent.length > maxContentLength) {
            combinedContent = combinedContent.substring(0, maxContentLength);
        }
        
        // 調用後端 API 生成題目
        console.log("調用後端 API 生成題目");
        const response = await fetch(`${API_BASE_URL}/generate_questions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                num_questions: numQuestions,
                content: combinedContent,
                language: 'zh-TW' // 明確指定使用繁體中文
            })
        });
        
        // 隱藏全屏覆蓋層
        hideOverlay();
        
        if (!response.ok) {
            throw new Error(`HTTP 錯誤: ${response.status}`);
        }
        
        const data = await response.json();
        console.log("收到後端回覆:", data);
        
        // 檢查和處理返回的數據
        if (data.error) {
            throw new Error(data.error);
        }
        
        // 檢查 questions 和 answers 是否存在且是數組
        const questions = Array.isArray(data.questions) ? data.questions : [];
        const answers = Array.isArray(data.answers) ? data.answers : [];
        const explanations = Array.isArray(data.explanations) ? data.explanations : [];
        
        if (questions.length === 0) {
            throw new Error("生成題目失敗，未返回有效的題目數據");
        }
        
        // 格式化數據，確保適合顯示，並進行題目篩選
        const processedData = processQuestionData(questions, answers, explanations, numQuestions);
        
        // 顯示處理後的數據
        console.log("格式化後的題目:", processedData.formattedQuestions);
        console.log("格式化後的答案:", processedData.formattedAnswers);
        
        // 檢查數據數量是否匹配
        if (processedData.formattedQuestions.length !== processedData.formattedAnswers.length) {
            console.warn(`題目和答案數量不匹配: ${processedData.formattedQuestions.length} 題目, ${processedData.formattedAnswers.length} 答案`);
        }
        
        // 顯示題目
        displayQuestions(
            processedData.formattedQuestions, 
            processedData.formattedAnswers, 
            processedData.formattedExplanations
        );
        
        // 顯示底部控制區域
        if (bottomControls) {
            bottomControls.style.display = 'block';
            // 將底部控制區域移動到題目區域之後
            const questionsOutput = document.getElementById('questions-output');
            if (questionsOutput) {
                questionsOutput.appendChild(bottomControls);
            }
        }
        
        // 更新狀態 - 顯示實際生成數量
        if (statusElement) {
            statusElement.textContent = `已顯示 ${processedData.formattedQuestions.length} 個題目 (要求：${numQuestions})`;
            setTimeout(() => {
                statusElement.textContent = '';
            }, 5000);
        }
    } catch (error) {
        // 隱藏全屏覆蓋層
        hideOverlay();
        
        console.error("生成題目時發生錯誤:", error);
        
        // 顯示題目區域（用於顯示錯誤）
        questionsDisplay.style.display = "flex";
        
        // 顯示錯誤信息 - 放到 questionsDisplay 中
        questionsDisplay.innerHTML = `
            <div class="error-message">
                <div class="error-icon">⚠️</div>
                <div class="error-content">
                    <h4>生成題目時發生錯誤</h4>
                    <p>${error.message}</p>
                    <p>請先上傳課程文件，然後再嘗試生成題目。</p>
                </div>
            </div>
        `;
        
        // 更新狀態
        if (statusElement) {
            statusElement.textContent = `錯誤: ${error.message}`;
        }
    }
}

// 處理問題數據的函數，進行篩選和修復
function processQuestionData(questions, answers, explanations, requestedCount) {
    console.log("開始處理問題數據:", {
        questions: questions ? questions.length : 0,
        answers: answers ? answers.length : 0,
        explanations: explanations ? explanations.length : 0
    });
    
    // 標記處理後的數據
    const processed = {
        formattedQuestions: [],
        formattedAnswers: [],
        formattedExplanations: []
    };
    
    // 檢查是否有足夠的題目
    if (!questions || questions.length === 0) {
        console.error("沒有收到任何題目");
        return processed;
    }
    
    // 原始題目樣本記錄
    if (questions.length > 0) {
        console.log("第一個原始題目:", JSON.stringify(questions[0]).substring(0, 200));
    }
    
    // 遍歷題目進行處理
    for (let i = 0; i < questions.length && processed.formattedQuestions.length < requestedCount; i++) {
        let question = questions[i];
        let answer = answers[i] || null;
        let explanation = explanations[i] || null;
        
        console.log(`處理題目 #${i+1}:`, typeof question === 'string' ? 
            question.substring(0, 50) + "..." : 
            JSON.stringify(question).substring(0, 50) + "...");
        
        // 嘗試修復題目格式
        let formattedQuestion = question;
        
        // 如果題目是對象而不是字符串，提取需要的數據
        if (typeof question === 'object' && question !== null) {
            console.log("處理題目對象:", JSON.stringify(question).substring(0, 100) + "...");
            
            // 使用問題對象的question屬性和options屬性
            if (question.question) {
                // 放寬條件：即使沒有選項也接受題目
                formattedQuestion = {
                    id: question.id || i + 1,
                    question: question.question,
                    options: Array.isArray(question.options) ? question.options : []
                };
                
                // 如果沒有選項，嘗試從問題文本中提取
                if (formattedQuestion.options.length === 0 && typeof question.question === 'string') {
                    const lines = question.question.split('\n');
                    const optionLines = lines.filter(line => /^[A-D][\.\、\:]/.test(line.trim()));
                    formattedQuestion.options = optionLines;
                    
                    // 如果成功提取選項，更新問題文本，僅保留第一行
                    if (optionLines.length > 0 && lines.length > 1) {
                        formattedQuestion.question = lines[0];
                    }
                }
            } else {
                console.warn("題目對象缺少question屬性，嘗試其他字段:", Object.keys(question));
                // 嘗試查找其他可能包含問題文本的字段
                const possibleFields = ['text', 'content', 'questionText', 'stem'];
                for (const field of possibleFields) {
                    if (question[field] && typeof question[field] === 'string') {
                        formattedQuestion = {
                            id: question.id || i + 1,
                            question: question[field],
                            options: []
                        };
                        console.log("使用替代字段:", field);
                        break;
                    }
                }
            }
        } else if (typeof question === 'string') {
            // 如果是字符串，嘗試格式化
            formattedQuestion = formatQuestion(question);
        } else {
            console.warn(`跳過無效題目類型: ${typeof question}`);
            continue;
        }
        
        // 驗證選項數量
        let optionsCount = 0;
        
        if (typeof formattedQuestion === 'string') {
            optionsCount = countOptions(formattedQuestion);
        } else if (formattedQuestion.options && Array.isArray(formattedQuestion.options)) {
            optionsCount = formattedQuestion.options.length;
        }
        
        // 放寬選項數量限制，只要求有至少1個選項
        if (optionsCount < 1) {
            console.warn(`題目沒有選項，嘗試添加默認選項`);
            // 添加默認選項A和B
            if (typeof formattedQuestion === 'string') {
                formattedQuestion += '\nA. 選項A\nB. 選項B';
            } else if (formattedQuestion && typeof formattedQuestion === 'object') {
                formattedQuestion.options = ['A. 選項A', 'B. 選項B'];
            }
            optionsCount = 2;
        }
        
        // 格式化答案
        const formattedAnswer = formatAnswer(answer, i);
        
        // 添加到處理後的數據中
        processed.formattedQuestions.push(formattedQuestion);
        processed.formattedAnswers.push(formattedAnswer);
        processed.formattedExplanations.push(explanation);
        
        console.log(`題目 #${i+1} 處理完成，現有 ${processed.formattedQuestions.length} 個有效題目`);
    }
    
    console.log("最終處理後題目數量:", processed.formattedQuestions.length);
    return processed;
}

// 格式化答案數據
function formatAnswer(answer, index) {
    if (!answer) {
        return { id: index + 1, answer: "A" }; // 默認答案
    }
    
    // 如果答案是對象且有答案屬性
    if (typeof answer === 'object' && answer !== null) {
        if (answer.answer) {
            return {
                id: answer.id || index + 1,
                answer: answer.answer.toUpperCase()
            };
        }
        
        // 嘗試查找包含 "answer" 的屬性
        for (const key in answer) {
            if (key.toLowerCase().includes('answer')) {
                return {
                    id: answer.id || index + 1,
                    answer: answer[key].toString().toUpperCase()
                };
            }
        }
    } 
    // 如果答案是字符串，直接使用
    else if (typeof answer === 'string') {
        // 提取字母答案 (A/B/C/D)
        const match = answer.match(/[A-D]/i);
        if (match) {
            return {
                id: index + 1,
                answer: match[0].toUpperCase()
            };
        }
    }
    
    // 默認答案
    return { id: index + 1, answer: "A" };
}

// 計算題目中的選項數量
function countOptions(question) {
    if (typeof question !== 'string') {
        return 0;
    }
    
    // 計算 A. B. C. D. 等選項格式的數量
    const optionLines = question.split('\n').filter(line => /^[A-D][\.\、\:]/.test(line.trim()));
    return optionLines.length;
}

// 格式化問題
function formatQuestion(question) {
    if (typeof question !== 'string') {
        if (question && typeof question === 'object' && question.question) {
            let questionText = question.question;
            
            // 過濾掉包含"答案為X"的文本
            questionText = filterAnswerText(questionText);
            
            // 如果有選項，添加到問題文本中
            if (Array.isArray(question.options) && question.options.length > 0) {
                questionText += '\n' + question.options.join('\n');
            }
            
            return removeIntroductoryText(questionText);
        }
        return `題目格式錯誤: ${JSON.stringify(question)}`;
    }
    
    // 過濾掉包含"答案為X"的文本
    question = filterAnswerText(question);
    
    // 移除介紹性文字
    question = removeIntroductoryText(question);
    
    // 先檢查是否包含"Answer:"文本，如果有，需要先去除
    const answerMatch = question.match(/(?:^|\n)(?:Answer|答案)[\:\：\s]*[A-D]/i);
    if (answerMatch) {
        console.log("問題中發現答案文本，移除中:", answerMatch[0]);
        // 把答案之前的部分作為實際問題
        question = question.substring(0, answerMatch.index).trim();
    }
    
    // 確保選項格式一致
    let lines = question.split('\n');
    
    // 標準化選項格式 (A. B. C. D.)
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // 檢查是否是選項行
        if (/^[A-D][\.\、\:]/.test(line)) {
            // 提取選項字母和內容
            const match = line.match(/^([A-D])([\.\、\:]\s*)(.+)/);
            if (match) {
                // 重新格式化為標準格式 "A. 內容"
                lines[i] = `${match[1]}. ${match[3]}`;
            }
        }
    }
    
    return lines.join('\n');
}

// 移除常見的介紹性文字
function removeIntroductoryText(text) {
    if (typeof text !== 'string') return text;
    
    // 常見的介紹性文字模式
    const introPatterns = [
        // 英文模式
        /^Here (?:are|is)(?: the)? (?:three|[0-9]+) (?:multiple[- ]choice )?questions?(?: based on(?: the)? (?:provided )?content)?:?\s*/i,
        /^Based on the (?:provided )?(?:content|text|information|material), (?:here (?:are|is)|I['']ll provide) (?:three|[0-9]+) (?:multiple[- ]choice )?questions?:?\s*/i,
        /^I['']ll create (?:three|[0-9]+) (?:multiple[- ]choice )?questions? (?:based on|from)(?: the)? (?:provided )?content:?\s*/i,
        /^Following are (?:three|[0-9]+) (?:multiple[- ]choice )?questions? (?:based on|from)(?: the)? (?:provided )?content:?\s*/i,
        /^Let me create (?:three|[0-9]+) (?:multiple[- ]choice )?questions? (?:based on|from)(?: the)? (?:provided )?(?:content|material):?\s*/i,
        
        // 中文模式
        /^以下是(?:基於|根據)(?:提供的|上述的|課程的)?(?:內容|文本)的(?:三|[0-9]+)(?:個|道)(?:選擇題|多選題|問題)[:：]?\s*/i,
        /^(?:下面|以下)(?:是|為)(?:三|[0-9]+)(?:個|道)(?:基於|根據)(?:提供的|上述的|課程的)?(?:內容|文本)的(?:選擇題|多選題|問題)[:：]?\s*/i,
        /^根據(?:提供的|上述的|課程的)?(?:內容|文本)，(?:以下|下面)是(?:三|[0-9]+)(?:個|道)(?:選擇題|多選題|問題)[:：]?\s*/i,
    ];
    
    // 檢查每個模式並移除匹配的文字
    for (const pattern of introPatterns) {
        const match = text.match(pattern);
        if (match && match.index === 0) {
            console.log("移除介紹性文字:", match[0]);
            text = text.substring(match[0].length);
            break;  // 找到一個匹配後就停止
        }
    }
    
    return text;
}

// 過濾答案文本
function filterAnswerText(text) {
    if (typeof text !== 'string') return text;
    
    // 過濾掉常見的"答案為X"文本
    const answerPatterns = [
        /答案為[A-D]/g,
        /答案是[A-D]/g,
        /正確答案[是為][A-D]/g,
        /the answer is [A-D]/gi,
        /correct answer is [A-D]/gi,
        /answer[：:\s]+[A-D]/gi,
        /答案[：:\s]+[A-D]/g,
    ];
    
    let originalText = text;
    
    // 替換所有匹配的文本
    for (const pattern of answerPatterns) {
        text = text.replace(pattern, '');
    }
    
    // 如果有變化，記錄日誌
    if (text !== originalText) {
        console.log("過濾答案文本: 原文字>>", originalText.substring(0, 30), "... 改為>>", text.substring(0, 30));
    }
    
    return text;
}

// 顯示標準答案
function showStandardAnswer(questionId) {
    const questionElement = document.querySelector(`[data-question-id="${questionId}"]`);
    if (!questionElement) return;
    
    // 檢查是否已經顯示答案
    let answerElement = questionElement.querySelector('.standard-answer');
    if (answerElement) {
        // 如果已存在，切換顯示/隱藏
        answerElement.classList.toggle('hide');
        return;
    }
    
    // 獲取標準答案
    const standardAnswer = window.standardAnswers[questionId];
    const answerExplanation = window.answerExplanations[questionId] || '未提供解析';
    
    // 創建答案顯示區域
    answerElement = document.createElement('div');
    answerElement.className = 'standard-answer';
    answerElement.innerHTML = `
        <h4>標準答案: ${standardAnswer}</h4>
        <div class="answer-explanation">${answerExplanation}</div>
    `;
    
    // 添加到問題元素中
    questionElement.querySelector('.question-content').appendChild(answerElement);
} 