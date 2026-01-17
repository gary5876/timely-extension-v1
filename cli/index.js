#!/usr/bin/env node

const { exec } = require('child_process');
const os = require('os');

console.log('🚀 Timely Chat 시작 중...\n');

// VSCode에서 Timely Chat 사이드바 열기
const command = os.platform() === 'win32'
  ? 'code --command "timely-chat.sidebarView.focus"'
  : 'code --command "timely-chat.sidebarView.focus"';

exec(command, (error) => {
  if (error) {
    // VSCode가 없거나 확장이 설치되지 않은 경우
    console.log('⚠️  VSCode에서 Timely Chat 확장을 설치해주세요.\n');
    console.log('설치 방법:');
    console.log('1. VSCode 열기');
    console.log('2. Ctrl+Shift+X (확장)');
    console.log('3. "Timely Chat" 검색 후 설치\n');
    console.log('또는 터미널에서:');
    console.log('  code --install-extension HID.timely-chat-vscode\n');
    return;
  }

  console.log('✅ Timely Chat이 VSCode에서 열렸습니다!');
  console.log('\n단축키:');
  console.log('  Ctrl+Alt+C  채팅 열기');
  console.log('  Ctrl+Alt+S  선택한 코드 전송');
  console.log('  Ctrl+Alt+N  새 대화\n');
});
