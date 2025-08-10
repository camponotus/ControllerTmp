# FloorEditor

Electron 기반 스크립트/통신 보드 에디터. 스크립트를 실행하고, TCP 통신으로 3x2 보드를 제어/모니터링합니다.

## 요구 사항
- Node.js LTS (v18+)
- Yarn 1.x

## 설치 및 실행
```bash
yarn       # 의존성 설치
yarn start # 개발 실행
```

## 빌드
```bash
yarn build        # 현재 플랫폼용 빌드
yarn build:win    # Windows용 빌드
yarn build:mac    # macOS용 빌드
yarn build:linux  # Linux용 빌드
```

## 주요 기능
- **스크립트 에디터**: CodeMirror, 실행/중단, 실시간 로그
- **TCP 클라이언트**: IP/Port 연결, 상태 모니터링
- **시뮬레이션**: 연결 없이 테스트 가능
- **3x2 보드**: LED 제어, 색상 설정
- **통신 API**: `getButtonState()`, `takePressedPending()`, `sendColor()`

## 폴더 구조
```
src/
  main.js        # 메인 프로세스
  preload.js     # 렌더러 API
  runner/worker.js # 스크립트 실행
  renderer/      # UI
```

## 라이선스
MIT
