# Timely Chat for VS Code

VS Code에서 Timely GPT AI와 대화하세요. 코드를 선택하여 AI에게 질문하고, 대화 기록을 관리할 수 있습니다.

![Timely Chat](https://img.shields.io/badge/Timely-Chat-blue)
![VS Code](https://img.shields.io/badge/VS%20Code-1.75+-green)

## Features

### AI Chat Integration
- 사이드바 또는 에디터 패널에서 Timely GPT AI와 대화
- 실시간 AI 응답

### Code Sharing
- 코드를 선택하고 바로 AI에게 질문
- 파일명, 프로그래밍 언어 정보 자동 포함

### Chat History
- 대화 내역 자동 저장
- 이전 세션 조회 및 JSON으로 내보내기

### Status Bar
- 연결 상태 실시간 표시
- 클릭하여 빠르게 설정 열기

## Installation

1. VS Code에서 Extensions 탭 열기 (`Ctrl+Shift+X`)
2. "Timely Chat" 검색
3. Install 클릭

## Requirements

사용하려면 Timely 서비스 계정이 필요합니다:
- API Key
- Space Reference ID
- Provider ID

## Configuration

설정 (`Ctrl+,`)에서 "Timely Chat"을 검색하여 구성하세요.

### Required Settings

| 설정 | 설명 |
|------|------|
| `timelyChat.apiKey` | Timely API 키 |
| `timelyChat.spaceRefId` | Space Reference ID |
| `timelyChat.userName` | 사용자 표시명 |
| `timelyChat.providerId` | 고유 사용자 식별자 |

### Optional Settings

| 설정 | 기본값 | 설명 |
|------|--------|------|
| `timelyChat.environment` | `production` | API 환경 (production/staging) |
| `timelyChat.serviceName` | `Timely Chat` | 채팅에서 표시될 서비스명 |
| `timelyChat.avatarIcon` | - | 사용자 아바타 아이콘 URL |
| `timelyChat.chatbotIcon` | - | 챗봇 아이콘 URL |
| `timelyChat.faq` | `[]` | 자주 묻는 질문 목록 |
| `timelyChat.instructions` | - | 챗봇 동작 지시사항 |

## Usage

### Keyboard Shortcuts

| 단축키 | macOS | 설명 |
|--------|-------|------|
| `Ctrl+Alt+C` | `Cmd+Alt+C` | 에디터에서 채팅 열기 |
| `Ctrl+Alt+T` | `Cmd+Alt+T` | 챗봇 토글 |
| `Ctrl+Alt+S` | `Cmd+Alt+S` | 선택한 코드를 채팅으로 전송 |

### Commands

Command Palette (`Ctrl+Shift+P`)에서 "Timely Chat"을 입력하여 모든 명령어를 확인할 수 있습니다:

- **Open Chat in Editor**: 에디터 영역에서 채팅 열기
- **Toggle Chatbot**: 챗봇 토글
- **Send Selection to Chat**: 선택한 코드를 채팅으로 전송
- **Show Chat History**: 이전 채팅 세션 보기
- **Clear Chat History**: 채팅 기록 삭제
- **Export Chat History**: 채팅 기록 JSON으로 내보내기
- **Configure Settings**: 설정 열기

### Context Menu

코드를 선택한 후 우클릭하면 "Timely Chat: Send Selection to Chat" 메뉴가 나타납니다.

## Examples

### 코드에 대해 질문하기

1. 코드 선택
2. `Ctrl+Alt+S` 누르기 (또는 우클릭 → Send Selection to Chat)
3. AI가 선택한 코드에 대해 답변

### 사이드바에서 채팅

1. 액티비티 바에서 Timely Chat 아이콘 클릭
2. 채팅 시작

### 에디터 패널에서 채팅

1. `Ctrl+Alt+C` 누르기
2. 전체 화면으로 채팅

## Troubleshooting

### "설정이 필요합니다" 메시지가 표시됨
→ 필수 설정(API Key, Space ID, User Name, Provider ID)을 모두 입력했는지 확인하세요.

### 인증 실패
→ API Key와 Space Reference ID가 올바른지 확인하세요.
→ 네트워크 연결을 확인하세요.

### 채팅이 로드되지 않음
→ 인터넷 연결을 확인하세요 (SDK가 CDN에서 로드됨).
→ VS Code를 재시작해 보세요.

## Privacy

이 익스텐션은 Timely 서비스와 통신합니다. 대화 내용은 Timely 서버로 전송됩니다. 자세한 내용은 [Timely 개인정보 처리방침](https://timelygpt.co.kr)을 참조하세요.

## License

MIT License

---

**Enjoy coding with Timely Chat!**