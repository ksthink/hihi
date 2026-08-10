// Vercel 서버리스 함수 — 에어코리아 대기질 프록시 (CORS 회피 + 키 서버측 은닉).
// 환경변수: KMA_KEY(또는 KNPS_KEY) — 기상청과 **같은 data.go.kr 인증키**를 쓴다
//   (계정 하나에 서비스별 활용신청만 추가하면 되므로 새 변수가 필요 없다).
//   필요한 활용신청: 에어코리아_대기오염정보 + 에어코리아_측정소정보.
//
// 요청:  /api/air?lat=37.55&lon=126.72&region=인천 계양
// 응답:  { pm10, pm25, pm10Grade, pm25Grade, station, addr, distanceKm, observedAt, tomorrow }
//        측정소가 없거나 너무 멀면 { station: null } — 소비 측은 줄을 감춘다.
//
// ⚠️ **수치 예보는 존재하지 않는다.** 에어코리아가 주는 것은 두 가지다:
//    · 실황 — 측정소별 PM10/PM2.5 **수치**(㎍/㎥), 1시간 주기
//    · 예보 — 권역별 **일 단위 등급**(좋음·보통·나쁨·매우나쁨), 하루 4회 발표
//    네이버의 "시간별 예보"는 케이웨더(민간 유료) 자료다. 무료 범위만 쓰므로 시간 칸을
//    만들지 않는다 — 하루 한 값을 여러 칸에 복제하면 없는 정보를 있는 것처럼 보이게 한다.
//
// 최근접 측정소 계산을 **서버에서** 하는 이유: 측정소 이름 규칙이 지역마다 달라
// (서울은 "강북구", 인천·경기는 "계산"·"소사본동" 같은 동 단위) 이름 매칭이 불가능하다.
// 좌표로 고르면 규칙이 필요 없고, 웹·iOS 가 같은 답을 본다.
const BASE = "https://apis.data.go.kr/B552584";
const MAX_KM = 30;          // 이보다 먼 측정소는 "이 산의 대기질"로 볼 수 없다 → 표시하지 않음

// 측정소 목록(673개·좌표 포함)은 거의 바뀌지 않으므로 **파일로 굽는다**(scripts/build_stations.py).
// 매 cold start 마다 800건을 외부에서 받아오면, 그 한 번의 실패가 곧바로 `{station:null}` 이 되고
// 그게 캐시되면 그 사이 모두가 빈 화면을 본다(2026-08-10 실제 — 웹은 나오는데 앱만 비었다).
// API 조회는 이제 **갱신용**이다: 성공하면 최신으로 덮고, 실패하면 구운 목록이 그대로 답한다.
const BUNDLED = require("./_stations.json");
let stationCache = { at: 0, list: null };
// 예보도 캐시한다 — 하루 4회 발표라 자주 부를 이유가 없고, 무엇보다 **간헐 실패를 흡수**한다.
// 한 번 실패한 응답이 CDN 에 30분 붙잡히면 그동안 모두가 등급 없는 화면을 본다(2026-08-10 실제).
let fcstCache = { at: 0, day: null, items: null };
// 주간예보는 **초미세먼지(PM2.5)** 기준이고 하루 1회만 발표된다. 일별과 항목도 척도도 다르다
// (일별 좋음·보통·나쁨·매우나쁨 / 주간 낮음·높음) — 섞어 쓰지 않고 각각 그대로 표기한다.
let weekCache = { at: 0, items: null };

const num = (v) => {
  const n = parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) ? n : null;
};

// 경기·강원은 예보에서만 갈린다(실황 sidoName 은 "경기"·"강원").
const GYEONGGI_NORTH = new Set(
  ["고양", "파주", "의정부", "양주", "동두천", "연천", "포천", "가평", "남양주", "구리"]);
const GANGWON_EAST = new Set(["강릉", "동해", "속초", "삼척", "태백", "양양", "고성"]);

function forecastRegion(region) {
  const [sido, city = ""] = String(region || "").trim().split(/\s+/);
  if (!sido) return null;
  if (sido === "경기") return GYEONGGI_NORTH.has(city) ? "경기북부" : "경기남부";
  if (sido === "강원") return GANGWON_EAST.has(city) ? "영동" : "영서";
  return sido;
}

// ⚠️ 두 예보의 권역명이 다르다 — 일별은 `영동`·`영서`, 주간은 `강원영동`·`강원영서`.
//    나머지 권역은 같다. 이름 하나 차이로 강원 사용자만 주간이 통째로 비게 된다.
const weekRegion = (reg) => (reg === "영동" || reg === "영서" ? `강원${reg}` : reg);

