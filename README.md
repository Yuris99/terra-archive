# Terra Archive

> Worlds Preserved for Further Tomorrow  
> 다가올 내일을 위해 세계의 기록을 남기다.

명일방주의 게임 원문과 세계관 설정을 보존하고, 출처 기반 검색과 AI 분석을 통해 세계관 연구 및 콘텐츠 제작을 지원하는 프로젝트입니다.

**청킹·4개 언어 본문 검색·질문 기반 의미·단어 혼합 검색·원문/언어판 비교를 구현**했습니다. 글로벌 범위 선택본의 문서 103,668개에서 청크 206,048개를 만들고 원문 범위와 대조했으며 전체 로컬 벡터·출처 연결 검사도 통과했습니다. 로컬 RAG 시제품은 질문으로 근거를 찾지만 AI 해석의 정확성은 보장하지 않습니다. 개발 질문 20개(8개 사실 묶음)에서 혼합 검색의 상위 5개 근거 적중은 19/20이며 일반 정답률이 아닙니다.

**사용 범위는 글로벌 출시분만**입니다. 아직 글로벌에 출시되지 않은 콘텐츠는 청킹·검색·RAG 대상에서 제외합니다. 이미 출시된 콘텐츠의 중국어 단독 문장이나 번역 차이는 삭제하지 않고 **언어판 차이로 표시하며 유지**합니다. 글로벌 수집본에 대응 자료가 없는 항목은 출시 여부 미확인으로 임시 보류하며, 미출시 확정으로 단정하지 않습니다. 전체 보관본과 실제 검색용 입력을 구분합니다.

