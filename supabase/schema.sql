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
  created_at timestamptz default now()
);
alter table mountains enable row level security;
drop policy if exists mountains_read on mountains;
create policy mountains_read on mountains for select using (true);

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

-- climb_records: 등반 기록 (track 은 GPS 좌표열, 웹 단계엔 null)
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

-- Storage 버킷 (공개 읽기). SQL Editor 에서 권한으로 막히면 이 3줄만 빼고 실행 후
-- 대시보드 Storage 에서 packs 버킷(Public)을 수동 생성한다.
insert into storage.buckets (id, name, public)
values ('packs', 'packs', true)
on conflict (id) do nothing;
