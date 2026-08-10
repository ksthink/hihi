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

/** "2026-08-12" → 오늘·내일이면 그 말로, 아니면 "8.12(수)".
 *  ⚠️ 날짜를 **순수 날짜로** 다룬다(`Date.UTC`). `T00:00:00+09:00` 로 파싱하고 `getUTC*` 를
 *     읽으면 하루가 밀린다 — 그 순간은 UTC 로 전날 15시이기 때문이다. */
function dayLabel(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const at = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const t = kstDay(0);   // "YYYYMMDD" — 한국 기준 오늘
  const today = Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8));
  const diff = Math.round((at - today) / 86400000);
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  const wd = ["일", "월", "화", "수", "목", "금", "토"][new Date(at).getUTCDay()];
  return `${+m[2]}.${+m[3]}(${wd})`;
}

/** 측정소 팝업 내용 — 수치는 등급과 함께 보여야 뜻이 통한다(16 이 좋은 건지 알 수 없다).
 *  예보는 **가로로 넘겨 본다** — 6일을 세로로 쌓으면 팝업이 지도를 덮는다. */
export function stationPopupHTML(a) {
  const row = (label, v, g) =>
    v == null ? "" : `<br>${label} ${v} ㎍/㎥${GRADE[g] ? ` · ${GRADE[g]}` : ""}`;
  const meta = [
    a.addr || "",
    a.distanceKm != null ? `산에서 ${a.distanceKm}km` : "",
  ].filter(Boolean).join("<br>");

  const fc = Array.isArray(a.forecast) ? a.forecast : [];
  const hasWeekly = fc.some((f) => f.scale === "weekly");
  // 앞뒤가 다른 자료다 — 앞은 미세먼지 등급, 뒤는 초미세먼지 주간전망(낮음·높음).
  // 같은 줄에 있으면 같은 척도로 읽히므로 점선 테두리와 주석으로 구분한다.
  const days = fc.map((f) =>
    `<div class="air-day${f.scale === "weekly" ? " is-week" : ""}">
       <span>${dayLabel(f.date)}</span><b>${f.grade}</b></div>`).join("");
  const forecast = fc.length
    ? `<div class="air-fc-title">예보</div><div class="air-fc">${days}</div>
       <div class="air-fc-note">${hasWeekly
         ? "오늘·내일은 미세먼지 등급, 모레부터는 초미세먼지 주간전망(낮음·높음)입니다."
         : "권역 단위 하루 한 값입니다(에어코리아)."}</div>`
    : "";

  return `<div class="popup-title">${a.station} 측정소</div>
    <div class="popup-meta">${meta}${row("미세", a.pm10, a.pm10Grade)}${
      row("초미세", a.pm25, a.pm25Grade)}${
      a.observedAt ? `<br>${a.observedAt} 관측` : ""}</div>${forecast}`;
}
