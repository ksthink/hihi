# EMERGENCY.md — 비상상황 매뉴얼

> 데이터가 지워졌거나, 키가 새어 나갔거나, 지도가 안 나올 때 **이 문서 하나만 보고**
> 따라 할 수 있게 쓴 매뉴얼입니다. 침착하게, 위에서부터 해당 상황을 찾으세요.

## 사고 대응 3원칙

1. **복구하기 전에, 지금 상태부터 백업하세요.** 잘못된 복구가 2차 사고를 만듭니다.
   (`admin_data/` 를 통째로 복사해 두는 것으로 충분: `cp -r admin_data /tmp/admin_data-사고날짜`)
2. **삭제보다 무서운 건 덮어쓰기입니다.** "비어 보인다"고 바로 저장·업로드 버튼을 누르지
   마세요 — 저장하는 순간 빈 상태가 새 진실이 됩니다. (그래도 저장 직전 자동 스냅샷이
   한 번 더 지켜 줍니다)
3. **사용자 앱과 운영 도구는 분리돼 있습니다.** 관리자 서버(EC2/맥)가 죽어도 사용자 앱은
   멀쩡합니다(웹=Vercel, 데이터=R2·Supabase). 서두르지 않아도 됩니다.

## 우리 데이터가 어디에 있는지 (30초 요약)

| 데이터 | 원본 위치 | 백업 |
|---|---|---|
| 산·코스·스팟 초안(draft) | `admin_data/<산코드>/draft.json` | ① 시트 xlsx ② `admin_data/backups/` 자동 스냅샷 ③ **git 커밋** |
| 큐레이션 | `admin_data/curations.json` | ① 큐레이션 xlsx ② 자동 스냅샷 ③ git |
| 표시 설정 | `admin_data/*-display.json` | git |
| 발행 산출물(팩·타일) | Cloudflare R2 | 없음 — **draft 에서 언제든 재발행 가능** |
| 큐레이션 이미지·GIF | Cloudflare R2 `images/mountains/` | ⚠️ **없음 (단본)** — xlsx 에는 URL 만 저장됨 |
| 사용자 계정·산행 기록 | Supabase (서울) | Supabase 플랜의 자동 백업 (대시보드에서 확인) |
| 비밀 키 | `.env` (EC2·맥, **git 에 없음**) | 각 서비스 대시보드에서 재발급 가능 |

---

## 1. 데이터 사고

### 1-1. 큐레이션이 전부 사라졌다 / 엉망이 됐다

세 겹의 복구 수단이 있습니다. 위에서부터 시도하세요. (2026-08-01 모의 훈련으로 검증됨 —
xlsx 복원 시 이미지 URL 까지 살아납니다. 이미지 파일은 카드 삭제와 무관하게 R2 에 남습니다.)

1. **xlsx 백업이 있으면**: 관리자 → 큐레이션 → [xlsx 업로드] → 미리 내용 확인 → 적용.
2. **없으면 자동 스냅샷**: `admin_data/backups/` 에서 최근 폴더를 찾아
   `curations.json` 이 있는지 확인 → 내용이 맞으면 `admin_data/curations.json` 에 복사 →
   관리자에서 아무 항목이나 살짝 수정 후 [저장] (R2 재배포를 일으키기 위해).
   ```bash
   ls -t admin_data/backups/            # 최근 스냅샷부터
   cp admin_data/backups/<시각>/curations.json admin_data/curations.json
   ```
3. **그것도 없으면 git**:
   ```bash
   git log --oneline -- admin_data/curations.json   # 마지막으로 멀쩡했던 커밋 찾기
   git checkout <커밋> -- admin_data/curations.json
   ```
   복사/체크아웃 후에는 반드시 관리자에서 [저장]을 눌러 R2 에도 반영하세요.

### 1-2. 산 초안(draft)이 지워졌다 / 코스·스팟이 엉망이 됐다

1. **시트 탭 자동 스냅샷**: 시트 탭 툴바의 백업 셀렉트에서 시각 선택 → [복원].
   (시트 저장·가져오기 직전 상태가 자동 보관됩니다 — 최근 30세트)
