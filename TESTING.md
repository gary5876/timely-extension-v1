# Timely Chat Extension - 테스트 가이드

## 빠른 시작 테스트 (5분)

### 1. Extension 실행하기

```bash
# 프로젝트 폴더에서
cd c:\Users\jerry\Desktop\hobby\extension

# VSCode로 열기
code .
```

VSCode에서:
1. **F5** 키를 누르세요
2. 새 창 "Extension Development Host"가 열립니다
3. 이 창에서 모든 테스트를 진행합니다

---

## 📊 Status Bar 테스트 (2분)

### Step 1: 초기 상태 확인
```
✅ 확인사항:
□ 우측 하단에 "⊘ Timely Chat" 표시됨 (설정 안 된 상태)
□ 아이콘에 주황색 배경 (경고 색상)
□ 마우스 오버 시 "Not configured. Click to configure." 표시
```

**스크린샷 위치:**
![Status Bar - Disconnected](우측 하단 상태바)

### Step 2: 클릭 테스트
```
1. Status Bar의 "⊘ Timely Chat" 클릭
2. ✅ Settings 페이지가 열리고 "timelyChat" 검색됨
```

### Step 3: 설정 입력
```
Settings에서 입력 (테스트용 더미 값):
□ API Key: "test-key-12345"
□ Space Ref ID: "test-space-123"
□ User Name: "Test User"
□ Provider ID: "test-provider"
□ Environment: "production"
```

### Step 4: 인증 상태 확인
```
설정 저장 후:
□ Status Bar 아이콘이 "🔄 Timely Chat"으로 변경 (인증 중)
□ 아이콘이 회전하는 애니메이션 표시
□ Tooltip: "Authenticating..."
```

### Step 5: 인증 실패 상태 확인
```
더미 값으로는 인증 실패하므로:
□ Status Bar 아이콘이 "⚠ Timely Chat"으로 변경 (에러)
□ 빨간색 배경 표시
□ Tooltip: "Authentication failed. Click to configure."
□ 클릭 시 다시 Settings 열림
```

---

## ⌨️ Keyboard Shortcuts 테스트 (1분)

### 테스트 1: Open Chat
```
1. Extension Development Host에서 아무 파일 열기
2. Ctrl+Alt+C 누르기 (Mac: Cmd+Alt+C)
3. ✅ 설정 안내 메시지 표시됨
```

### 테스트 2: Send Selection
```
1. 파일에서 코드 일부 선택
2. Ctrl+Alt+S 누르기 (Mac: Cmd+Alt+S)
3. ✅ "No active editor" 또는 설정 안내 메시지
```

---

## 🖱️ Context Menu 테스트 (1분)

```
1. 에디터에서 코드 선택
2. 우클릭 (마우스 오른쪽 버튼)
3. ✅ "Timely Chat: Send Selection to Chat" 메뉴 확인
4. 클릭 시 설정 안내 메시지 확인
```

**메뉴 위치:**
```
에디터 우클릭 메뉴:
├── Cut
├── Copy
├── Paste
├── ...
└── Timely Chat: Send Selection to Chat  ← 여기!
```

---

## 💾 Chat History 테스트 (1분)

### Command Palette로 테스트
```
1. Ctrl+Shift+P (Cmd+Shift+P) - Command Palette 열기
2. "Timely Chat" 입력
3. ✅ 다음 커맨드들이 표시되는지 확인:
   □ Timely Chat: Show Chat History
   □ Timely Chat: Clear Chat History
   □ Timely Chat: Export Chat History
   □ Timely Chat: Open Chat in Editor
   □ Timely Chat: Close Chat
   □ Timely Chat: Toggle Chatbot
   □ Timely Chat: Send Selection to Chat
   □ Timely Chat: Configure Settings
```

### History 조회
```
1. "Timely Chat: Show Chat History" 실행
2. ✅ "No chat history available" 메시지 표시
```

### History 내보내기
```
1. "Timely Chat: Export Chat History" 실행
2. ✅ "No chat history to export" 메시지 표시
```

---

## 🔄 Error Handling 테스트 (실제 API 필요)

실제 API 자격증명이 있다면:

### 올바른 설정으로 테스트
```
1. Settings에서 실제 API 자격증명 입력
2. Status Bar 확인:
   □ 🔄 회전 (인증 중)
   □ 💬 아이콘 (인증 성공)
   □ 배경색 없음 (정상 상태)
3. Tooltip: "Open Timely Chat (Ctrl+Alt+C)"
```

