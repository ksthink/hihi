# CLOUDFLARE.md — 기저 지도 타일 자체 호스팅 (Cloudflare R2) 구축 가이드

> 이 문서는 하이하잇의 **기저 지도 타일을 Cloudflare R2 에 직접 올려 서비스한 과정**을
> 처음 하는 사람도 그대로 따라 할 수 있게 순서대로 정리한 기록입니다.
> (2026-07-07 최초 구축. 실제 사용한 값·명령을 담되, 비밀 키는 넣지 않습니다.)

---

## 왜 R2 인가 (배경)

지도 배경(도로·지형·라벨)은 **PMTiles** 라는 벡터 타일 파일 하나에서 나옵니다.
원래는 Protomaps 가 무료로 공개한 데모 파일(`demo-bucket.protomaps.com/v4.pmtiles`)을
빌려 쓰고 있었는데, **어느 날 그 파일이 삭제되어 지도가 통째로 안 뜨는 사고**가 났습니다.

그래서 "우리 지도 타일은 우리가 직접 호스팅한다"로 방향을 정했고, 후보를 비교했습니다.

| 후보 | 저장 | 전송량(egress) | 결론 |
|---|---|---|---|
| Supabase Storage | 무료 1GB | 무료 **5GB/월** ← 병목 | 지도처럼 반복 조회하면 대역폭 초과 위험 |
| **Cloudflare R2** | 무료 10GB | **무제한(무료)** ✅ | 지도 타일에 최적 |

**R2 의 핵심 장점은 egress(전송량)가 무료**라는 점입니다. 지도는 사용자가 열 때마다 타일을
반복해서 내려받으므로, 전송량이 무료인 R2 가 딱 맞습니다.

> 참고: 클라이언트는 505MB 전체를 받지 않습니다. **PMTiles 는 HTTP Range 요청으로
> 화면에 보이는 타일 조각만** 내려받습니다. 파일이 커도 실제 전송량은 작습니다.

---

## 사전 준비물

- Cloudflare 계정 (무료. R2 활성화 시 **결제카드 등록**은 필요 — 무료 한도 내면 청구 없음)
- 이 저장소의 `tools/pmtiles` (go-pmtiles CLI. `bash scripts/setup_admin.sh` 로 설치됨)
- Python + `boto3` (업로드용. `pip install boto3`)

---

## 전체 순서 (한눈에)

```
① R2 버킷 생성
② 공개 개발 URL 활성화        → pub-xxxx.r2.dev 획득
③ CORS 정책 추가              → 브라우저가 타일을 읽을 수 있게
④ R2 API 토큰 발급            → 업로드 인증용 (Access Key + Secret)
⑤ 한국 영역 타일 추출          → kr-base.pmtiles (약 505MB)
⑥ R2 에 업로드                → boto3 멀티파트
⑦ 앱 연결                     → 프록시를 R2 로 재지정
⑧ 검증                        → 로컬·프로덕션에서 지도 확인
```

---

## ① R2 버킷 생성

1. Cloudflare 대시보드 → 왼쪽 메뉴 **스토리지 및 데이터베이스 → R2 객체 스토리지**
2. **버킷 만들기** → 이름 입력 (이 프로젝트에서는 `hihi`)
3. 위치는 자동(APAC) 또는 원하는 지역

생성되면 버킷 **설정** 탭의 **일반** 항목에 **S3 API 주소**가 보입니다:
```
https://<계정ID>.r2.cloudflarestorage.com/<버킷명>
예) https://093381c454f4a70be7dbfc10b3968f14.r2.cloudflarestorage.com/hihi
```
이 주소는 **인증이 필요한 비공개 API** 입니다. (브라우저가 직접 쓰는 공개 주소가 아님 — ② 참고)

---

## ② 공개 개발 URL 활성화 (공개 읽기 주소 만들기)

브라우저가 지도를 읽으려면 **공개 URL** 이 필요합니다. S3 API 주소와는 다릅니다.

1. 버킷 → **설정** 탭 → **공개 개발 URL(Public dev URL)** 섹션
2. **활성화** (경고: 버킷 내용이 인터넷에 공개됨 — 지도 타일은 공개 데이터라 무방)
3. 생성되는 주소를 복사:
```
https://pub-<해시>.r2.dev
예) https://pub-cfc2302f77a446c1a0fdff6d0ae4e451.r2.dev
```
→ 업로드 후 파일은 `<이 주소>/kr-base.pmtiles` 로 접근됩니다.

> 프로덕션에서는 **커스텀 도메인**(예: `tiles.example.com`)을 붙이는 것을 권장하지만,
> 개발 단계에서는 `pub-xxxx.r2.dev` 로 충분합니다.

---

## ③ CORS 정책 추가 (⚠️ 핵심 — 안 하면 브라우저가 못 읽음)

브라우저가 다른 도메인(R2)의 파일을 **Range 요청**으로 읽으려면 CORS 허용이 필요합니다.

1. 버킷 → **설정** 탭 → **CORS 정책** → 추가/편집
2. 아래 JSON 붙여넣기:

