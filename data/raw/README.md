# Raw data

이 디렉터리는 외부 원본 스냅샷을 **수정 없이** 보관하는 로컬 작업 영역입니다.

- `arknights-gamedata/`: 수집 스크립트가 만드는 sparse Git checkout. Git에서 제외됩니다.
- `arknights-story-json/`: 중국어·일본어·영어·한국어 스토리 JSON과 관련 테이블의 sparse Git checkout. 스토리는 ASTR 변환 자료이며 기존 TXT RAW와 구분합니다. Git에서 제외됩니다.
- `manifests/`: 출처 commit, 수집 시점, 파일 수와 크기를 기록합니다.

원본을 직접 편집하지 마세요. 이후 파싱·정규화 산출물은 `data/normalized`에 분리합니다.

다국어 수집: `pwsh.exe -NoProfile -File scripts/acquire-story-json.ps1`

다국어 검사: `node --preserve-symlinks-main scripts/inspect-story-json.mjs`