작업 설명과 진행·학습 기록은 [노션 Terra Archive](https://app.notion.com/p/3e5bcb87ce5080c4a730cb7f44b2d9e6)에 정리합니다. 그 아래에 작업 순서, 진행·검증·학습 기록, 공통 자료 형식과 출처, 청킹 설명을 두었습니다. 이후 작업 전 설계와 작업 후 결과도 노션 문서에 갱신합니다.

저장소의 [작업 순서](docs/roadmap.md), [진행 기록](docs/progress-log.md), [정규화 스키마](docs/normalized-schema.md)는 구현 참고용 사본으로 유지합니다.

## 현재 수집 범위

1차 원본은 현재 국제 서버 데이터를 갱신하는 [`ArknightsAssets/ArknightsGamedata`](https://github.com/ArknightsAssets/ArknightsGamedata)입니다.

- 한국어 스토리 스크립트: `kr/gamedata/story/**`
- 오퍼레이터 기본 정보: `character_table.json`
- 오퍼레이터 프로필/기록: `handbook_info_table.json`
- 음성 대사: `charword_table.json`
- 모듈: `uniequip_table.json`
- 스킨: `skin_table.json`
- 스토리 색인: `story_table.json`, `story_review_table.json`
- 이벤트 메타데이터: `activity_table.json`

원본은 `data/raw/arknights-gamedata`에 내려받으며 Git에 포함하지 않습니다. 출처 커밋과 수집 결과만 `data/raw/manifests`에 기록합니다.

다국어 자료는 [`050644zf/ArknightsStoryJson`](https://github.com/050644zf/ArknightsStoryJson)에서 별도로 수집합니다.

- 필수 언어: 중국어 간체(`zh_CN`), 일본어(`ja_JP`), 영어(`en_US`)
- 한국어(`ko_KR`)도 함께 보관해 RAW에 없는 「불을 쫓는 낙엽」·「오랜만」을 보완합니다.
- 각 언어의 스토리 JSON, 위의 8개 데이터 테이블, 캐릭터·스토리 보조 색인을 포함합니다.
- 스토리 JSON은 ASTR가 게임 TXT를 변환한 자료입니다. 기존 RAW를 덮어쓰지 않고 `data/raw/arknights-story-json`에 보관합니다.

## 시작하기

PowerShell 7 또는 Windows PowerShell과 Git, Node.js가 필요합니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/acquire-raw-data.ps1
node --preserve-symlinks-main ./scripts/inspect-raw-data.mjs
```

특정 커밋을 재현하려면:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/acquire-raw-data.ps1 -Revision 758c9e70c34aa56cb8e04dd84b40440c5c859a67
```

이미 받은 파일을 네트워크 접근 없이 다시 검사하고 manifest만 갱신하려면:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/acquire-raw-data.ps1 -UseExisting
```

데이터 출처, 파일별 역할, 저작권 취급 원칙은 [docs/data-sources.md](docs/data-sources.md)에 정리되어 있습니다.

## 다국어 자료 수집 및 검사

```powershell
pwsh.exe -NoProfile -File ./scripts/acquire-story-json.ps1 -Revision afa898dccac71a9b9f2be9258e7bd92931197ed9
node --preserve-symlinks-main ./scripts/inspect-story-json.mjs
```

수집 스크립트는 4개 언어를 기본으로 받고, 이미지와 다른 언어는 제외합니다. `-Revision main`을 지정하면 상류 최신 버전을 수집합니다. 이미 받은 자료의 manifest만 다시 만들려면 `-UseExisting`을 사용합니다.

검사 결과는 `data/reports/story-json-coverage.json`에 기록됩니다. 언어별 JSON 구문·언어 표시·해시와 테이블 구조를 검사하고, 회상 색인 및 한국어 색인과 파일 연결을 대조합니다. 이는 문장 단위 번역 정합성이나 모든 게임 텍스트의 무누락을 보장하지 않습니다.

다국어 자료는 로컬 연구용입니다. 글로벌 범위 선택본만 새 본문 검색 화면과 로컬 RAG 시제품에 연결했습니다.

## 공통 문서 변환 및 검증

정규화는 대사·지문·선택지·프로필·음성·모듈·스킨을 `언어 / 종류 / 화자 / 본문 / 출처`가 있는 형태로 바꾸는 단계입니다. 주제 태그를 추측하거나 AI로 요약하는 작업은 포함하지 않습니다.

```powershell
node --preserve-symlinks --preserve-symlinks-main --test ./scripts/tests/normalize-corpus.test.mjs
node --preserve-symlinks --preserve-symlinks-main ./scripts/normalize-corpus.mjs
node --preserve-symlinks --preserve-symlinks-main ./scripts/validate-normalized-corpus.mjs
```

변환 전에 위의 `inspect-story-json.mjs` 검사를 통과해야 합니다. 재실행하면 생성된 공통 문서만 갱신하며, 두 RAW 저장소와 기존 탐색기 입력은 변경하지 않습니다.

- 출력: `data/normalized/v1/<locale>/<kind>.jsonl`, 언어별 연결 목록 `catalog.json`, 해시 목록 `manifest.json`.
- 생성 결과: `data/reports/normalization.json`.
- 원본 대조 결과: `data/reports/normalized-validation.json`.
- 형식 및 검증 범위: [정규화 스키마](docs/normalized-schema.md).

고정된 수집본에서 문서 **105,101개**, 본문 항목 **1,694,340개**를 만들고 검사했습니다. 문서 수는 언어별 번역본을 각각 포함합니다. 본문 항목은 추출된 원본 텍스트 필드이며, 아직 검색용 청크는 아닙니다. 게임 텍스트가 담긴 생성 파일은 Git에서 제외합니다.

## 글로벌 범위 선택

```powershell
node --preserve-symlinks --preserve-symlinks-main --test ./scripts/tests/normalize-corpus.test.mjs ./scripts/tests/retrieval-policy.test.mjs ./scripts/tests/global-selection.test.mjs ./scripts/tests/content-annotations.test.mjs
node --preserve-symlinks --preserve-symlinks-main ./scripts/select-global-corpus.mjs
```

정규화 검증 후 실행합니다. 기준은 `config/retrieval-policy.json`이며, 영어를 기준으로 한국어·일본어에도 같은 자료 키가 있어야 허용합니다. 글로벌 스토리·모듈·스킨 테이블에 미래 최초 공개 시점이 기록된 항목도 제외합니다. 미래 복각 시점은 이미 공개된 내용을 제외하는 근거로 쓰지 않습니다.

- 실제 청킹·검색·RAG 입력: `data/retrieval/global-v1/`.
- 선택 및 전체 재검사 결과: `data/reports/global-selection.json`.
- 글로벌 대응이 없어 출시 여부 확인 전 보류한 항목: 스토리 100개, 프로필 160개, 음성 844개, 모듈 39개, 스킨 290개 — 총 1,433개. 모두 미출시로 독립 확인한 목록은 아닙니다.
- 남긴 문서: 103,668개, 본문 항목: 1,669,670개. 중국어판도 포함합니다.
- 언어판 차이 표시 원장: `config/content-annotations.json`, 검증된 검색용 표시 목록: `data/retrieval/global-v1/annotations.json`.

후속 단계는 선택 manifest의 `validationPassed`가 참이고 정책·입력 해시가 현재 자료와 일치하는지 확인한 후 이 경로만 사용해야 합니다. RAW와 전체 정규화 경로를 검색 입력으로 사용하면 안 됩니다. 재생성 도중에는 성공 표시를 해제하므로, 실패한 출력도 사용하지 않습니다.

이 필터는 고정 수집본의 글로벌 대응 자료와 명시된 시점을 기준으로 합니다. 실시간 공개 여부 인증은 아닙니다. **언어판 차이와 미출시 콘텐츠는 별개**입니다. 「편안한 잠꼬대」 SS-8 작전 전 「동화의 서막」에서 확인한 중국어 단독 문장 1개는 본문을 유지하고 별도 표시만 남겼습니다. 표시 목록은 원본 커밋·파일 해시·본문 위치·문자열 해시를 대조하며, manifest에 목록과 원장의 해시도 기록합니다. 표시가 미출시 차단을 해제하거나 새로운 제외 사유가 되지는 않습니다.

새 수집본을 도입할 때는 공개 기준일과 표시의 원본 위치를 다시 검토합니다. 모든 문장의 언어별 의미 차이를 전수 검증한 목록은 아닙니다. 검증된 표시는 청크와 원문 화면에 전달하고, RAG의 검색 근거에도 보존합니다.

## 청킹과 본문 검색

```powershell
node --preserve-symlinks --preserve-symlinks-main ./scripts/build-search-index.mjs
node --preserve-symlinks --preserve-symlinks-main ./scripts/evaluate-search.mjs
node --preserve-symlinks --preserve-symlinks-main --test ./scripts/tests/*.test.mjs
```

- 입력은 검증된 `data/retrieval/global-v1/`뿐입니다. 정책·표시 원장·선택본이 변경되면 재검증 없이 검색하지 않습니다.
- 정책은 `config/chunk-policy.json`입니다. 목표 900자·최대 1,400자이며 토큰 수가 아닙니다. 화자·항목 경계를 우선하고, 긴 본문을 나눌 때 원본 문자열 범위를 남깁니다.
- 선택지·조건·영상 명령 앞에서 묶음을 나누고 분기 조건을 보존합니다. 게임의 전체 분기 경로를 해석한 것은 아닙니다.
- 출력은 `data/indexes/global-v1/`, 검사 보고서는 `data/reports/chunking.json`입니다. 생성 후 모든 파일을 다시 읽어 원문 복원·순서·위치·표시를 검사합니다.
- 내용과 정책이 바뀌지 않은 출력은 **파일 단위로 재사용**합니다. 최신 재실행에서는 20개 파일 모두 재사용하고 전체 원문 대조를 다시 통과했습니다. 임의 문서의 자동 수집이나 문서 단위 증분 임베딩은 구현하지 않았습니다.
- 검색은 본문·제목의 문자 일치 검색입니다. 공백으로 나눈 단어는 모두 포함해야 하고, 따옴표는 문구 검색입니다. 반복 본문은 검색 결과에서만 합치며 원본을 삭제하지 않습니다.

## 로컬 RAG 시제품

Ollama가 실행 중이고 답변용 로컬 모델이 설치돼 있을 때 화면에서 모델을 선택할 수 있습니다. 실행 중 자동 다운로드·유료 API 호출은 하지 않습니다. 단어 일치 모드는 검색어로 고른 상위 5개 묶음, 의미 검색 모드는 질문 문장으로 고른 상위 5개 묶음을 모델에 전달합니다. 임베딩 전용 모델은 답변 모델 목록에서 제외합니다.

결과는 **원문과 정확히 일치하는 인용을 먼저 표시**하고, AI 해석은 의미 미검증 상태로 접어 둡니다. 실제 시험에서 인용이 맞지만 설명이 왜곡된 사례를 확인했습니다. 인용 검사 통과는 설명의 사실성·질문에 대한 관련성·완전성을 인증하지 않습니다. 출처와 주변 원문을 함께 확인해야 합니다.

```powershell
# 설치된 모델만 사용합니다. 모델 이름은 선택적으로 바꿀 수 있습니다.
node --preserve-symlinks --preserve-symlinks-main ./scripts/evaluate-local-rag.mjs gemma4:12b
# 아래 검사는 site 서버가 3010 포트에서 실행 중일 때 사용합니다.
node --preserve-symlinks --preserve-symlinks-main ./scripts/evaluate-server.mjs
```

보고서는 `data/reports/local-rag-evaluation.json`과 `data/reports/server-evaluation.json`입니다. 모델 시험 2건은 인용 검사만 자동 통과한 것이며 의미 정확도 벤치마크가 아닙니다.

2026-10-04에는 기존 설정으로 질문 기반 RAG 시험 5건을 모두 완료했습니다. 긍정 질문 4건에서 기대 출처와 정확한 인용을 확인했고, 근거 없는 질문 1건은 모델 자체가 답변을 거절했습니다. 전체 호출 시간은 1.4~8.7초였습니다. 다만 수동 원문 대조에서 영어 캔디 답변의 맛은 맞지만 인물에게 발언을 연결하는 부가 표현은 근거가 불충분했습니다. 설명까지 완전 통과한 시험이나 일반 정답률로 집계하지 않습니다. 결과는 `semantic-rag-evaluation.json`과 `semantic-rag-manual-review-20261004.json`, 이전 시간 초과는 날짜가 붙은 별도 보고서에 보존합니다.

## 로컬 의미 검색과 평가

설명과 제한 사항은 [의미 검색·평가 안내](docs/semantic-search.md)에 정리했습니다. 질문 문장으로 원문을 찾는 **의미·단어 혼합**을 기본 모드로 제공하고, **단어 일치 / 의미만 비교**도 유지합니다. 전부 생성·검증된 벡터 자료가 있을 때만 혼합·의미 모드를 선택할 수 있습니다.

```powershell
# 최초 명시 설치 단계. 화면/검색 API에서는 모델을 자동 설치하지 않습니다.
ollama pull qwen3-embedding:0.6b
node --preserve-symlinks --preserve-symlinks-main ./scripts/build-semantic-index.mjs
node --preserve-symlinks --preserve-symlinks-main ./scripts/audit-semantic-index.mjs
node --preserve-symlinks --preserve-symlinks-main ./scripts/evaluate-retrieval.mjs --semantic
```

모델·지문·512차원 설정은 `config/semantic-policy.json`, 출력은 `data/indexes/semantic-v1/`입니다. `build-semantic-index.mjs`는 마지막 지문 검증된 배치까지 이어서 생성합니다. 파일별 입력·설정이 바뀌면 해당 파일의 파생 벡터만 재생성하며 원본은 보존합니다. 글로벌 선택·청킹·언어판 표시·모델 설정 해시가 달라지면 의미 검색도 차단합니다.

`config/retrieval-evaluation.json`은 실제 인용과 기대 출처를 확인한 개발용 질문 20개입니다. 네 언어로 옮긴 4개 사실과 한국어 스토리 사실 4개이므로 총 8개 사실 묶음이며, 일반적인 정확도를 인증하는 평가가 아닙니다. 단어 검색에 질문 문장/수동 핵심어를 넣은 결과와 의미만 비교·혼합 검색에 같은 질문 문장을 넣은 결과를 비교합니다. 상위 5·20개에 기대 원문이 있는지 측정하며 AI 설명의 사실성까지 채점하는 지표는 아닙니다.

유사도는 정답 확률이 아닙니다. 질문과 무관한 내용에도 가까운 순위가 생길 수 있으므로 출처와 직접 답할 근거를 확인해야 합니다. 선택한 자료 언어로만 결과를 제한하며, 다른 언어로 질문할 수 있어도 번역 간 문장 대응이나 동등한 품질은 보장하지 않습니다.

2026-10-04에는 발언자와 자료의 관련 인물을 구분하는 지시·근거 형식을 보완하고 기존 5문항+새 질문 10개를 개발/독립 검사로 나눴습니다. 15개 모두 응답했지만 설명 전체 수동 대조는 11개 지지·4개 보완 필요로 품질 전체 통과는 아닙니다. AI 해석과 한계 설명 모두 미검증 상태로 접으며 원문 인용 기준을 유지합니다. 실제 결과와 한계는 [의미 검색·평가 안내](docs/semantic-search.md)에 기록했습니다.

## 로컬 기록 탐색기

로컬 사이트는 `site`에 있습니다. `/search`는 검증된 4개 언어 본문 검색·원문 비교·로컬 AI 실험 화면이고, `/`는 기존 한국어 RAW 수집 현황 화면입니다.

이미 빌드된 사이트는 프로젝트 폴더의 **`Start-Terra.cmd`를 더블클릭**하면 서버 실행 후 브라우저가 열립니다. 서버는 숨김 백그라운드 프로세스로 실행하고 작업용 터미널을 닫아도 유지됩니다. 이미 정상 실행 중이면 재사용합니다. PC를 재시작한 뒤에는 다시 실행해야 합니다.

PowerShell에서 서버만 시작하려면 프로젝트 루트에서 아래 명령을 실행합니다. 실행 상태와 로그는 Git에서 제외된 `site/outputs/local-server/`에 남깁니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./scripts/start-local-site.ps1
```

화면은 `http://127.0.0.1:3010/search`입니다. 새 설치나 코드 변경 후에는 먼저 아래 개발 환경을 준비하고 `site`에서 `npm.cmd run build`로 빌드합니다.

```powershell
cd site
npm.cmd install
npm.cmd run dev
```

브라우저에서 `http://127.0.0.1:3000/search`를 엽니다. 서버는 로컬 주소에만 바인딩합니다. 검색 화면을 사용하기 전에 위의 검색 자료 생성 명령을 실행해야 합니다. 실행 시 기존 화면용 RAW 카탈로그도 다시 생성하며, 생성 파일은 Git에 포함하지 않습니다.

기존 `/` 화면은 이전 한국어 입력을 유지하므로 그 화면의 누락 표시는 새 다국어 선택본의 검사 결과와 다를 수 있습니다. 보완한 한국어 스토리는 `/search`에서 찾습니다. 프로덕션 확인은 `npm.cmd run build` 후 `npm.cmd run start -- --port 3010`으로 실행했습니다.
