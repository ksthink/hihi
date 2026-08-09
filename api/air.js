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

// 측정소 목록(673개·좌표 포함)은 거의 바뀌지 않는다. warm 인스턴스에서 재사용한다.
let stationCache = { at: 0, list: null };

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
  const items = await callApi("MsrstnInfoInqireSvc", "getMsrstnList", sk, { numOfRows: "800" });
  const list = items
    .map((s) => ({
      name: s.stationName,
      addr: s.addr,
      lat: parseFloat(s.dmX),
      lon: parseFloat(s.dmY),
    }))
    .filter((s) => s.name && Number.isFinite(s.lat) && Number.isFinite(s.lon));
  if (list.length) stationCache = { at: Date.now(), list };
  return list;
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

  // 실황·예보는 1시간·하루 단위로만 바뀐다. stale-while-revalidate 로 만료 후에도 즉시
  // 응답하고 갱신은 뒤에서 — 대기 시간을 사용자에게 노출하지 않는다.
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control",
    "public, max-age=900, s-maxage=1800, stale-while-revalidate=7200");

  try {
    const list = await stations(sk);
    let best = null;
    for (const s of list) {
      const d = km(lat, lon, s.lat, s.lon);
      if (!best || d < best.d) best = { s, d };
    }
    // 너무 멀면 값을 주지 않는다 — 없는 것보다 틀린 게 나쁘다.
    if (!best || best.d > MAX_KM) return res.status(200).json({ station: null });

    const [now, fcst] = await Promise.all([
      callApi("ArpltnInforInqireSvc", "getMsrstnAcctoRltmMesureDnsty", sk, {
        numOfRows: "1", stationName: best.s.name, dataTerm: "DAILY", ver: "1.0",
      }).catch(() => []),
      callApi("ArpltnInforInqireSvc", "getMinuDustFrcstDspth", sk, {
        numOfRows: "20", searchDate: kstDate(0), InformCode: "PM10",
      }).catch(() => []),
    ]);

    const n = now[0] || {};
    // 내일자 PM10 중 가장 최근 발표에서 우리 권역만 뽑는다.
    const want = kstDate(1);
    const reg = forecastRegion(region);
    const cand = fcst.filter((x) => x.informData === want && x.informCode === "PM10");
    const latest = cand[cand.length - 1] || cand[0];
    let tomorrow = null;
    if (latest && reg) {
      for (const part of String(latest.informGrade || "").split(",")) {
        const [k, v] = part.split(":").map((t) => t.trim());
        if (k === reg) { tomorrow = v; break; }
      }
    }

    return res.status(200).json({
      pm10: num(n.pm10Value),
      pm25: num(n.pm25Value),
      pm10Grade: num(n.pm10Grade),
      pm25Grade: num(n.pm25Grade),
      station: best.s.name,
      addr: best.s.addr || null,
      distanceKm: Math.round(best.d * 10) / 10,
      observedAt: n.dataTime || null,
      tomorrow,
    });
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }
};