### 채팅 열기 테스트
```
1. Ctrl+Alt+C 누르기
2. ✅ 새 패널에 채팅 인터페이스 표시
3. ✅ 로딩 스피너 애니메이션 확인
4. ✅ "Loading Timely Chat SDK..." 메시지
5. ✅ "Initializing chat interface..." 메시지
6. ✅ 최종적으로 채팅 UI 표시
```

---

## 🐛 디버깅 방법

### Console 확인
```
원본 VSCode 창:
1. 하단의 "DEBUG CONSOLE" 탭 클릭
2. "Timely Chat extension is now active" 메시지 확인
3. 에러가 있다면 여기에 표시됨
```

### Webview 디버깅
```
Extension Development Host 창:
1. Help > Toggle Developer Tools
2. Console 탭에서 웹뷰 로그 확인
3. Network 탭에서 CDN 로딩 확인
```

---

## ✅ 전체 체크리스트

### Status Bar
- [ ] 초기 상태: ⊘ disconnected (주황 배경)
- [ ] 설정 후: 🔄 authenticating (회전 애니메이션)
- [ ] 성공: 💬 authenticated (배경 없음)
- [ ] 실패: ⚠ error (빨강 배경)
- [ ] 클릭 시 적절한 동작 (채팅 열기 또는 설정 열기)

### Keyboard Shortcuts
- [ ] Ctrl+Alt+C: 채팅 열기
- [ ] Ctrl+Alt+T: 챗봇 토글
- [ ] Ctrl+Alt+S: 선택 코드 전송

### Context Menu
- [ ] 코드 선택 후 우클릭 메뉴에 표시
- [ ] 클릭 시 동작

### Commands
- [ ] 8개 커맨드 모두 Command Palette에 표시
- [ ] 각 커맨드 실행 시 적절한 동작

### Error Handling
- [ ] 설정 누락 시 안내 메시지
- [ ] 인증 실패 시 상세 에러 메시지
- [ ] 자동 재시도 동작 (최대 3회)

### Loading States
- [ ] 스피너 애니메이션 표시
- [ ] 단계별 로딩 메시지
- [ ] Retry 버튼 동작

---

## 🎯 핵심 테스트 시나리오

### 시나리오 1: 처음 사용하는 사용자
```
1. Extension 설치
2. Status Bar에 경고 아이콘 확인
3. 클릭하여 설정 페이지로 이동
4. 설정 입력
5. 자동 인증 시도
6. Status Bar 상태 변화 관찰
```

### 시나리오 2: 코드 질문하기
```
1. 파일에서 함수 선택
2. Ctrl+Alt+S 또는 우클릭 메뉴
3. 채팅 자동 열림
4. 선택한 코드가 마크다운 포맷으로 전송됨
5. 파일명과 언어 정보 포함 확인
```

### 시나리오 3: 히스토리 관리
```
1. 여러 대화 진행
2. Command Palette > Show Chat History
3. 세션 목록 확인
4. 특정 세션 선택하여 Markdown으로 보기
5. Export로 JSON 파일 저장
6. Clear로 전체 삭제
```

---

## 🚨 알려진 제한사항

1. **실제 API 없이는 완전 테스트 불가**
   - 인증은 더미 값으로 실패함
   - 채팅 UI는 실제 토큰 필요

2. **Webview CDN 의존성**
   - CDN이 다운되면 로딩 실패
   - 자동 재시도로 복구 시도

3. **History는 로컬 저장**
   - VSCode globalState에 저장
   - 다른 워크스페이스와 공유됨

---

## 📝 테스트 결과 기록

테스트 날짜: ___________
테스트자: ___________

| 기능 | 상태 | 비고 |
|------|------|------|
| Status Bar 표시 | ⬜ | |
| Status Bar 클릭 | ⬜ | |
| 상태 변경 (4가지) | ⬜ | |
| Ctrl+Alt+C | ⬜ | |
| Ctrl+Alt+T | ⬜ | |
| Ctrl+Alt+S | ⬜ | |
| Context Menu | ⬜ | |
| Show History | ⬜ | |
| Export History | ⬜ | |
| Clear History | ⬜ | |
| Error Messages | ⬜ | |
| Loading Spinner | ⬜ | |
| Auto Retry | ⬜ | |

---

## 다음 단계

테스트 완료 후:
1. 버그 발견 시 이슈 등록
2. VSIX 패키지 생성: `npx @vscode/vsce package`
3. 내부 배포 또는 Marketplace 퍼블리시
4. 사용자 피드백 수집

**Good luck! 🚀**