```json
[{
  "AllowedOrigins": ["https://hihi.metaphr.dev", "http://localhost:8890"],
  "AllowedMethods": ["GET", "HEAD"],
  "AllowedHeaders": ["Range", "If-Match", "If-None-Match"],
  "ExposeHeaders": ["ETag", "Content-Range", "Accept-Ranges", "Content-Length"],
  "MaxAgeSeconds": 3600
}]
```

- `AllowedHeaders` 에 **`Range`**, `ExposeHeaders` 에 **`Content-Range`** 가 반드시 있어야
  PMTiles 의 부분 요청이 동작합니다.
- `AllowedOrigins` 에는 실제 접속 도메인을 넣습니다. 로컬 개발을 IP(예: `http://13.x.x.x:8890`)로
  접속한다면 그 오리진도 추가하거나 `"*"` 로 둡니다.

> 이 프로젝트는 브라우저가 R2 를 **직접** 부르지 않고 **same-origin 프록시**(⑦)를 거치므로
> CORS 오리진 제약을 사실상 우회합니다. 그래도 정책은 넣어 두는 것이 안전합니다.

---

## ④ R2 API 토큰 발급 (업로드 인증)

파일이 300MB 를 넘으면 대시보드 드래그 업로드가 막힙니다(우리 타일은 505MB). 그래서
**S3 API 로 업로드**해야 하고, 이를 위한 토큰이 필요합니다.

1. 브라우저에서 R2 API 토큰 페이지로 이동 (계정 ID 포함 직접 링크):
   ```
   https://dash.cloudflare.com/<계정ID>/r2/api-tokens
   ```
   또는 **R2 객체 스토리지 → 개요** 페이지 우측 상단의 **{ } API / R2 API 토큰**
2. **API 토큰 만들기** → 권한 **개체 읽기 및 쓰기(Object Read & Write)** → 적용 버킷 `hihi`
3. 생성되면 **한 번만** 표시되는 값을 복사:
   - **Access Key ID**
   - **Secret Access Key**

이 두 값을 저장소 루트의 **`.env`** 에만 저장합니다 (커밋 금지 — `.gitignore` 로 차단됨):

```bash
# .env  (커밋하지 말 것)
R2_ENDPOINT=https://<계정ID>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<Access Key ID>
R2_SECRET_KEY=<Secret Access Key>
R2_BUCKET=hihi
```

---

## ⑤ 한국 영역 타일 추출 (`tools/pmtiles extract`)

전 세계 Protomaps 빌드에서 **대한민국 영역만** 잘라냅니다.

```bash
# Protomaps 는 날짜별 빌드를 약 1주만 보관 → 오늘 날짜(UTC)로 최신본 지정
tools/pmtiles extract \
  "https://build.protomaps.com/$(date -u +%Y%m%d).pmtiles" \
  data/tiles/kr-base.pmtiles \
  --bbox=124.5,33.0,132.0,43.5 \
  --maxzoom=14
```

- `--bbox` = 백령도~독도, 마라도~북부 (경도 124.5–132, 위도 33–43.5)
- `--maxzoom=14` ≈ **505MB**. (줌을 낮추면 용량↓·디테일↓)
- 추출은 필요한 청크만 받아 **수십 초**면 끝납니다.
- 결과물 `data/tiles/kr-base.pmtiles` 는 gitignore 됨(대용량 — R2 로만 배포)

검증:
```bash
tools/pmtiles show data/tiles/kr-base.pmtiles   # bounds/zoom/타일수 확인
```

> ⚠️ `build.protomaps.com` 은 **기본 `Python-urllib` User-Agent 를 403 차단**합니다.
> go-pmtiles 는 자체 UA 를 보내므로 추출은 정상 동작합니다. (프록시 코드에서는 UA 를 직접
> 넣어줘야 합니다 — ⑦, "함정" 참고)

---

## ⑥ R2 에 업로드 (`scripts/r2_upload.py`)

505MB 는 **멀티파트 업로드**가 필요합니다. boto3 가 자동 처리합니다.

```bash
python3 scripts/r2_upload.py data/tiles/kr-base.pmtiles kr-base.pmtiles
```

- 자격증명은 `.env`(④)에서 읽습니다. 진행률(%)이 표시되고, 끝나면 HEAD 로 크기·ETag 확인.
- 스크립트 요지: `endpoint_url=R2_ENDPOINT`, `region_name="auto"`, `signature_version="s3v4"`,
  `TransferConfig(multipart_threshold=64MB, chunksize=64MB)`, `ContentType=application/octet-stream`

업로드 확인 (공개 URL + Range):
```bash
curl -s -D - -o /dev/null -H "Range: bytes=0-6" \
  "https://pub-<해시>.r2.dev/kr-base.pmtiles" | grep -iE "HTTP|content-range"
# → HTTP 206 / content-range: bytes 0-6/505771467  이면 성공
```

---

## ⑦ 앱 연결 (프록시를 R2 로 재지정)

