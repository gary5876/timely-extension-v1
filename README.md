# Timely Chat for VS Code

VSCode에서 Timely GPT AI와 대화하세요. 코드를 선택하여 AI에게 질문하고, 실시간 스트리밍으로 답변을 받을 수 있습니다.

![Timely Chat](https://img.shields.io/badge/Timely-Chat-blue)
![VS Code](https://img.shields.io/badge/VS%20Code-1.75+-green)

## 빠른 시작 가이드

처음 사용하시나요? 아래 단계를 따라해보세요!

### 1단계: 설치하기
1. VS Code 왼쪽 사이드바에서 **네모 4개 아이콘** (확장) 클릭
2. 검색창에 `Timely Chat` 입력
3. **설치** 버튼 클릭

### 2단계: API Key 설정하기

**API Key 발급받기:**
[timelygpt.co.kr](https://timelygpt.co.kr) 접속 → 왼쪽 하단 **프로필** → **설정** → **연동 키 관리**

**방법 1: 간편 설정 (권장)**
1. VS Code 왼쪽 사이드바에서 **파란 말풍선 아이콘** (Timely Chat) 클릭
2. API Key가 없으면 입력창이 자동으로 표시됩니다
3. 발급받은 API Key 입력 후 Enter

**방법 2: 설정에서 직접 입력**
1. [timelygpt.co.kr](https://timelygpt.co.kr)에서 API Key 발급
2. VS Code 상단 메뉴: **파일** → **기본 설정** → **설정** 클릭
3. 검색창에 `Timely Chat` 입력
4. **API Key** 항목에 발급받은 키 입력

### 3단계: 채팅 시작하기
1. VS Code 왼쪽 사이드바에서 **Timely Chat 아이콘** 클릭
2. 아래 입력창에 질문 입력
3. **전송** 버튼 클릭 또는 `Enter` 키

### 코드에 대해 질문하기
1. 코드 파일에서 궁금한 부분을 **마우스로 드래그**하여 선택
2. **마우스 오른쪽 클릭** → **Timely Chat: 선택한 코드 전송** 클릭
3. 채팅창에서 질문 입력

---

## 주요 기능

### AI 채팅
- Timely GPT를 통한 AI 대화
- 실시간 스트리밍으로 빠른 응답 표시
- 사이드바 또는 에디터 패널에서 대화

### 코드 공유
- 코드를 선택하고 바로 AI에게 질문
- 파일명, 프로그래밍 언어 정보 자동 포함

### 세션 관리
- 대화 기록 유지
- 새 대화 세션 시작 기능

## 설치

### VSCode 마켓플레이스 (권장)
1. VS Code 실행
2. 왼쪽 사이드바 **확장** 아이콘 클릭 (네모 4개 모양)
3. `Timely Chat` 검색
4. **설치** 클릭

### 터미널로 설치 (개발자용)
```bash
code --install-extension HID.timely-chat-vscode
```

## 설정

**설정 열기:** 파일 → 기본 설정 → 설정 → `Timely Chat` 검색

| 설정 | 설명 | 필수 |
|------|------|------|
| API Key | Timely GPT API Key | ✅ 필수 |
| Model | 사용할 AI 모델 | 선택 (기본: gpt-4.1) |
| Instructions | AI에게 줄 추가 지시사항 | 선택 |

> API Key는 [timelygpt.co.kr](https://timelygpt.co.kr)에서 발급받을 수 있습니다.

## 사용 방법

### 마우스로 사용하기

| 하고 싶은 일 | 방법 |
|-------------|------|
| 채팅 열기 | 왼쪽 사이드바 **Timely Chat 아이콘** 클릭 |
| 코드 질문하기 | 코드 선택 → 우클릭 → **선택한 코드 전송** |

### 명령어로 사용하기 (선택사항)

`F1` 키를 누르고 아래 명령어를 검색하세요:

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

### v1.0.0 (현재)

**정식 릴리스:**
- AI 파일 읽기/쓰기/편집 기능 추가
- 파일 작업 자동 적용 옵션
- 차단 파일 패턴 설정
- 최대 파일 읽기 크기 설정
- 전체적인 안정성 개선

### v0.0.6

**UI/UX 개선:**
- 채팅 패널 및 사이드바 UI 전면 개선
- 메시지 표시 레이아웃 최적화
- 사용자 경험 향상을 위한 인터페이스 리팩토링

### v0.0.5

**마켓플레이스 배포 준비:**
- `package.json`에 GitHub 저장소 정보 추가
- 익스텐션 메타데이터 보완

### v0.0.4

**단축키 호환성 개선:**
- macOS 단축키를 `cmd+alt` 에서 `cmd+option`으로 수정
- 키보드 단축키 호환성 향상

### v0.0.3

**문서 개선:**
- README.md 사용법 가이드 대폭 개선
- 빠른 시작 가이드 추가
- 설치 및 설정 방법 상세 설명 추가

### v0.0.2

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
- 기본 채팅 기능 구현
- 사이드바 및 에디터 패널 지원
- 코드 선택 후 AI에게 전송 기능
- 키보드 단축키 지원

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