// "서울 : 좋음,인천 : 보통" 또는 "서울 : 낮음, 인천 : 낮음" — 두 예보가 같은 형식이다.
function pickRegion(text, reg) {
  if (!reg) return null;
  for (const part of String(text || "").split(",")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === reg) return part.slice(i + 1).trim();
  }
  return null;
}

const kstDate = (offsetDays = 0) =>
  new Date(Date.now() + 9 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10);

// 평면 근사(위도 보정) — 수십 km 범위라 구면 공식과 차이가 무시할 수준이다.
function km(aLat, aLon, bLat, bLon) {
  const dx = (bLon - aLon) * 111.32 * Math.cos((aLat * Math.PI) / 180);
  const dy = (bLat - aLat) * 111.32;
  return Math.hypot(dx, dy);
}

async function callApi(svc, op, sk, params) {
  const q = new URLSearchParams({ returnType: "json", pageNo: "1", ...params });
  const r = await fetch(`${BASE}/${svc}/${op}?serviceKey=${sk}&${q}`, {
    headers: { "User-Agent": "hiheight/1.0" },
  });
  const j = await r.json();
  return j?.response?.body?.items || [];
}

async function stations(sk) {
  if (stationCache.list && Date.now() - stationCache.at < 86400000) return stationCache.list;
  try {
    const items = await callApi("MsrstnInfoInqireSvc", "getMsrstnList", sk, { numOfRows: "800" });
    const list = items
      .map((s) => ({
        name: s.stationName,
        addr: s.addr,
        lat: parseFloat(s.dmX),
        lon: parseFloat(s.dmY),
      }))
      .filter((s) => s.name && Number.isFinite(s.lat) && Number.isFinite(s.lon));
    if (list.length) {
      stationCache = { at: Date.now(), list };
      return list;
    }
  } catch (_) { /* 아래 폴백 */ }
  return stationCache.list || BUNDLED;   // 신설·폐지는 드물다 — 비는 것보다 조금 낡은 게 낫다
}

async function forecast(sk) {
  const day = kstDate(0);
  if (fcstCache.items && fcstCache.day === day && Date.now() - fcstCache.at < 1800000)
    return fcstCache.items;
  try {
    const items = await callApi("ArpltnInforInqireSvc", "getMinuDustFrcstDspth", sk, {
      numOfRows: "20", searchDate: day, InformCode: "PM10",
    });
    if (items.length) {
      fcstCache = { at: Date.now(), day, items };
      return items;
    }
  } catch (_) { /* 아래 폴백 */ }
  // 실패하면 오늘자 직전 성공분을 쓴다(없으면 빈 배열 — 등급만 비고 수치는 나온다).
  return fcstCache.day === day ? (fcstCache.items || []) : [];
}

// 주간(초미세먼지) 예보 — 최근 **2회 발표**를 받는다.
// 오늘자 발표가 아직 안 뜬 시간대가 있고(오전), 새 발표는 하루씩 뒤로 밀려 앞날이 빠진다.
// 두 회차를 겹쳐 놓으면 그 구멍이 메워진다.
//
// ⚠️ `searchDate` 없이 부르면 **발표일 목록만** 온다(`presnatnDt` 한 필드뿐, 내용 없음).
//    그래서 목록을 먼저 받아 최신 두 날짜를 얻고, 그 날짜로 다시 부른다. 6시간 캐시라
//    호출이 늘어나는 부담은 없다.
async function weekForecast(sk) {
  if (weekCache.items && Date.now() - weekCache.at < 21600000) return weekCache.items;
  try {
    const dates = (await callApi("ArpltnInforInqireSvc", "getMinuDustWeekFrcstDspth", sk,
                                 { numOfRows: "5" }))
      .map((x) => x.presnatnDt).filter(Boolean).slice(0, 2);
    const items = (await Promise.all(dates.map((d) =>
      callApi("ArpltnInforInqireSvc", "getMinuDustWeekFrcstDspth", sk,
              { numOfRows: "1", searchDate: d }).catch(() => [])))).flat();
    if (items.length) { weekCache = { at: Date.now(), items }; return items; }
  } catch (_) { /* 아래 폴백 */ }
  return weekCache.items || [];
}

