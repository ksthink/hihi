# QA 기록

프로젝트 진행 중 오간 질문/답변을 기록한다. 최신 항목이 위로 온다.

---

## 2026-07-04 · Vercel에 Supabase URL/anon/service_role 을 env 로 등록하면 안전한가?

**Q.** Vercel에 Supabase url, anon, role key 등의 환경변수를 등록하도록 해줘. 그게 안전한 게 맞지?

**A.** 지금 구조(빌드 없는 순수 정적 앱)에선 그 방식이 안전하지 않거나(특히 service_role) 의미가 없다.

- **정적 앱은 env가 브라우저로 자동 전달 안 됨** — Vercel env는 서버(서버리스 함수)·빌드 과정에서만 읽힘. `supabase-client.js` 는 브라우저에서 실행되고 브라우저엔 `process.env` 가 없다. 값을 넣으려면 번들러(빌드) 도입이 필요하고, 그러면 결국 브라우저 번들에 그대로 노출됨.
- **anon 키·URL은 원래 공개값** — 모든 요청에 실려 나감. env로 옮겨도 보안 이득 0. 현재처럼 `supabase-client.js` 에 두는 게 정상(RLS가 보호).
- **⚠️ service_role 은 프런트/Vercel 클라이언트에 절대 금지** — RLS 를 우회하는 관리자 전권 키. 브라우저가 닿는 곳에 두면 전체 DB 탈취 위험. 지금 앱엔 서버 사이드 코드가 없어 Vercel에 둘 이유 자체가 없음. service_role 은 로컬 `.env`(시드 스크립트) 또는 미래의 서버리스 백엔드(서버 전용 env, 클라이언트 미노출) 에서만 사용.

- **정리**: 지금 Vercel에 env 등록 불필요(anon/URL은 코드에, service_role은 프런트 금지). 진짜 보안 조치는 노출된 service_role 키 재발급.
- **언제 env가 의미 있나**: 나중에 Vercel Functions(서버리스 API) 를 붙여 관리자 작업을 서버에서 처리할 때, service_role 을 "서버 전용" env로 넣고 함수에서만 사용(클라이언트엔 안 내려감) — 그건 안전.

---

## 2026-07-04 · 등산 팩 데이터는 어떻게 추가하나?

**Q.** 그럼 등산 팩 데이터는 어떻게 추가하면 되는거야?

**A.** 팩 = 한 산의 데이터 파일 3종(등산로·시설·등고선). 새 산 추가는 3단계.

- **① 데이터 생성 (콘텐츠 파이프라인, `scripts/*.py`)** — 제일 손이 가는 부분
  - 등산로: Overpass(OSM)에서 그 산 영역 `route=hiking`/`highway=path` → `data/<id>-routes.geojson` (`osm_trails.py`/`osm_routes.py`). 산마다 bbox·코스 선별 튜닝 필요
  - 등고선: SRTM DEM → `data/<id>-contours.geojson` (`make_contours.py`, venv)
  - 고도 프로파일: `add_elevation.py` 로 각 코스 `profile/ascent/max_elev` 채움
  - 시설(spots)은 있으면 추가, 없으면 생략

- **② 앱에 등록 (`app.js`)**
  - `PARKS`(app.js:9)에 `id, label, center, zoom, bbox, file:"data/<id>-routes.geojson"` 추가
  - `FAMOUS`(app.js:308)에 `{park, name, elev, region}` 추가 → 검색·추천·100대 명산 목록에 노출
  - ⚠️ 현재 한계: 스팟/등고선이 **북한산 하드코딩**(`map.on("load")` 직접 fetch + `applySpotsVisibility`/`applyContourVisibility` 가 `currentPark==="bukhansan"` 게이트). 그래서 새 산은 **등산로만 뜨고 등고선·스팟은 안 보임** → 두 번째 산부터는 **산별 로드로 일반화** 작업이 1회 필요

- **③ Supabase 시드 (`scripts/upload_packs.py`)**
  - `PACKS` dict + `MOUNTAINS` 리스트에 새 산 항목 추가
  - service_role 키(env)로 실행 → Storage `packs/<id>/` 업로드 + `mountains` 시드 → 오프라인 저장 자동 "3/3"

- **권장 진행:** 산 하나(예: 지리산·한라산)를 정해 ①생성 → ②등록(+스팟/등고선 일반화) → ③시드까지 한 번에 완성. 한 산으로 파이프라인을 굳히면 다음 산부터 빨라짐.

---

## 2026-07-04 · "팩 파일 시드", "팩 3/3" 이 무슨 뜻인가?

**Q.** "팩 파일 시드(선택) — service_role 키로 `python3 scripts/upload_packs.py` 실행 시 오프라인 저장이 '팩 3/3'으로 완성" — 이게 무슨 소리야?

**A.**

- **팩(pack)** = 한 산의 오프라인 데이터 묶음. 북한산 팩 = `routes.geojson`(등산로) + `spots.geojson`(시설) + `contours.geojson`(등고선). 추후 지도 타일 `.pmtiles` 도 포함 예정.

- **"팩 0/3" / "팩 3/3"** = 탐험 시트의 **오프라인 저장** 버튼(`app.js` 의 `dl-save`)이 Supabase Storage `packs/bukhansan/` 에서 위 3개 파일이 있는지 하나씩 확인한 결과. 즉 "3개 중 몇 개를 실제로 받아왔나".
  - 지금은 버킷이 비어 있어 → **0/3**
  - 파일 3개를 올려두면 → **3/3**

- **시드(seed)** = 서버(Storage/DB)에 초기 데이터를 채워 넣는 작업. 로컬 `data/*.geojson` 는 있지만 Supabase 에는 아직 안 올라가 있음. `scripts/upload_packs.py` 가 그 파일들을 Storage 에 업로드하고 `mountains` 목록도 채운다. 그래서 "시드 스크립트".

- **왜 service_role 키가 필요한가** = 업로드/DB 채우기는 관리자 쓰기 권한이 필요. 브라우저용 anon 키는 RLS 로 이런 쓰기가 막혀 있음(정상). 그래서 RLS 를 우회하는 service_role(비밀) 키로 로컬에서 1회 실행하며, 이 키는 절대 브라우저/깃에 두지 않고 환경변수로만 사용.

- **지금 꼭 해야 하나?** 아니요, 선택.
  - 저장 "표시"(`saved_packs` 기록)는 파일이 없어도 이미 동작(스모크 테스트로 확인).
  - 시드하면: 오프라인 저장이 "3/3"으로 뜨고, 팩 배포 파이프라인(서버에 올려두고 앱이 받아오는 흐름)이 실제로 동작하는지 검증됨.

- **iOS 이식 관점 고지** = 웹에서는 "3/3"으로 받아와도 브라우저에 진짜로 캐싱해 오프라인으로 쓰는 것은 아님(그건 iOS 파일시스템 단계로 미뤄둠). 웹에서 시드+3/3 의 의미는 "배포 경로가 살아있다는 검증"까지. 실제 오프라인 저장·사용은 네이티브에서 완성.
