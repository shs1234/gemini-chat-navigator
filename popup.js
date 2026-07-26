// Gemini Chat Navigator - Popup Script

document.addEventListener('DOMContentLoaded', function() {
  // 엘리먼트 가져오기
  const questionCountEl = document.getElementById('question-count');
  const sessionTimeEl = document.getElementById('session-time');
  const openGeminiBtn = document.getElementById('open-gemini');
  const clearDataBtn = document.getElementById('clear-data');
  const alwaysShowPanelToggle = document.getElementById('always-show-panel');
  const highlightModeSelect = document.getElementById('highlight-mode');

  // storage에서 데이터 가져오기
  function loadData() {
    chrome.storage.local.get(['questionCount', 'sessionStart', 'alwaysShowPanel', 'highlightMode'], function(result) {
      if (result.questionCount !== undefined) {
        questionCountEl.textContent = result.questionCount;
      }

      if (result.sessionStart) {
        const elapsed = Math.floor((Date.now() - result.sessionStart) / 60000);
        if (elapsed < 60) {
          sessionTimeEl.textContent = elapsed + '분';
        } else {
          const hours = Math.floor(elapsed / 60);
          const mins = elapsed % 60;
          sessionTimeEl.textContent = hours + '시간 ' + mins + '분';
        }
      }

      alwaysShowPanelToggle.checked = Boolean(result.alwaysShowPanel);
      highlightModeSelect.value = result.highlightMode === 'viewport' ? 'viewport' : 'preserve';
    });
  }

  // Gemini 열기
  openGeminiBtn.addEventListener('click', function() {
    chrome.tabs.create({ url: 'https://gemini.google.com/' });
  });

  // 데이터 초기화
  clearDataBtn.addEventListener('click', function() {
    if (confirm('모든 데이터를 삭제하시겠습니까?')) {
      chrome.storage.local.remove(['questionCount', 'sessionStart'], function() {
        questionCountEl.textContent = '0';
        sessionTimeEl.textContent = '-';
      });
    }
  });

  // 목차 항상 펼치기 설정
  alwaysShowPanelToggle.addEventListener('change', function() {
    chrome.storage.local.set({
      alwaysShowPanel: alwaysShowPanelToggle.checked
    });
  });

  // 선택 방식 설정
  highlightModeSelect.addEventListener('change', function() {
    chrome.storage.local.set({
      highlightMode: highlightModeSelect.value
    });
  });

  // 초기 로드
  loadData();

  // 주기적 업데이트
  setInterval(loadData, 30000);
});
