# Phase 0 데이터 출처 및 수집 정책

## 1차 소스

| 항목 | 값 |
| --- | --- |
| 저장소 | `ArknightsAssets/ArknightsGamedata` |
| URL | <https://github.com/ArknightsAssets/ArknightsGamedata> |
| 성격 | `arkprts`와 GitHub Actions로 갱신되는 커뮤니티 게임 데이터 스냅샷 |
| 대상 리전 | `kr` |
| 로컬 위치 | `data/raw/arknights-gamedata` |
| 버전 식별자 | Git commit SHA |

`Kengxxiao/ArknightsGameData`는 널리 알려진 기존 저장소지만, 저장소 안내에 따르면 JP/KR/US 데이터 업데이트가 중단되었습니다. 따라서 Terra Archive에서는 레거시 비교·검증 소스로만 취급하고 최신 한국어 데이터의 기준으로 사용하지 않습니다.

## 다국어 보완 소스

| 항목 | 값 |
| --- | --- |
| 저장소 | [`050644zf/ArknightsStoryJson`](https://github.com/050644zf/ArknightsStoryJson) |
| 스토리 형식 | [ASTR-Script](https://github.com/050644zf/ASTR-Script)가 게임 TXT를 변환한 JSON |
| 대상 언어 | 중국어 간체 `zh_CN`, 일본어 `ja_JP`, 영어 `en_US`, 한국어 `ko_KR` |
| 로컬 위치 | `data/raw/arknights-story-json` |
| 고정 스냅샷 | `afa898dccac71a9b9f2be9258e7bd92931197ed9` (2026-09-29) |
| 수집 기록 | `data/raw/manifests/arknights-story-json.json` |
| 검사 결과 | `data/reports/story-json-coverage.json` |

각 언어의 `gamedata/story/**`, 8개 데이터 테이블, `chardict.json`, `charinfo.json`, `storyinfo.json`, `wordcount.json`, `extrastory.json`을 선택 수집합니다. 이미지와 중국어 번체는 이번 수집에서 제외합니다.

한국어 변환 JSON에는 현재 한국어 TXT 스냅샷에 없는 `act24side`(「불을 쫓는 낙엽」 19편), `act13mini`(「오랜만」 6편)이 있습니다. 자료 수집 후에도 기존 RAW와 탐색기 입력 데이터는 그대로 유지하며, 보완 연결은 후속 정규화 단계에서 수행합니다.

JSON 저장소 커밋은 정확히 기록하지만 각 스토리의 변환 전 TXT 커밋은 확인되지 않아 manifest의 `originalStoryTxtCommit`을 `null`로 둡니다. 가공된 스토리를 원본 TXT로 표기하지 않습니다. ASTR 안내상 튜토리얼·전투 중 팝업 등은 변환 대상 전체를 보장하지 않으므로 회상 색인 커버리지와 전체 RAW 파일 수를 구분합니다.

후속 검색에서는 같은 스토리의 언어별 자료를 연결하되 언어·리전·출처 버전을 보존해야 합니다. 2026-10-02 사용자 결정에 따라 글로벌에 아직 공개되지 않은 내용은 청킹·검색·RAG 대상에서 제외합니다. 중국어 번역 전체를 제거하지는 않습니다. 글로벌 대응 자료와 공개 시점을 기준으로 선택한 `data/retrieval/global-v1/`만 후속 입력으로 사용합니다. 전체 RAW와 정규화 자료는 별도 로컬 보관본입니다.

## 수집 범위와 역할

| 원본 경로 | 역할 | Phase 1 활용 예상 |
| --- | --- | --- |
| `kr/gamedata/story/**` | 메인·이벤트·기타 스토리 원문 스크립트 | 대사/지문 파싱, 스토리 문서화 |
| `kr/gamedata/excel/character_table.json` | 캐릭터 ID, 이름, 직군, 희귀도 등 | 오퍼레이터 기본 엔티티 |
| `kr/gamedata/excel/handbook_info_table.json` | 프로필, 기록 자료, 오퍼레이터 기록 연결 | 설정 문서와 해금 조건 |
| `kr/gamedata/excel/charword_table.json` | 음성 대사와 음성 언어 메타데이터 | 대사 문서와 출처 연결 |
| `kr/gamedata/excel/uniequip_table.json` | 모듈 설명, 임무, 캐릭터 연결 | 모듈 설정 문서 |
| `kr/gamedata/excel/skin_table.json` | 스킨 설명과 브랜드 정보 | 스킨 설정 문서 |
| `kr/gamedata/excel/story_table.json` | 스토리 파일 메타데이터 | 파일-에피소드 연결 |
| `kr/gamedata/excel/story_review_table.json` | 회상/스토리 목록 | 공개 순서와 묶음 구성 |
| `kr/gamedata/excel/activity_table.json` | 이벤트 메타데이터 | 이벤트-스토리 연결 |

## 보존 원칙

- RAW 파일은 변환하거나 수정하지 않는다.
- 수집 시점, 원격 URL, 요청 revision, 실제 commit SHA를 manifest에 기록한다.
- 언어/리전 코드는 원본 디렉터리 구조의 `kr`을 유지한다.
- 정규화 결과는 추후 `data/normalized`에 별도로 만들고 RAW와 섞지 않는다.
- 위키 해설, 팬 번역, 추론은 게임 원문과 별도 출처 유형으로 관리한다.
- 업데이트는 새 commit을 받은 뒤 manifest와 구조 검사 결과를 비교하는 방식으로 추적한다.

## 저작권 및 공개 범위

이 저장소의 게임 데이터에는 권리자의 저작권이 적용될 수 있으며, 원본 제공 저장소에서 데이터 전체에 대한 명시적 재배포 라이선스를 확인하지 못했습니다. 따라서 RAW 스냅샷은 로컬 연구용으로만 보관하고 Terra Archive Git 저장소에는 커밋하지 않습니다.

향후 공개 서비스에서는 원문 전문 재게시를 기본 기능으로 삼지 않고, 검색·분석 결과의 요약, 필요한 범위의 인용, 원본 식별자와 출처 표시를 중심으로 설계합니다. 공개 전에는 서비스 지역과 운영 방식에 맞춘 별도의 법률·플랫폼 정책 검토가 필요합니다.

