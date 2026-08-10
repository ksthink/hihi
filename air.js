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
  // ⚠️ 실황(수치)과 예보(등급)는 **서로 다른 API 다.** 한쪽이 죽었다고 다른 쪽까지 버리면
  // 멀쩡한 값이 있는데도 화면이 빈다 — 실제로 실황만 504 인 시간대가 있었다(2026-08-10).
  if (!a || (a.pm10 == null && a.pm25 == null && !a.today && !a.tomorrow)) return null;
  return a;
}

const kstDay = (offsetDays = 0) =>
  new Date(Date.now() + 9 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10).replace(/-/g, "");

/** 날씨 칩에 얹을 등급 함수 — 그 칸의 **날짜**에 해당하는 값(같은 날은 같은 값). */
export function airGradeFn(a) {
  if (!a) return () => null;
  const today = kstDay(0), tomorrow = kstDay(1);
  return (h) => {
    const day = String(h?.key || "").slice(0, 8);   // key = "YYYYMMDDHHMM"
    if (day === today) return a.today || null;
    if (day === tomorrow) return a.tomorrow || null;
    return null;
  };
}

/** 캡션 한 줄 — 수치·측정소·거리. 칩에 숫자까지 넣으면 폭이 늘고 기온과 뒤섞인다.
 *  수치가 없으면(실황 API 만 죽은 경우) 빈 문자열 — "미세먼지 · ○○ 측정소" 만 남으면
 *  무엇을 말하는 줄인지 알 수 없다. 칩의 등급은 그대로 나온다.
 *
 *  측정소 이름은 **누를 수 있다**(좌표가 온 경우) — 지도의 그 자리로 데려간다.
 *  값이 어디서 왔는지는 산에서 20km 떨어진 측정소일 수도 있어 거리만으론 부족하다. */
export function airNote(a) {
  if (!a || (a.pm10 == null && a.pm25 == null)) return "";
  let s = "미세먼지";
  if (a.pm10 != null) s += ` 미세 ${a.pm10}`;
  if (a.pm25 != null) s += ` · 초미세 ${a.pm25}`;
  if (a.station) {
    const label = `${a.station} 측정소${a.distanceKm != null ? ` ${a.distanceKm}km` : ""}`;
    s += " · " + (hasStationPos(a)
      ? `<button type="button" class="wx-stn" data-air-station>${label}</button>`
      : label);
  }
  return s + " (등급은 하루 기준)";
}

/** 지도에 찍을 수 있는가 — 옛 응답에는 좌표가 없다. */
export function hasStationPos(a) {
  return !!a && Number.isFinite(a.stationLat) && Number.isFinite(a.stationLon);
}

/** 측정소 팝업 내용 — 수치는 등급과 함께 보여야 뜻이 통한다(16 이 좋은 건지 알 수 없다). */
export function stationPopupHTML(a) {
  const row = (label, v, g) =>
    v == null ? "" : `<br>${label} ${v} ㎍/㎥${GRADE[g] ? ` · ${GRADE[g]}` : ""}`;
  const meta = [
    a.addr || "",
    a.distanceKm != null ? `산에서 ${a.distanceKm}km` : "",
  ].filter(Boolean).join("<br>");
  return `<div class="popup-title">${a.station} 측정소</div>
    <div class="popup-meta">${meta}${row("미세", a.pm10, a.pm10Grade)}${
      row("초미세", a.pm25, a.pm25Grade)}${
      a.observedAt ? `<br>${a.observedAt} 관측` : ""}${
      a.today ? `<br>오늘 예보 ${a.today}${a.tomorrow ? ` · 내일 ${a.tomorrow}` : ""}` : ""}</div>`;
}
