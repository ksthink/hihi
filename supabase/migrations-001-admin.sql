-- 관리자 콘솔 도입: mountains 카탈로그 확장 (Supabase SQL Editor 에 1회 실행)
-- 큰따옴표 미사용 (스마트따옴표 변환 사고 방지)

alter table mountains add column if not exists sort_order int default 100;
alter table mountains add column if not exists published boolean default true;
alter table mountains add column if not exists famous boolean default false;
alter table mountains add column if not exists updated_at timestamptz default now();

-- 기존 3산: 정렬·명산 플래그 시드
update mountains set sort_order = 1, famous = true where id = '113050202';
update mountains set sort_order = 2, famous = true where id = '428302602';
update mountains set sort_order = 3, famous = true where id = '412900401';

-- 읽기 정책: 공개(published) 산만 anon 에 노출
drop policy if exists mountains_read on mountains;
create policy mountains_read on mountains for select using (published);
