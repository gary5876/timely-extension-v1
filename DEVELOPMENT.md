# Development Guide

이 문서는 Timely Chat VSCode Extension 개발을 위한 가이드입니다.

## 프로젝트 구조

```
extension/
├── src/
│   ├── extension.ts              # Extension 진입점
│   ├── types/
│   │   └── index.ts              # TypeScript 타입 정의
│   ├── providers/
│   │   ├── TimelyViewProvider.ts # Sidebar Webview Provider
│   │   └── TimelyChatPanel.ts    # Editor Panel Provider
│   └── utils/
│       ├── auth.ts               # 인증 관련 유틸리티
│       └── config.ts             # 설정 관련 유틸리티
├── media/
│   └── chat-icon.svg             # 확장 아이콘
├── .vscode/
│   ├── launch.json               # 디버그 설정
│   └── tasks.json                # 빌드 태스크
├── package.json                  # Extension manifest
├── tsconfig.json                 # TypeScript 설정
└── README.md                     # 사용자 문서
```

## 개발 환경 설정

### 1. 의존성 설치

```bash
npm install
```

### 2. 컴파일

```bash
npm run compile
```

또는 watch 모드:

```bash
npm run watch
```

### 3. 디버깅

1. VSCode에서 F5 키를 누르거나 "Run Extension" 디버그 설정을 실행
2. 새로운 VSCode 창(Extension Development Host)이 열립니다
3. 이 창에서 extension을 테스트할 수 있습니다

## 주요 컴포넌트

### Extension.ts

Extension의 진입점으로, 다음을 처리합니다:
- Extension 활성화
- 커맨드 등록
- Webview Provider 등록
- 인증 관리
- 설정 변경 감지

### TimelyViewProvider

Sidebar에 표시되는 Webview를 관리합니다:
- Webview HTML 생성
- TimelyChat SDK 로드
- Extension과 Webview 간 메시지 전달

### TimelyChatPanel

Editor 영역에 표시되는 Webview Panel을 관리합니다:
- Panel 생성 및 관리
- Chat 열기/닫기
- Chatbot 토글

### Authentication (auth.ts)

Timely API 인증을 처리합니다:
- 토큰 발급
- 토큰 유효성 검증
- 24시간 토큰 만료 처리

### Configuration (config.ts)

Extension 설정을 관리합니다:
- 설정 값 읽기
- 필수 설정 검증
- 설정 누락 시 사용자 안내

## 커맨드

Extension이 제공하는 커맨드:

- `timely-chat.openChat`: Editor에서 채팅 열기
- `timely-chat.closeChat`: 채팅 닫기
- `timely-chat.toggleChatbot`: Chatbot 토글
- `timely-chat.configure`: 설정 열기

## 설정

Extension의 설정은 `package.json`의 `contributes.configuration`에 정의되어 있습니다.

### 필수 설정

- `timelyChat.apiKey`
- `timelyChat.spaceRefId`
- `timelyChat.userName`
- `timelyChat.providerId`

### 선택 설정

- `timelyChat.environment`
- `timelyChat.serviceName`
- `timelyChat.avatarIcon`
- `timelyChat.chatbotIcon`
- `timelyChat.faq`
- `timelyChat.instructions`

## Webview 통신

Extension과 Webview는 메시지 기반으로 통신합니다:

### Extension → Webview

```typescript
webview.postMessage({
  type: 'token',
  token: 'xxx'
});
```

### Webview → Extension

```typescript
vscode.postMessage({
  type: 'error',
  message: 'Error message'
});
```

## TimelyChat SDK 통합

Webview에서 TimelyChat SDK를 CDN을 통해 로드합니다:

```javascript
// SDK 로드
await loadScript('https://cdn.jsdelivr.net/gh/timely-hub/timely-chat@p.1.0.3/index.js');

// Chat 인스턴스 생성
chat = new window.TimelyChat(
  container,
  {
    token: token,
    name: serviceName,
    icons: { avatar, chatbot },
    chatbot: { faq, instructions }
  },
  { style: { width: '100%', height: '100%' } }
);
```

## 테스트

### 수동 테스트

1. Extension을 디버그 모드로 실행 (F5)
2. 설정에서 API 자격 증명 구성
3. Sidebar에서 Timely Chat 아이콘 클릭
4. 또는 Command Palette에서 "Timely Chat: Open Chat in Editor" 실행

### 테스트 시나리오

- [ ] 필수 설정 누락 시 에러 메시지 표시
- [ ] 올바른 설정으로 인증 성공
- [ ] Sidebar에서 Chat 로드
- [ ] Editor Panel에서 Chat 로드
- [ ] 설정 변경 시 Webview 새로고침
- [ ] 토큰 만료 후 재인증
- [ ] Chat 열기/닫기 커맨드 동작
- [ ] Chatbot 토글 커맨드 동작

## 빌드 및 배포

### VSIX 패키지 생성

```bash
# vsce 설치 (처음 한 번만)
npm install -g @vscode/vsce

# 패키지 생성
vsce package
```

생성된 `.vsix` 파일을 VSCode에서 설치하거나 Marketplace에 배포할 수 있습니다.

### Marketplace 배포

```bash
vsce publish
```

## 문제 해결

### "Cannot find module 'vscode'" 오류

TypeScript 컴파일러가 VSCode API 타입을 찾지 못하는 경우:

```bash
npm install @types/vscode@^1.75.0 --save-dev
```

### Webview가 로드되지 않음

1. Content Security Policy 확인
2. Browser console에서 에러 확인 (Help > Toggle Developer Tools)
3. CDN URL 접근 가능 여부 확인

### 인증 실패

1. API 자격 증명 확인
2. Environment (production/staging) 설정 확인
3. 네트워크 연결 확인

## 추가 기능 구현 아이디어

- [ ] Chat history 저장
- [ ] Multiple chat windows
- [ ] Keyboard shortcuts
- [ ] Status bar integration
- [ ] Context menu integration
- [ ] Code snippet sharing to chat
- [ ] Chat export functionality
- [ ] Theme customization

## 참고 자료

- [VSCode Extension API](https://code.visualstudio.com/api)
- [VSCode Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- [Timely Chat Documentation](https://github.com/timely-hub/timely-chat)
