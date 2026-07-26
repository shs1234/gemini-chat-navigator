# Gemini Chat Navigator

Gemini 대화용 플로팅 목차를 만들어 주는 Chrome 확장 프로그램입니다.

## 기능

- Gemini 대화에서 사용자 질문을 자동으로 추출
- 페이지 오른쪽에 떠 있는 목차 패널 표시
- 목차 항목을 클릭하면 해당 질문 위치로 이동
- 기본은 접힌 상태(좁은 막대)이며, 마우스를 올리면 펼쳐짐
- 질문 검색 필터 지원
- 현재 화면에 보이는 질문 강조 표시

## 설치

1. 이 저장소를 다운로드하거나 클론합니다
2. Chrome을 열고 `chrome://extensions/`로 이동합니다
3. 오른쪽 위의 "개발자 모드"를 켭니다
4. "압축해제된 확장 프로그램을 로드"를 클릭합니다
5. 프로젝트 폴더를 선택합니다

## 사용법

1. [Gemini](https://gemini.google.com/)를 엽니다
2. 새 대화를 시작하거나 기존 대화를 엽니다
3. 페이지 오른쪽에 목차 패널이 표시됩니다
4. 마우스를 올리면 목차가 펼쳐집니다
5. 질문을 클릭하면 해당 위치로 이동합니다

## 파일 구조

```
gemini-chat-navigator/
├── manifest.json      # Chrome 확장 설정
├── content.js         # 주요 로직 스크립트
├── styles.css         # 목차 패널 스타일
├── popup.html         # 확장 팝업
├── popup.js           # 팝업 스크립트
├── icons/             # 확장 아이콘
└── README.md
```

## 라이선스

MIT License