2. **git**:
   ```bash
   git log --oneline -- admin_data/<산코드>/draft.json
   git checkout <커밋> -- admin_data/<산코드>/draft.json
   ```
3. 복구 후 그 산을 **재발행**해야 앱에 반영됩니다 (산 편집 → 배포).

### 1-3. 잘못된 팩을 발행해 버렸다 (앱에 이상한 코스가 보임)

발행 산출물은 draft 의 사본일 뿐입니다. draft 를 1-2 로 복구한 뒤 **다시 발행**하면
끝입니다. 급하면 산 편집에서 해당 산의 "공개"를 잠시 꺼서 앱에서 감출 수 있습니다.

### 1-4. R2 파일이 지워졌다

- **팩·타일**(`packs/`, `kr-base.pmtiles` 등): draft 가 살아 있으면 **재발행으로 전부 재생성**
  됩니다. `kr-base` 전국 타일의 재구축 절차는 [CLOUDFLARE.md](CLOUDFLARE.md) 참고.
- **이미지**(`images/mountains/`): ⚠️ 유일한 단본입니다. 지워지면 원본 사진으로 재업로드하는
  수밖에 없습니다. 앱은 이미지가 404 면 회색 그래디언트로 폴백하므로 깨져 보이진 않습니다.

### 1-5. 사용자 산행 기록이 사라졌다는 신고

- 기록은 Supabase `climb_records` 에 있고 RLS 로 본인만 지울 수 있습니다. 운영자가 관리자
  등반 기록 탭(전 계정 열람)에서 실제로 없는지 먼저 확인하세요.
- 원본 고해상 트랙은 **사용자 기기에 GPX 로** 남습니다(클라우드에는 단순화본만) — 기기의
  앱 문서함/iCloud 를 확인하도록 안내.
- DB 차원 사고라면: Supabase 대시보드 → Database → Backups 에서 복원. **지금 미리 자동
  백업이 켜져 있는 플랜인지 확인해 두세요** — 아니라면 주기적 `pg_dump` 를 검토.

---

## 2. 보안 사고 (키 유출·무단 접근)

> 공통 원칙: **키는 "찾는" 게 아니라 "바꾸는" 겁니다.** 유출이 의심되면 원인 조사보다
> 재발급(회전)이 먼저입니다. 전부 무료·즉시 가능합니다.

### 2-1. `.env` 를 실수로 커밋/공유했다 — 최악 시나리오, 순서대로 전부

1. **Supabase secret 키** (service_role — 최우선, DB 전체 권한):
   Supabase 대시보드 → Settings → API → service_role **Reset**. 새 키를 `.env` 에 반영.
2. **R2 API 키**: Cloudflare 대시보드 → R2 → API 토큰 → 해당 토큰 **삭제** 후 재발급.
3. **관리자 비밀번호·토큰**: `.env` 의 `ADMIN_PASSWORD`·`ADMIN_TOKEN` 값을 새로 바꾸고
   서버 재시작 (`sudo systemctl restart hiheight-admin`).
4. **기상청 키**: data.go.kr 마이페이지에서 재발급 → Vercel 환경변수 `KMA_KEY` 교체 →
   재배포.
5. 커밋을 이미 push 했다면 히스토리에서 지워도 이미 퍼졌다고 가정하세요 — **회전이 끝이면
   안전합니다**(옛 키는 전부 무효). 히스토리 정리는 그 후 여유 있을 때.

> 참고: 앱에 들어 있는 Supabase **publishable(anon) 키는 공개용**입니다 — 유출 개념이
> 없고 RLS 가 방어합니다. 이 키만 노출된 것은 사고가 아닙니다.

### 2-2. 관리자 콘솔에 누가 들어온 것 같다

관리자 서버는 기본 `0.0.0.0`(외부 접속 허용 + 비밀번호/토큰 보호)입니다.

1. 즉시 `.env` 의 `ADMIN_PASSWORD`·`ADMIN_TOKEN` 변경 + 서버 재시작 (기존 세션 전부 무효).
2. 외부 접속이 필요 없으면 `.env` 에 `ADMIN_BIND=127.0.0.1` 추가 → 로컬 전용으로 잠금.
3. 피해 확인: `git status` / `git diff admin_data/` 로 운영 데이터 변조 여부 확인 —
   변조됐으면 1장 절차로 복구. (5회 로그인 실패 시 IP 10분 잠금은 기본 내장)

