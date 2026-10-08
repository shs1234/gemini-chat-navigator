// Gemini Chat Navigator - Content Script
// Gemini 대화용 플로팅 목차 네비게이션 생성

(function() {
  'use strict';

  // ==================== 설정 ====================
  const CONFIG = {
    PANEL_WIDTH_COLLAPSED: 36,      // 축소 상태 너비
    PANEL_WIDTH_EXPANDED: 220,      // 확장 상태 너비
    PREVIEW_LENGTH: 35,             // 질문 미리보기 길이
    HIGHLIGHT_DURATION: 2000,       // 하이라이트 지속 시간(ms)
    DEBOUNCE_DELAY: 150,            // 디바운스 대기 시간
    AUTO_SYNC_DELAY: 300,           // 자동 동기화 대기 시간
    DOT_SIZE: 8,                    // 작은 원 크기
    DEBUG: true,                    // 디버그 모드
  };

  // 디버그 로그
  function log(...args) {
    if (CONFIG.DEBUG) {
      console.log('[GCN]', ...args);
    }
  }

  // ==================== 상태 관리 ====================
  let questions = [];                // 모든 질문 저장
  let currentHighlightId = null;     // 현재 하이라이트된 질문 ID
  let isPanelExpanded = false;       // 패널 확장 여부
  let isPanelMaximized = false;      // 질문 전체 표시 모드
  let searchQuery = '';              // 검색 키워드
  let questionIdMap = new Map();     // ID to 질문 매핑
  let currentConversationId = '';    // 현재 대화 ID (대화 전환 감지용)
  let lastMessageTexts = new Set();  // 직전에 감지된 메시지 텍스트
  let lastQuestionSignature = '';    // 자동 동기화용 질문 목록 서명
  let questionSyncTimer = null;      // 자동 동기화 타이머
  let alwaysShowPanel = false;       // 목차 패널 항상 표시 여부
  let highlightMode = 'preserve';    // preserve 또는 viewport

  // ==================== DOM 엘리먼트 ====================
  let panel = null;
  let questionList = null;
  let searchInput = null;
  let questionCount = null;

  // ==================== 유틸리티 함수 ====================

  // 고유 ID 생성
  function generateId() {
    return 'gcn-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  // 디바운스 함수
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // 텍스트 자르기
  function truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  // 타임스탬프 포맷팅
  function formatTime(timestamp) {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  // HTML 이스케이프
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 질문 목록 변경 감지를 위한 서명 생성
  function createQuestionSignature(messages) {
    return messages
      .map(el => cleanMessageText(el.textContent || ''))
      .filter(text => text.length > 1)
      .join('\n---gcn-question---\n');
  }

  // ==================== 질문 감지 ====================

  // 사용자 메시지 감지 - Gemini 웹 버전 특정 선택자
  // 사용자 메시지는 일반적으로 특정 클래스명이나 속성을 가집니다.
  function findUserMessages(options = {}) {
    const { includeProcessed = false } = options;
    const messages = [];
    const seenElements = new Set();

    function addMessageElement(el) {
      if (!includeProcessed && (el.dataset.gcnId || el.dataset.gcnProcessed)) {
        return;
      }

      if (seenElements.has(el)) {
        return;
      }

      const parentMessage = includeProcessed
        ? el.parentElement?.closest('user-query, .user-query-container, [data-test-id="user-query"], [data-gcn-processed="true"]')
        : el.closest('[data-gcn-processed="true"]');

      if (parentMessage) {
        return;
      }

      messages.push(el);
      seenElements.add(el);
    }

    // Gemini 웹 버전의 사용자 메시지 선택자
    // 가장 정확한 선택자를 우선 사용
    const selectors = [
      // 주요 선택자 - 사용자 쿼리 블록 (가장 정확함)
      'user-query',
      '.user-query-container',
      '[data-test-id="user-query"]',
    ];

    // 각 선택자를 시도하여 첫 번째 유효한 것을 찾음
    for (const selector of selectors) {
      try {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          log(`Found ${elements.length} elements with selector: ${selector}`);
          elements.forEach(el => {
            addMessageElement(el);
          });
          if (messages.length > 0) break; // 찾았으면 다른 선택자 시도 중단
        }
      } catch (e) {
        // 선택자가 잘못되었을 수 있으므로 다음 시도
      }
    }

    // 그래도 찾지 못했다면 스마트 감지 방법 시도
    if (messages.length === 0) {
      log('Using smart detection');
      const smartMessages = findUserMessagesSmart({ includeProcessed });
      smartMessages.forEach(el => {
        if (!seenElements.has(el)) {
          messages.push(el);
        }
      });
    }

    log(`Total user messages found: ${messages.length}`);
    return messages;
  }

  // 사용자 메시지 스마트 검색
  function findUserMessagesSmart(options = {}) {
    const { includeProcessed = false } = options;
    const messages = [];
    const seen = new Set();

    // 대화 컨테이너 검색
    const chatContainer = document.querySelector('main, [role="log"], chat-window, .chat-container');
    if (!chatContainer) {
      log('Chat container not found');
      return messages;
    }

    // 모든 메시지 블록 검색
    const allBlocks = chatContainer.querySelectorAll('*');

    allBlocks.forEach(el => {
      // 이미 처리된 것은 건너뜀
      if (!includeProcessed && (el.dataset.gcnId || el.dataset.gcnProcessed)) return;

      // 지나치게 작은 엘리먼트는 건너뜀
      const rect = el.getBoundingClientRect();
      if (rect.width < 100 || rect.height < 20) return;

      // 사용자 메시지인지 확인
      if (isLikelyUserMessage(el)) {
        // 다른 사용자 메시지에 중첩되지 않았는지 확인
        const parentUserMessage = includeProcessed
          ? el.parentElement?.closest('user-query, .user-query-container, [data-test-id="user-query"], [data-gcn-id]')
          : el.closest('[data-gcn-id]');
        if (!parentUserMessage && !seen.has(el)) {
          messages.push(el);
          seen.add(el);
        }
      }
    });

    log(`Smart detection found ${messages.length} messages`);
    return messages;
  }

  // 엘리먼트가 사용자 메시지인지 판단
  function isLikelyUserMessage(element) {
    // 태그명 확인
    const tagName = element.tagName.toLowerCase();

    // 메시지가 확실히 아닌 일부 엘리먼트 제외
    if (['script', 'style', 'meta', 'link', 'head', 'html', 'body'].includes(tagName)) {
      return false;
    }

    // Gemini 특정: user-query 태그
    if (tagName === 'user-query') {
      return true;
    }

    // 사용자 메시지의 특징이 있는지 확인
    // 1. data 속성 확인
    if (element.dataset.user === 'true' ||
        element.dataset.sender === 'user' ||
        element.dataset.role === 'user') {
      return true;
    }

    // 2. 클래스명 확인
    const className = element.className || '';
    if (typeof className === 'string') {
      const userClassPatterns = [
        'user-query', 'user-message', 'user-input',
        'human-message', 'question', 'prompt'
      ];
      for (const pattern of userClassPatterns) {
        if (className.toLowerCase().includes(pattern)) {
          return true;
        }
      }

      // AI 답변 관련 클래스 제외
      const aiClassPatterns = [
        'model-response', 'ai-response', 'assistant',
        'bot-message', 'gemini-response', 'response-container'
      ];
      for (const pattern of aiClassPatterns) {
        if (className.toLowerCase().includes(pattern)) {
          return false;
        }
      }
    }

    // 3. 사용자 아바타 또는 아이콘 포함 여부 확인 (일반적으로 사용자 메시지에는 특정 아바타가 있음)
    const hasUserAvatar = element.querySelector('[data-avatar="user"], .user-avatar, .avatar-user');
    if (hasUserAvatar) return true;

    // 4. model-response 컨테이너 내부에 있는지 확인
    if (element.closest('.model-response, .ai-response, [data-role="assistant"]')) {
      return false;
    }

    return false;
  }

  // 메시지 엘리먼트에서 텍스트 추출
  function extractMessageText(element) {
    // 텍스트 내용 영역 찾기 시도
    const textSelectors = [
      // 현재 Gemini는 .query-text 내부에 스크린 리더용 h5에도 질문을
      // 반복해서 넣습니다. 부모 컨테이너가 아니라 실제 표시되는 줄을 우선 사용합니다.
      '.query-text-line',
      '.query-text', '.message-text', '.content',
      'p', 'span', 'div'
    ];

    // 우선 특정 텍스트 컨테이너 찾기 시도
    for (const selector of textSelectors) {
      const textEls = element.querySelectorAll(selector);
      for (const textEl of textEls) {
        // 접근성 라벨은 질문 본문과 같은 문자열을 포함하므로 추출 대상에서 제외합니다.
        if (textEl.matches('.screen-reader-user-query-label, [aria-hidden="true"]')) continue;
        let text = textEl.textContent.trim();
        // "You said" 등의 접두사 정리
        text = cleanMessageText(text);
        // 너무 짧은 텍스트는 건너뜀 (아이콘이나 버튼 텍스트일 수 있음)
        if (text && text.length > 3) {
          return text;
        }
      }
    }

    // 엘리먼트의 텍스트 직접 가져오기
    let text = element.textContent.trim();
    text = cleanMessageText(text);
    return text.replace(/\s+/g, ' ').trim();
  }

  // 메시지 텍스트 정리
  function cleanMessageText(text) {
    // 일반적인 태그 접두사 제거
    const prefixesToRemove = [
      'You said:',
      'You said',
      'User:',
      '사용자:',
      '질문:',
      '말씀하신 내용:',
      '말씀하신 내용',
    ];

    let cleaned = text.replace(/\s+/g, ' ').trim();
    for (const prefix of prefixesToRemove) {
      if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
        cleaned = cleaned.substring(prefix.length).trim();
        cleaned = cleaned.replace(/^[:：\-\s]+/, '').trim();
      }
    }

    return cleaned;
  }

  // 새로 감지된 사용자 메시지 처리
  function processUserMessage(element, preferredId = null) {
    const text = extractMessageText(element);
    log('processUserMessage, text:', text);

    if (!text || text.length < 2) {
      log('Text too short, skipping');
      return null; // 빈 메시지 무시
    }

    const id = preferredId || generateId();
    element.dataset.gcnId = id;
    log('Assigned id:', id, 'to element:', element);

    const question = {
      id,
      text,
      preview: truncateText(text, CONFIG.PREVIEW_LENGTH),
      timestamp: Date.now(),
      elementRef: null, // 엘리먼트 참조를 직접 저장하지 않고 선택자 저장으로 변경
      selector: generateSelector(element)
    };

    questions.push(question);
    questionIdMap.set(id, question);
    log('Added question, total:', questions.length);

    return question;
  }

  // 질문을 DOM 순서대로 정렬
  function sortQuestionsByDomOrder() {
    questions.sort((a, b) => {
      const aElement = a.selector ? document.querySelector(a.selector) : null;
      const bElement = b.selector ? document.querySelector(b.selector) : null;

      if (aElement && bElement && aElement !== bElement) {
        const position = aElement.compareDocumentPosition(bElement);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      }

      return a.timestamp - b.timestamp;
    });
  }

  // 현재 DOM 기준으로 질문 목록 전체를 다시 구성
  function syncQuestionsFromDom(preserveHighlightId = currentHighlightId) {
    log('Syncing questions from DOM...');

    const previousIdsByText = new Map();
    questions.forEach(q => {
      if (!previousIdsByText.has(q.text)) {
        previousIdsByText.set(q.text, q.id);
      }
    });

    questions = [];
    questionIdMap.clear();

    // 모든 요소의 gcn 표시를 제거
    document.querySelectorAll('[data-gcn-id]').forEach(el => {
      delete el.dataset.gcnId;
    });
    document.querySelectorAll('[data-gcn-processed]').forEach(el => {
      delete el.dataset.gcnProcessed;
    });

    // 마커와 무관하게 현재 DOM 전체를 다시 읽어야 누락이 없음
    const messages = findUserMessages({ includeProcessed: true });
    lastQuestionSignature = createQuestionSignature(messages);

    messages.forEach(el => {
      if (!el.dataset.gcnProcessed) {
        el.dataset.gcnProcessed = 'true';
        const text = extractMessageText(el);
        const previousId = previousIdsByText.get(text) || null;
        if (previousId) {
          previousIdsByText.delete(text);
        }
        processUserMessage(el, previousId);
      }
    });

    sortQuestionsByDomOrder();

    // 현재 메시지 텍스트 기록
    lastMessageTexts.clear();
    questions.forEach(q => {
      lastMessageTexts.add(q.text);
    });

    renderQuestionList(preserveHighlightId);
  }

  // 현재 DOM의 질문 변화가 감지되면 목차를 자동으로 새로고침
  function syncQuestionsIfChanged() {
    const messages = findUserMessages({ includeProcessed: true });
    const nextSignature = createQuestionSignature(messages);

    if (nextSignature && nextSignature !== lastQuestionSignature) {
      log('Question list changed, syncing automatically');
      syncQuestionsFromDom(currentHighlightId);
    }
  }

  // 스크롤/DOM 변경 직후 Gemini가 대화를 붙이는 시간을 고려해 지연 실행
  function scheduleQuestionSync() {
    clearTimeout(questionSyncTimer);
    questionSyncTimer = setTimeout(() => {
      syncQuestionsIfChanged();
    }, CONFIG.AUTO_SYNC_DELAY);
  }

  // 엘리먼트 선택자 생성
  function generateSelector(element) {
    if (element.id) {
      return `#${element.id}`;
    }

    // data 속성 사용
    if (element.dataset.gcnId) {
      return `[data-gcn-id="${element.dataset.gcnId}"]`;
    }

    return null;
  }

  // ID로 엘리먼트 찾기
  function findElementById(id) {
    log('findElementById called with id:', id);
    const question = questionIdMap.get(id);
    log('Question from map:', question);

    if (!question) {
      log('Question not found in map');
      return null;
    }

    // 우선 data 속성을 통해 찾기 시도
    let element = document.querySelector(`[data-gcn-id="${id}"]`);
    log('Element found by data-gcn-id:', element);

    // 찾을 수 없으면 선택자를 통해 찾기 시도
    if (!element && question.selector) {
      element = document.querySelector(question.selector);
      log('Element found by selector:', element);
    }

    return element;
  }

  // ==================== 목차 패널 UI ====================

  // 목차 패널 생성
  function createPanel() {
    panel = document.createElement('div');
    panel.id = 'gcn-panel';
    panel.className = 'gcn-panel';

    panel.innerHTML = `
      <div class="gcn-dots-container" id="gcn-dots"></div>
      <div class="gcn-panel-content">
        <div class="gcn-header">
          <span class="gcn-title">목차</span>
          <div class="gcn-header-actions">
            <span class="gcn-count" id="gcn-count">0</span>
            <button class="gcn-expand-button" type="button" aria-label="질문 전체 보기" title="질문 전체 보기">⤢</button>
          </div>
        </div>
        <div class="gcn-search">
          <input type="text" id="gcn-search" placeholder="검색..." />
        </div>
        <div class="gcn-list" id="gcn-list"></div>
      </div>
    `;

    document.body.appendChild(panel);

    // 엘리먼트 참조 가져오기
    questionList = document.getElementById('gcn-list');
    searchInput = document.getElementById('gcn-search');
    questionCount = document.getElementById('gcn-count');

    // 이벤트 바인딩
    bindPanelEvents();
  }

  // 패널 이벤트 바인딩
  function bindPanelEvents() {
    const handleScroll = debounce(() => {
      scheduleQuestionSync();
      updateCurrentHighlight(highlightMode === 'viewport');
    }, CONFIG.DEBOUNCE_DELAY);

    // 마우스 오버 확장/축소
    panel.addEventListener('mouseenter', () => {
      expandPanel();
    });

    panel.addEventListener('mouseleave', () => {
      if (alwaysShowPanel) return;
      collapsePanel();
    });

    // 검색 입력
    searchInput.addEventListener('input', debounce((e) => {
      searchQuery = e.target.value.toLowerCase();
      renderQuestionList();
    }, CONFIG.DEBOUNCE_DELAY));

    // 패널 내부 클릭 이벤트 버블링 방지
    panel.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // 제목 클릭 시 다시 스캔
    const header = panel.querySelector('.gcn-header');
    if (header) {
      header.title = '클릭하여 다시 스캔';
      header.addEventListener('click', (event) => {
        if (event.target.closest('.gcn-expand-button')) return;
        rescanMessages();
      });
    }

    const expandButton = panel.querySelector('.gcn-expand-button');
    expandButton.addEventListener('click', (event) => {
      event.stopPropagation();
      isPanelMaximized = !isPanelMaximized;
      panel.classList.toggle('gcn-maximized', isPanelMaximized);
      expandButton.textContent = isPanelMaximized ? '⤡' : '⤢';
      expandButton.setAttribute('aria-label', isPanelMaximized ? '기본 크기로 보기' : '질문 전체 보기');
      expandButton.title = isPanelMaximized ? '기본 크기로 보기' : '질문 전체 보기';
      if (isPanelMaximized) expandPanel();
      renderQuestionList();
    });

    // 스크롤 리스너
    const scrollContainer = findScrollContainer();
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll);
    } else {
      window.addEventListener('scroll', handleScroll);
    }

    // Gemini가 내부 스크롤 컨테이너를 바꿔도 스크롤을 놓치지 않도록 캡처 단계에서도 감지
    document.addEventListener('scroll', handleScroll, true);
  }

  // 스크롤 컨테이너 검색
  function findScrollContainer() {
    // Gemini는 특정 컨테이너 내에서 스크롤할 수 있음
    // overflow-y: auto 또는 scroll 속성을 가진 컨테이너 우선 검색
    const selectors = [
      'main',
      '.chat-container',
      '[role="log"]',
      'chat-window',
      '.conversation',
      '.conversation-container',
      '[data-test-id="conversation"]'
    ];

    for (const selector of selectors) {
      const container = document.querySelector(selector);
      if (container) {
        const style = window.getComputedStyle(container);
        const overflowY = style.overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') &&
            container.scrollHeight > container.clientHeight) {
          log('Found scroll container:', selector);
          return container;
        }
      }
    }

    // 찾지 못한 경우, 스크롤 가능한 모든 상위 엘리먼트 검색
    const allContainers = document.querySelectorAll('*');
    for (const container of allContainers) {
      const style = window.getComputedStyle(container);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          container.scrollHeight > container.clientHeight &&
          container.clientHeight > 300) { // 주요 스크롤 영역인지 확인
        log('Found fallback scroll container');
        return container;
      }
    }

    return null;
  }

  // 패널 확장
  function expandPanel() {
    if (isPanelExpanded) return;
    isPanelExpanded = true;
    panel.classList.add('gcn-expanded');

    // 현재 화면에 보이는 질문 하이라이트 업데이트
    updateCurrentHighlight();
  }

  // 패널 축소
  function collapsePanel() {
    if (alwaysShowPanel || isPanelMaximized) return;
    if (!isPanelExpanded) return;
    isPanelExpanded = false;
    panel.classList.remove('gcn-expanded');
  }

  // 설정에 따라 패널 표시 방식을 적용
  function applyPanelDisplayMode() {
    if (!panel) return;

    if (alwaysShowPanel) {
      expandPanel();
    } else if (!panel.matches(':hover')) {
      collapsePanel();
    }
  }

  // 저장된 설정 불러오기
  function loadSettings() {
    chrome.storage.local.get(['alwaysShowPanel', 'highlightMode'], (result) => {
      alwaysShowPanel = Boolean(result.alwaysShowPanel);
      highlightMode = result.highlightMode === 'viewport' ? 'viewport' : 'preserve';
      applyPanelDisplayMode();
      renderQuestionList();
    });
  }

  // 팝업에서 설정을 바꾸면 즉시 반영
  function setupSettingsListener() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;

      if (changes.alwaysShowPanel) {
        alwaysShowPanel = Boolean(changes.alwaysShowPanel.newValue);
        applyPanelDisplayMode();
      }

      if (changes.highlightMode) {
        highlightMode = changes.highlightMode.newValue === 'viewport' ? 'viewport' : 'preserve';
        renderQuestionList();
      }
    });
  }

  // 가로선 렌더링 (축소 상태)
  function renderDots() {
    const dotsContainer = document.getElementById('gcn-dots');
    if (!dotsContainer) return;

    dotsContainer.innerHTML = questions.map((q, index) => `
      <div class="gcn-dot" data-id="${q.id}" title="${escapeHtml(q.preview)}"></div>
    `).join('');

    // 클릭 이벤트 바인딩
    dotsContainer.querySelectorAll('.gcn-dot').forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = dot.dataset.id;
        scrollToQuestion(id);
      });
    });
  }

  // 질문 목록 렌더링
  function renderQuestionList(preserveHighlightId = currentHighlightId) {
    if (!questionList) return;

    // 질문 필터링
    const filteredQuestions = questions.filter(q => {
      if (!searchQuery) return true;
      return q.text.toLowerCase().includes(searchQuery);
    });

    // 개수 업데이트
    questionCount.textContent = filteredQuestions.length;

    // 목록 HTML 생성 - 심플한 스타일
    questionList.innerHTML = filteredQuestions.map((q, index) => `
      <div class="gcn-item" data-id="${q.id}">
        <div class="gcn-item-dot"></div>
        <div class="gcn-item-content">
          <div class="gcn-item-text">${escapeHtml(isPanelMaximized ? q.text : q.preview)}</div>
        </div>
      </div>
    `).join('');

    // 클릭 이벤트 바인딩
    questionList.querySelectorAll('.gcn-item').forEach(item => {
      item.addEventListener('click', (e) => {
        log('Item clicked, dataset:', item.dataset);
        const id = item.dataset.id;
        log('Click id:', id);
        e.stopPropagation();
        scrollToQuestion(id);
      });
    });

    // 가로선도 동시에 업데이트
    renderDots();

    // 설정에 따라 선택 유지 또는 현재 화면 기준 하이라이트 적용
    if (highlightMode === 'preserve' && preserveHighlightId && filteredQuestions.some(q => q.id === preserveHighlightId)) {
      highlightDirectoryItem(preserveHighlightId);
    } else {
      updateCurrentHighlight(highlightMode === 'viewport');
    }
  }

  // ==================== 이동 및 하이라이트 ====================

  // 지정된 질문으로 스크롤
  function scrollToQuestion(id) {
    log('scrollToQuestion called with id:', id);
    const element = findElementById(id);
    log('Found element:', element);

    if (!element) {
      log('Element not found for id:', id);
      log('Current questions:', questions);
      log('questionIdMap:', questionIdMap);

      // 모든 메시지 다시 검색 시도
      rescanMessages();
      const retryElement = findElementById(id);
      if (retryElement) {
        scrollToElement(retryElement, id);
      } else {
        log('Still cannot find element after rescan');
      }
      return;
    }

    scrollToElement(element, id);
  }

  // 스크롤 실행
  function scrollToElement(element, id) {
    log('scrollToElement called');
    log('Element:', element);
    log('Element rect:', element.getBoundingClientRect());

    // 먼저 패널을 강제로 펼침
    expandPanel();

    // 가장 안정적인 방법인 scrollIntoView를 직접 사용
    try {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
      log('scrollIntoView called successfully');
    } catch (e) {
      log('scrollIntoView error:', e);
    }

    // 강조 효과 추가
    highlightElement(element);
    highlightDirectoryItem(id);

    // 더 이상 자동으로 접지 않고, 사용자가 마우스를 뗄 때까지 펼친 상태 유지
  }

  // 현재 대화 ID 가져오기(URL 기준)
  function getCurrentConversationId() {
    return window.location.href;
  }

  // 메시지 다시 스캔
  function rescanMessages() {
    log('Rescanning messages...');
    syncQuestionsFromDom(currentHighlightId);
  }

  // 대화 전환 감지 - URL 변경 기준
  function checkConversationChange() {
    const newId = getCurrentConversationId();
    if (newId !== currentConversationId) {
      log('Conversation changed (URL), rescanning...');
      log('Old ID:', currentConversationId);
      log('New ID:', newId);
      currentConversationId = newId;
      rescanMessages();
    }
  }

  // 대화 전환 감지 - DOM 엘리먼트 변경 기준
  function checkConversationChangeByDOM() {
    const currentMessages = findUserMessages({ includeProcessed: true });
    const currentTexts = new Set(currentMessages.map(el => extractMessageText(el)));

    // 기존 메시지가 있었으나 현재 메시지와 완전히 다른 경우
    if (lastMessageTexts.size > 0 && currentMessages.length > 0) {
      let found = 0;
      for (const text of lastMessageTexts) {
        if (currentTexts.has(text)) {
          found++;
        }
      }
      // 이전 메시지 텍스트가 현재 대화에 하나도 없다면 대화가 전환된 것임
      if (found === 0) {
        log('Conversation changed (DOM), rescanning...');
        log('Old messages count:', lastMessageTexts.size);
        log('New messages count:', currentMessages.length);
        currentConversationId = getCurrentConversationId();
        rescanMessages();
        return true;
      }
    }

    // 대화 전환이 감지되지 않았을 때만 기록 업데이트
    lastMessageTexts.clear();
    currentMessages.forEach(el => {
      const text = extractMessageText(el);
      if (text) {
        lastMessageTexts.add(text);
      }
    });

    return false;
  }

  // 엘리먼트 하이라이트
  function highlightElement(element) {
    // 이전 하이라이트 제거
    document.querySelectorAll('.gcn-highlight').forEach(el => {
      el.classList.remove('gcn-highlight');
    });

    // 하이라이트 클래스 추가
    element.classList.add('gcn-highlight');

    // 일정 시간 후 하이라이트 제거
    setTimeout(() => {
      element.classList.remove('gcn-highlight');
    }, CONFIG.HIGHLIGHT_DURATION);
  }

  // 목차 항목 하이라이트
  function highlightDirectoryItem(id) {
    // 이전 하이라이트 제거
    if (questionList) {
      questionList.querySelectorAll('.gcn-item-active').forEach(el => {
        el.classList.remove('gcn-item-active');
      });
    }

    const dotsContainer = document.getElementById('gcn-dots');
    if (dotsContainer) {
      dotsContainer.querySelectorAll('.gcn-dot-active').forEach(el => {
        el.classList.remove('gcn-dot-active');
      });
    }

    // 하이라이트 추가
    if (questionList) {
      const item = questionList.querySelector(`[data-id="${id}"]`);
      if (item) {
        item.classList.add('gcn-item-active');
      }
    }

    if (dotsContainer) {
      const dot = dotsContainer.querySelector(`[data-id="${id}"]`);
      if (dot) {
        dot.classList.add('gcn-dot-active');
      }
    }

    currentHighlightId = id;
  }

  // 현재 화면에 보이는 질문 하이라이트 업데이트
  function updateCurrentHighlight(force = false) {
    if (!force && !isPanelExpanded && !panel.matches(':hover')) return;

    let currentQuestion = null;
    let closestPreviousDistance = Infinity;
    let closestVisibleDistance = Infinity;
    const viewportReferenceY = window.innerHeight * 0.45;

    questions.forEach(q => {
      const element = findElementById(q.id);
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const elementTop = rect.top;
      const elementCenter = rect.top + rect.height / 2;

      // 답변을 읽는 중에는 질문 자체가 화면 밖으로 올라가 있으므로,
      // 기준선보다 위에 있는 가장 가까운 질문을 현재 질문으로 본다.
      if (elementTop <= viewportReferenceY) {
        const distance = viewportReferenceY - elementTop;
        if (distance < closestPreviousDistance) {
          closestPreviousDistance = distance;
          currentQuestion = q;
        }
        return;
      }

      // 아직 첫 질문 위쪽에 있다면 화면에 보이는 질문 중 가장 가까운 항목을 사용
      if (!currentQuestion && rect.top < window.innerHeight && rect.bottom > 0) {
        const distance = Math.abs(elementCenter - viewportReferenceY);
        if (distance < closestVisibleDistance) {
          closestVisibleDistance = distance;
          currentQuestion = q;
        }
      }
    });

    // 하이라이트 업데이트
    if (currentQuestion && currentQuestion.id !== currentHighlightId) {
      highlightDirectoryItem(currentQuestion.id);
    } else if (!currentQuestion && currentHighlightId) {
      highlightDirectoryItem(currentHighlightId);
    }
  }

  // ==================== 리스너 및 초기화 ====================

  // 기존 메시지 스캔
  function scanExistingMessages() {
    syncQuestionsFromDom(null);
  }

  // DOM 리스너 설정
  function setupMutationObserver() {
    const observer = new MutationObserver(debounce((mutations) => {
      // 먼저 대화가 전환되었는지 확인 (DOM 변경 기준)
      const conversationChanged = checkConversationChangeByDOM();

      // 대화가 전환되었다면 후속 처리 건너뜀
      if (conversationChanged) return;

      // 그 다음 URL 변경 확인
      checkConversationChange();

      // 새로 추가된 노드만 확인
      const newElements = [];
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // 노드 자체 확인
            if (!node.dataset?.gcnProcessed && !node.dataset?.gcnId) {
              newElements.push(node);
            }
            // 자식 노드 확인
            node.querySelectorAll?.('[data-gcn-processed]:not([data-gcn-processed])').forEach(el => {
              if (!el.dataset.gcnProcessed && !el.dataset.gcnId) {
                newElements.push(el);
              }
            });
          }
        });
      });

      // 새 DOM이 붙으면 실제 질문 목록이 바뀌었는지 확인
      if (newElements.length > 0) {
        scheduleQuestionSync();
      }
    }, CONFIG.DEBOUNCE_DELAY));

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // URL 변경 감지 (대화 전환 감지) - 다양한 방식을 사용해 확실히 감지함
    let lastUrl = location.href;

    // 방식 1: popstate 이벤트
    window.addEventListener('popstate', () => {
      checkConversationChange();
    });

    // 방식 2: MutationObserver로 head 변경 감지
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        checkConversationChange();
      }
    }).observe(document.querySelector('head') || document, { subtree: true, childList: true });

    // 방식 3: 주기적으로 URL 변경 확인 (가장 안정적이며 SPA 앱 대응용)
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        checkConversationChange();
      }
    }, 500);
  }

  // 초기화
  function init() {
    // 페이지 로드 완료 대기
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(initializeExtension, 1500);
      });
    } else {
      setTimeout(initializeExtension, 1500);
    }
  }

  function initializeExtension() {
    // Gemini 페이지인지 확인
    if (!window.location.hostname.includes('gemini.google.com')) {
      return;
    }

    // 대화 ID 초기화
    currentConversationId = getCurrentConversationId();

    // 패널 생성
    createPanel();

    // 설정 적용
    loadSettings();
    setupSettingsListener();

    // 기존 메시지 스캔
    scanExistingMessages();

    // 리스너 설정
    setupMutationObserver();

    console.log('Gemini Chat Navigator initialized');
    log('Questions found:', questions.length);
  }

  // 시작
  init();
})();