module.exports = async function handler(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const region = req.query.region || "";
  if (!Number.isFinite(lat) || !Number.isFinite(lon))
    return res.status(400).json({ error: "lat/lon required" });

  const key = process.env.KMA_KEY || process.env.KNPS_KEY;
  if (!key) return res.status(500).json({ error: "no KMA_KEY" });
  // 인코딩된 키(%2F 포함)면 그대로, 디코딩 키면 인코딩해서 붙임 (weather.js 와 동일 규칙)
  const sk = /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);

  res.setHeader("Content-Type", "application/json; charset=utf-8");

  try {
    const list = await stations(sk);
    let best = null;
    for (const s of list) {
      const d = km(lat, lon, s.lat, s.lon);
      if (!best || d < best.d) best = { s, d };
    }
    // 너무 멀면 값을 주지 않는다 — 없는 것보다 틀린 게 나쁘다.
    if (!best || best.d > MAX_KM) {
      res.setHeader("Cache-Control", "public, max-age=600, s-maxage=600");
      return res.status(200).json({ station: null });
    }

    const [now, fcst, week] = await Promise.all([
      callApi("ArpltnInforInqireSvc", "getMsrstnAcctoRltmMesureDnsty", sk, {
        numOfRows: "1", stationName: best.s.name, dataTerm: "DAILY", ver: "1.0",
      }).catch(() => []),
      forecast(sk),
      weekForecast(sk),
    ]);

    const n = now[0] || {};
    // 권역별 등급을 날짜별로 뽑는다 — 오늘은 날씨 칩(오늘 시간대), 내일은 자정 넘어가는 칩에 붙인다.
    // ⚠️ **일 단위 값이다.** 칩마다 다른 값이 아니라 하루 한 값을 그 날 칸에 채우는 것뿐이다.
    const reg = forecastRegion(region);
    const gradeOn = (dateStr) => {
      if (!reg) return null;
      const cand = fcst.filter((x) => x.informData === dateStr && x.informCode === "PM10");
      const latest = cand[cand.length - 1] || cand[0];
      return latest ? pickRegion(latest.informGrade, reg) : null;
    };
    const today = gradeOn(kstDate(0));
    const tomorrow = gradeOn(kstDate(1));

    // 예보 한 줄 — 일별(오늘·내일) 뒤에 주간(모레 이후)을 이어붙인다.
    // ⚠️ **같은 값이 아니다.** 앞은 미세먼지 등급, 뒤는 초미세먼지 주간전망(낮음·높음)이라
    //    소비 측이 `scale` 로 구분해 표기한다. 임의로 한 척도에 맞추지 않는다 — 원본이 다르다.
    const daily = [kstDate(0), kstDate(1)]
      .map((d) => ({ date: d, grade: gradeOn(d), scale: "daily" }))
      .filter((x) => x.grade);
    const wreg = weekRegion(reg);
    const wmap = new Map();
    for (const it of [...week].reverse())      // 오래된 발표부터 넣어 최신이 덮게
      for (const n of ["One", "Two", "Three", "Four"]) {
        const d = it[`frcst${n}Dt`], g = pickRegion(it[`frcst${n}Cn`], wreg);
        if (d && g) wmap.set(d, g);
      }
    const lastDaily = daily.length ? daily[daily.length - 1].date : kstDate(0);
    const weekly = [...wmap.entries()]
      .filter(([d]) => d > lastDaily)          // 일별이 이미 말한 날은 겹치지 않게
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, grade]) => ({ date, grade, scale: "weekly" }));

    // ⚠️ 캐시 수명은 **응답이 온전한지 보고** 정한다. 등급이 비어 있는데도 30분을 캐시하면
    //    그 사이 모든 요청이 같은 반쪽 응답을 받는다(2026-08-10: 칩 등급이 통째로 비었다).
    //    실황·예보는 1시간·하루 단위로만 바뀌므로 온전할 때만 길게 잡는다.
    const complete = (today != null || tomorrow != null) && num(n.pm10Value) != null;
    res.setHeader("Cache-Control", complete
      ? "public, max-age=900, s-maxage=1800, stale-while-revalidate=7200"
      : "public, max-age=60, s-maxage=60");

    return res.status(200).json({
      pm10: num(n.pm10Value),
      pm25: num(n.pm25Value),
      pm10Grade: num(n.pm10Grade),
      pm25Grade: num(n.pm25Grade),
      station: best.s.name,
      addr: best.s.addr || null,
      distanceKm: Math.round(best.d * 10) / 10,
      stationLat: best.s.lat,     // 지도에 찍기 위한 좌표 — "이 값이 어디서 왔나"를 보여준다
      stationLon: best.s.lon,
      observedAt: n.dataTime || null,
      today,
      tomorrow,
      forecast: [...daily, ...weekly],
    });
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }
};