### 2-3. 사용자 계정 탈취 신고

Supabase 대시보드 → Authentication → 해당 사용자 → 비밀번호 리셋 메일 발송(또는 세션
무효화). 기록·프로필은 RLS 로 그 계정만 접근하므로 다른 사용자 피해는 없습니다.

---

## 3. 서비스 장애 (사용자 앱이 이상할 때)

### 3-1. 지도(기저 타일)가 안 나온다

원인 후보 순서대로 확인:
```bash
# ① R2 가 살아 있나 (직접)
curl -sI -H "User-Agent: hiheight/1.0" -H "Range: bytes=0-99" \
  https://pub-cfc2302f77a446c1a0fdff6d0ae4e451.r2.dev/kr-base.pmtiles | head -3
# ② 웹 프록시가 살아 있나
curl -sI -H "Range: bytes=0-99" https://hihi.ksthink.com/pmtiles/kr-base.pmtiles | head -3
```
- ① 이 실패 → Cloudflare 장애 또는 파일 삭제(1-4). Cloudflare 상태 페이지 확인.
- ① 은 되는데 ② 가 실패 → Vercel 문제. Vercel 대시보드에서 함수 로그 확인·재배포.
- 오프라인 팩을 저장한 사용자는 **저장된 지도로 계속 산행 가능**합니다 — 급보수 중에도
  안내할 수 있는 사실.

### 3-2. 날씨가 안 나온다

Vercel `/api/weather` 또는 기상청(data.go.kr) 장애. 앱은 마지막 성공 응답 스냅샷으로
폴백하므로 치명적이지 않습니다. 기상청 키 만료(연 단위)일 수 있으니 data.go.kr 에서
키 상태를 확인하세요.

### 3-3. 로그인·기록 저장이 안 된다

Supabase 장애 가능성 — status.supabase.com 확인. **산행 자체는 영향 없습니다**(로컬 우선
설계: 지도·트래킹은 기기에서 동작, 기록 업로드만 나중에). 복구되면 정상화됩니다.

### 3-4. 관리자 서버(EC2)가 죽었다

사용자 영향 없음. `sudo systemctl restart hiheight-admin` → 안 되면
`sudo journalctl -u hiheight-admin -n 50` 으로 원인 확인. **`git pull` 직후라면 재시작을
잊었는지**부터 의심 (파이썬 모듈 캐시 — README §5).

---

## 4. 예방 체크리스트 (사고를 작게 만드는 습관)

- [ ] 관리자 작업 후 **"커밋 푸시"** — `admin_data/` 가 git 에 있는 것이 최후의 방어선입니다.
- [ ] 큰 편집(일괄 수정·대량 삭제) 전에 **xlsx 내려받기** 한 번 — 시트·큐레이션 모두.
- [ ] `.env` 는 절대 커밋·전송 금지 (`.gitignore` 에 있음 — 새 머신 이전 시 scp 로만).
- [ ] Supabase 자동 백업 여부를 **지금** 확인해 두기 (대시보드 → Database → Backups).
- [ ] (선택·미구현) `images/mountains/` 주기 백업 스크립트 — 이미지 단본 약점을 없애는
      마지막 조각. 필요해지면 만들 것.

## 긴급 참조

| 무엇 | 어디서 |
|---|---|
| Cloudflare R2 (타일·팩·이미지) | dash.cloudflare.com → R2 → 버킷 `hihi` |
| Supabase (DB·Auth·백업) | supabase.com/dashboard |
| Vercel (웹 배포·함수·환경변수) | vercel.com 대시보드 |
| 기상청 키 | data.go.kr 마이페이지 |
| 관리자 서버 | `sudo systemctl {restart,status} hiheight-admin` · 로그 `journalctl -u hiheight-admin` |
| 자동 스냅샷 | `admin_data/backups/<UTC 시각>/` (최근 30세트) |