브라우저가 R2 를 직접 부르면 CORS·차단 이슈가 생길 수 있어, **same-origin 프록시**를 거칩니다.
(이 프록시 계층은 웹 전용이며, iOS 네이티브에서는 로컬 파일 접근이라 폐기됩니다.)

수정한 파일 4개:

| 파일 | 변경 |
|---|---|
| `scripts/serve.py` | 로컬 프록시: `/pmtiles/*` → R2 `PMTILES_URL` 로 Range 전달 (+ `User-Agent` 헤더) |
| `api/tiles.js` | Vercel 서버리스: 동일 역할 + `Cache-Control` 로 CDN 캐시 |
| `vercel.json` | `{"source":"/pmtiles/:path*","destination":"/api/tiles"}` 리라이트 |
| `app.js` | `PMTILES_URL = ${location.origin}/pmtiles/kr-base.pmtiles` |

`serve.py` / `api/tiles.js` 는 R2 공개 URL 을 환경변수로 바꿀 수 있게 되어 있습니다:
```
PMTILES_URL = "https://pub-<해시>.r2.dev/kr-base.pmtiles"   (기본값, env 로 교체 가능)
```

### ⚠️ 함정: R2 도 기본 UA 를 차단한다
`pub-xxxx.r2.dev` 는 Cloudflare 봇 보호로 **`Python-urllib` 등 기본 UA 를 403** 합니다.
그래서 서버측 프록시(serve.py, api/tiles.js)는 요청에 **`User-Agent: hiheight/1.0`** 을
반드시 붙입니다. (브라우저는 자기 UA 를 쓰므로 무관)

---

## ⑧ 검증

```bash
# 로컬 (serve.py / admin_server.py 실행 중)
curl -s -D - -o /dev/null -H "Range: bytes=0-16383" \
  "http://127.0.0.1:8890/pmtiles/kr-base.pmtiles" | grep -iE "HTTP|content-range"

# 프로덕션 (배포 후)
curl -s -D - -o /dev/null -H "Range: bytes=0-16383" \
  "https://hihi.metaphr.dev/pmtiles/kr-base.pmtiles" | grep -iE "HTTP|content-range|cache-control"
```
둘 다 `HTTP 206` + `content-range: .../505771467` 이면 성공. 브라우저에서 지도가 뜨는지 확인.

---

## 타일 갱신하는 법 (OSM 데이터가 오래됐을 때)

지도 데이터는 시간이 지나면 낡습니다. 갱신은 **⑤ 추출 → ⑥ 업로드**만 다시 하면 됩니다.

```bash
tools/pmtiles extract "https://build.protomaps.com/$(date -u +%Y%m%d).pmtiles" \
  data/tiles/kr-base.pmtiles --bbox=124.5,33.0,132.0,43.5 --maxzoom=14
python3 scripts/r2_upload.py data/tiles/kr-base.pmtiles kr-base.pmtiles   # 같은 이름 → 덮어쓰기
```
같은 객체 이름으로 덮어쓰므로 앱 코드는 그대로입니다. (CDN 캐시가 있으면 잠시 뒤 반영)

---

## 비용 (무료 한도)

| 항목 | 무료 한도 | 이 프로젝트 |
|---|---|---|
| 저장 용량 | 10 GB/월 | 505MB → 여유 |
| 읽기(Class B) | 1천만 요청/월 | 타일 range 요청 — 넉넉 |
| 쓰기(Class A) | 100만 요청/월 | 업로드 몇 번 — 넉넉 |
| **전송(egress)** | **무제한 · $0** | 병목 없음 ✅ |

개인/소규모 트래픽에서는 사실상 무료입니다.

---

## 문제 해결 (자주 겪는 것)

| 증상 | 원인 / 해결 |
|---|---|
| 프록시가 **403** | R2/Protomaps 가 기본 UA 차단 → 요청에 `User-Agent` 헤더 추가 |
| 브라우저 콘솔 **CORS 오류** | ③ CORS 정책 누락/오리진 불일치 → `AllowedOrigins` 확인, `Range` 허용 확인 |
| **404** (공개 URL) | 아직 업로드 전이거나 객체 이름 불일치 → `kr-base.pmtiles` 철자 확인 |
| 대시보드 업로드가 막힘 | 파일 300MB 초과 → S3 API(⑥ `r2_upload.py`) 사용 |
| `extract` 가 403 | (해당 없음 — go-pmtiles 는 자체 UA. `curl` 로 확인 시엔 `-A` 로 UA 지정) |
| 지도는 뜨는데 라벨 폰트가 이상 | 타일 문제 아님 — 글리프/폰트는 `fonts/` 자체 호스팅 (README §7) |

---

## 관련 파일

- `scripts/r2_upload.py` — R2 업로드 스크립트
- `scripts/serve.py` · `api/tiles.js` · `vercel.json` — 프록시 재지정
- `.env` — R2 자격증명 (커밋 금지)
- `data/tiles/kr-base.pmtiles` — 추출 결과물 (gitignore)
- [README.md](README.md) §7 — 지도 자산 자체 호스팅 개요
