// Vercel 서버리스 함수 — 기상청 단기예보 프록시 (CORS 회피 + 키 서버측 은닉).
// 환경변수: KMA_KEY(또는 KNPS_KEY) = data.go.kr 디코딩 인증키.
// 요청: /api/weather?op=ufcst|vfcst|ncst&nx=&ny=&base_date=&base_time=
const OPS = { ncst: "getUltraSrtNcst", ufcst: "getUltraSrtFcst", vfcst: "getVilageFcst" };
const BASE = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0";

module.exports = async function handler(req, res) {
  const { op, nx, ny, base_date, base_time } = req.query;
  const path = OPS[op];
  if (!path || !nx || !ny || !base_date || !base_time)
    return res.status(400).json({ error: "bad params" });
  const key = process.env.KMA_KEY || process.env.KNPS_KEY;
  if (!key) return res.status(500).json({ error: "no KMA_KEY" });

  const q = new URLSearchParams({ dataType: "JSON", numOfRows: "300", pageNo: "1", base_date, base_time, nx, ny });
  // 인코딩된 키(%2F 포함)면 그대로, 디코딩 키면 인코딩해서 붙임
  const sk = /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);
  const url = `${BASE}/${path}?serviceKey=${sk}&${q}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "hiheight/1.0" } });
    const body = await r.text();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    // 응답은 base_date/base_time 이 URL 에 박혀 있어 **불변**이다(기상청은 같은 발표시각을
    // 다시 발표하지 않는다). 600초는 지나치게 짧아 발표 주기(초단기 1h·단기 3h) 안에서도
    // 캐시가 만료돼 원본을 다시 쳤고, 그때마다 사용자가 2초 넘게 기다렸다(2026-07-29 실측
    // vfcst 캐시미스 2.24s vs 적중 0.05s).
    //   max-age(브라우저·URLSession) 30분 — 앱 내 재진입은 네트워크 없이 즉시
    //   s-maxage(CDN) 6시간 — 발표 주기를 덮어 미스가 사실상 사라짐
    //   stale-while-revalidate — 만료 후에도 즉시 응답하고 갱신은 뒤에서(대기 시간 노출 없음)
    res.setHeader("Cache-Control",
      "public, max-age=1800, s-maxage=21600, stale-while-revalidate=86400");
    return res.status(r.status).send(body);
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }
}
