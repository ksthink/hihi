-- 공식 추천 카테고리: mountains.lists (Supabase SQL Editor 에 1회 실행)
-- 값: 문자열 배열 jsonb — 'bac100'(블랙야크 명산100), 'knps'(국립공원공단 공식탐방로)
-- 대한민국(산림청) 100대 명산은 기존 famous 컬럼 그대로 사용.
-- 큰따옴표 미사용 (스마트따옴표 변환 사고 방지)

alter table mountains add column if not exists lists jsonb default '[]'::jsonb;
