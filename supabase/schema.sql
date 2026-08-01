-- 하이하잇 Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 파일 전체를 붙여넣어 1회 실행한다.
-- 큰따옴표를 쓰지 않으므로 붙여넣기 시 따옴표 변환 문제가 없다.

-- mountains: 공개 카탈로그 (anon 읽기 허용)
create table if not exists mountains (
  id text primary key,
  name text,
  region text,
  elev int,
  center jsonb,
  zoom real,
  bbox jsonb,
  pack_version int default 1,
  pack_size_kb int,
  sort_order int default 100,
  published boolean default true,
  famous boolean default false,
  lists jsonb default '[]'::jsonb, -- 공식 추천 카테고리 (bac100·knps)
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);
alter table mountains enable row level security;
drop policy if exists mountains_read on mountains;
create policy mountains_read on mountains for select using (published);

-- profiles: 사용자 프로필
create table if not exists profiles (
  user_id uuid primary key references auth.users on delete cascade,
  nickname text,
  created_at timestamptz default now()
);
alter table profiles enable row level security;
drop policy if exists own_profile on profiles;
create policy own_profile on profiles for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- climb_records: 등반 기록.
-- track jsonb 포맷(웹·iOS 공용): { points: [[lng,lat,고도m|null,unix초]...](최대 2000점, 균등 솎음),
--   elev: {min,max,ascent,descent}(고도 샘플 충분할 때만),
--   meta: 진단 요약(2026-07-29 추가, iOS 만 기록 — 없는 기록은 키 자체가 없다) }
-- meta 포맷: { v:2, bat_start, bat_end(0~100·-1=미측정), low_power, charged,
--   gps_mode("Best"|"10m"|"100m"), fixes, fixes_dropped(정확도 게이트 탈락 수), acc_avg(m·-1=표본없음),
--   device("iPhone14,2"), os("26.0"), build(CFBundleVersion),   ← v2 에서 추가(2026-07-30)
--   lpm(세션 중 1회라도 저전력모드), fg_s/bg_s(전경·배경 누적 초) }  ← v3 에서 추가(2026-07-31, IOS.md §7-4)
--   bat_mode("normal"|"saver"|"max") }  ← v4 에서 추가(2026-08-02, IOS.md §7-5 등반 배터리 모드)
--   v1 에는 device/os/build 가, v2 에는 lpm/fg_s/bg_s 가, v3 에는 bat_mode 가 없다.
--   소비 측은 키 없음을 허용할 것.
--   ⚠️ bat_mode 는 **등반 시작 시점**의 설정값으로 고정된다(중간에 바꿔도 그 세션은 그대로) —
--   한 세션이 한 모드로 측정돼야 모드별 %/h 비교가 성립하기 때문.
--   어느 모드든 GPS 기록은 1Hz 로 동일하다. 절전은 화면 갱신만 스로틀한다(트랙 무손실).
--   ⚠️ low_power 는 **시작 시점** 값이고 lpm 은 **세션 중 1회라도**다 — 잔량이 떨어져 중간에
--   켜지는 경우가 많아 둘을 나눠 둔다. fg_s/bg_s 는 소모에서 화면 기여분과 순수 GPS
--   기여분을 분리하려고 넣었다(§7-4: 11.1%/h 측정이 예산의 1.8배였으나 원인을 못 갈랐다).
--   ⚠️ track 은 points 가 2개 미만이어도 **meta 가 있으면 저장된다**(2026-07-30) —
--   진단은 트랙과 독립이고, "GPS 를 거의 못 받았다"가 오히려 중요한 진단이기 때문.
--   따라서 points: [] 인 행이 있을 수 있다. 소비 측은 length >= 2 를 확인할 것.
--   목적: 백그라운드 GPS 의 시간당 배터리 소모를 기기·정확도 설정별로 비교(관리자 콘솔 "등반 기록" 탭).
--   ⚠️ bat_* 는 기기 전체 소모다 — 앱별 소비 전력 API 는 iOS 에 없다. charged=true 면 소모량 무의미.
-- 구형 기록은 points 가 [lng,lat,unix초] 3원소 — 소비 측에서 길이로 구분.
-- 원본 고해상 트랙은 클라우드에 올리지 않는다(iOS: 기기 로컬 GPX 보관, 여기엔 단순화본).
--
-- 관리자 열람: RLS 는 본인 기록만(own_records) 그대로 둔다. 관리자 콘솔은 admin_server.py 의
-- /api/records 가 service_role 키로 조회하므로 정책 추가가 필요 없다 — 브라우저에 service_role
-- 키가 노출되지 않고, 사용자 트랙 열람 권한이 상시 열려 있지도 않다(2026-07-29 결정).
create table if not exists climb_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  mountain_id text,
  course_name text,
  started_at timestamptz,
  ended_at timestamptz,
  distance_km real,
  ascent_m int,
  duration_s int,
  track jsonb,
  created_at timestamptz default now()
);
alter table climb_records enable row level security;
drop policy if exists own_records on climb_records;
create policy own_records on climb_records for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- saved_packs: 저장(다운로드)한 산
create table if not exists saved_packs (
  user_id uuid references auth.users on delete cascade,
  mountain_id text,
  pack_version int,
  downloaded_at timestamptz default now(),
  primary key (user_id, mountain_id)
);
alter table saved_packs enable row level security;
drop policy if exists own_packs on saved_packs;
create policy own_packs on saved_packs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- mountain_info: 전국 산정보 원본 (산림청 항공본부 mnt.xlsx, 공개 읽기)
-- mountains(팩 카탈로그)와 별도 — 산코드(code)로 조인. 시드: scripts/seed_mountain_info.py
create table if not exists mountain_info (
  code text primary key,
  name text,
  region text,
  elev real,
  manager text,
  manager_tel text,
  description text,
  data_date date,
  created_at timestamptz default now()
);
alter table mountain_info enable row level security;
drop policy if exists mountain_info_read on mountain_info;
create policy mountain_info_read on mountain_info for select using (true);

-- 팩 파일(base.pmtiles·routes/spots/contours.geojson) + 기저 타일은 Cloudflare R2 에
-- 자체 호스팅한다(egress 무료). Supabase Storage 는 사용하지 않음 → 버킷 생성 불필요.
-- R2 구축·이관 절차: CLOUDFLARE.md 참고.
