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
--   elev: {min,max,ascent,descent}(고도 샘플 충분할 때만) }
-- 구형 기록은 points 가 [lng,lat,unix초] 3원소 — 소비 측에서 길이로 구분.
-- 원본 고해상 트랙은 클라우드에 올리지 않는다(iOS: 기기 로컬 GPX 보관, 여기엔 단순화본).
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
