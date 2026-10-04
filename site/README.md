# Terra Archive Explorer

현재 확보한 명일방주 한국어 RAW 데이터를 눈으로 검사하기 위한 로컬 기록 탐색기입니다.

## 기능

- 수집된 파일과 색인 커버리지 확인
- 최신 이벤트와 알려진 데이터 공백 표시
- 오퍼레이터 검색 및 프로필·음성·모듈·기록 연결 확인
- 메인, 이벤트, 미니 스토리, 오퍼레이터 기록 검색
- 각 스토리의 원본 파일 경로 및 존재 여부 확인

## 실행

먼저 프로젝트 루트에서 RAW 데이터를 받아야 합니다. 이후 이 디렉터리에서 실행합니다.

```powershell
npm.cmd install
npm.cmd run dev
```

`npm.cmd run dev`와 `npm.cmd run build`는 실행 전에 `scripts/generate-archive-data.mjs`를 호출해 현재 RAW 스냅샷으로 로컬 카탈로그를 다시 만듭니다.

생성되는 `app/generated/archive-data.json`에는 게임 원문에서 파생된 미리보기가 포함되므로 Git에서 제외하며 공개 배포하지 않습니다.

