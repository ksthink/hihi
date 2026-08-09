// 대기질(미세먼지) — /api/air 프록시 소비. iOS AirQuality.swift 와 같은 계약.
//
// ⚠️ **수치 예보는 존재하지 않는다.** 에어코리아가 주는 것은 두 가지다:
//    · 실황 — 측정소별 PM10/PM2.5 **수치**(㎍/㎥), 1시간 주기
//    · 예보 — 권역별 **일 단위 등급**(좋음·보통·나쁨·매우나쁨), 하루 4회 발표
//    네이버의 "시간별 예보"는 케이웨더(민간 유료) 자료다. 무료 범위만 쓰므로 날씨처럼
//    시간 칸을 만들지 않는다 — 하루 한 값을 여러 칸에 복제하면 없는 정보를 있는 것처럼 보인다.
//
// 최근접 측정소 선택·권역 판정은 **서버(api/air.js)가 한다.** 측정소 이름 규칙이 지역마다
// 달라(서울은 "강북구", 인천·경기는 "계산"·"소사본동" 같은 동 단위) 이름으로는 못 고른다.

const GRADE = { 1: "좋음", 2: "보통", 3: "나쁨", 4: "매우나쁨" };

/** 산 좌표에서 가장 가까운 측정소의 실황 + 내일 등급. 없거나 실패하면 null. */
export async function fetchAir(lat, lon, region) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const q = new URLSearchParams({ lat, lon, region: region || "" });
  const r = await fetch(`/api/air?${q}`);
  if (!r.ok) return null;
  const a = await r.json();
  // station 이 없으면 쓸 값이 없다(너무 멀거나 조회 실패) — 줄 자체를 감춘다.
  if (!a || !a.station || (a.pm10 == null && a.pm25 == null)) return null;
  return a;
}

/** 한 줄 렌더 — 실황 수치(+등급) · 내일 등급 · 측정소/출처. */
export function renderAir(el, a) {
  if (!el) return;
  if (!a) { el.hidden = true; el.innerHTML = ""; return; }
  const chip = (label, value, grade) =>
    `<span class="air-chip"><i>${label}</i><b>${value ?? "–"}</b>${
      GRADE[grade] ? `<em>${GRADE[grade]}</em>` : ""}</span>`;
  // 측정소명·거리를 함께 적는 이유 — 산이 아니라 **도심 측정값**이라 사용자가 감안할 수 있어야 한다.
  const where = a.distanceKm != null ? `${a.station} 측정소 ${a.distanceKm}km` : `${a.station} 측정소`;
  const meta = [where, a.observedAt, "한국환경공단 에어코리아"].filter(Boolean).join(" · ");
  el.innerHTML =
    `<div class="air-row">${chip("미세", a.pm10, a.pm10Grade)}${chip("초미세", a.pm25, a.pm25Grade)}` +
    `${a.tomorrow ? `<span class="air-tomorrow">내일 ${a.tomorrow}</span>` : ""}</div>` +
    `<div class="air-meta">${meta}</div>`;
  el.hidden = false;
}
