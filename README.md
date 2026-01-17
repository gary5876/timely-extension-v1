# Timely Chat for VS Code

VSCode에서 Timely GPT AI와 대화하세요. 코드를 선택하여 AI에게 질문하고, 실시간 스트리밍으로 답변을 받을 수 있습니다.

![Timely Chat](https://img.shields.io/badge/Timely-Chat-blue)
![VS Code](https://img.shields.io/badge/VS%20Code-1.75+-green)

## 주요 기능

### AI 채팅
- Timely GPT SDK를 통한 공식 API 연동
- 실시간 토큰 스트리밍으로 빠른 응답 표시
- 사이드바 또는 에디터 패널에서 대화

### 코드 공유
- 코드를 선택하고 바로 AI에게 질문
- 파일명, 프로그래밍 언어 정보 자동 포함

### 세션 관리
- 대화 기록 유지
- 새 대화 세션 시작 기능 (`Ctrl+Alt+N`)

## 설치

### VSCode 마켓플레이스
```
Ctrl+Shift+X → "Timely Chat" 검색 → 설치
```

### CLI로 설치
```bash
code --install-extension HID.timely-chat-vscode
```

## 설정

설정 (`Ctrl+,`)에서 "Timely Chat"을 검색하여 구성하세요.

| 설정 | 설명 | 기본값 |
|------|------|--------|
| `timelyChat.apiKey` | Timely GPT API Key (필수) | - |
| `timelyChat.model` | 사용할 AI 모델 | `gpt-4.1` |
| `timelyChat.instructions` | AI 커스텀 지시사항 | - |

> API Key는 [timelygpt.co.kr](https://timelygpt.co.kr)에서 발급받을 수 있습니다.

## 단축키

| 단축키 | macOS | 기능 |
|--------|-------|------|
| `Ctrl+Alt+C` | `Cmd+Alt+C` | 채팅 열기 |
| `Ctrl+Alt+S` | `Cmd+Alt+S` | 선택한 코드 전송 |
| `Ctrl+Alt+N` | `Cmd+Alt+N` | 새 대화 시작 |

## 명령어

Command Palette (`Ctrl+Shift+P`)에서 사용 가능:

| 명령어 | 설명 |
|--------|------|
| `Timely Chat: 채팅 열기` | 에디터에서 채팅 패널 열기 |
| `Timely Chat: 채팅 닫기` | 채팅 패널 닫기 |
| `Timely Chat: 선택한 코드 전송` | 현재 선택한 코드를 채팅으로 전송 |
| `Timely Chat: 새 대화` | 새로운 대화 세션 시작 |
| `Timely Chat: 대화 기록 삭제` | 현재 세션 대화 삭제 |
| `Timely Chat: 설정` | 설정 화면 열기 |

## CLI 도구

터미널에서 바로 Timely Chat을 실행할 수 있습니다.

```bash
# 설치
cd cli && npm install -g .

# 실행
timely
# 또는
timely-chat
```

## 프로젝트 구조

```
├── src/
│   ├── extension.ts              # 확장 진입점
│   ├── providers/
│   │   ├── TimelyChatPanel.ts    # 에디터 채팅 패널
│   │   └── TimelyViewProvider.ts # 사이드바 뷰
│   ├── services/
│   │   └── chatService.ts        # Timely GPT SDK 통신
│   ├── types/
│   │   └── index.ts              # 타입 정의
│   └── utils/
│       ├── config.ts             # 설정 관리
│       └── session.ts            # 세션 관리
├── cli/                          # CLI 도구
├── media/                        # 아이콘 등 리소스
└── package.json
```

## 변경 이력

### v0.0.2 (현재)

**새로운 기능:**
- `@timely/gpt-sdk` 패키지를 사용한 공식 SDK 연동
- 실시간 토큰 스트리밍으로 응답 표시
- 세션 ID 기반 대화 관리 시스템
- CLI 도구 추가 (`timely`, `timely-chat` 명령어)
- 새 대화 시작 기능 (`Ctrl+Alt+N`)

**변경사항:**
- 채팅 서비스를 별도 모듈로 분리 (`chatService.ts`)
- 모든 명령어와 메뉴 한글화
- 설정 항목 간소화 (API Key, 모델, 지시사항만 필요)

**제거된 기능:**
- `toggleChatbot` 명령어
- `showHistory`, `exportHistory` 명령어
- `spaceRefId`, `providerId`, `userName` 등 불필요한 설정 항목

### v0.0.1

- 초기 릴리스

## 개발

```bash
# 의존성 설치
npm install

# 컴파일
npm run compile

# 개발 모드 (watch)
npm run watch

# 린트
npm run lint
```

## 문제 해결

### "Client not initialized" 오류
→ 설정에서 API Key를 입력했는지 확인하세요.

### 채팅이 로드되지 않음
→ 인터넷 연결을 확인하세요.
→ VS Code를 재시작해 보세요.

## Privacy

이 익스텐션은 Timely 서비스와 통신합니다. 대화 내용은 Timely 서버로 전송됩니다. 자세한 내용은 [Timely 개인정보 처리방침](https://timelygpt.co.kr)을 참조하세요.

## License

MIT License

---

**Enjoy coding with Timely Chat!**