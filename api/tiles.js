// Vercel 서버리스 — Protomaps 기저 타일 프록시 (Range 전달 + 최신 빌드 자동 탐지).
// 배경: 과거 demo-bucket.protomaps.com/v4.pmtiles(고정 파일)가 2026-07 삭제됨.
//   → build.protomaps.com 의 날짜별 빌드(<YYYYMMDD>.pmtiles, 약 1주 보관)를 자동 탐지해 사용.
//   → 로테이션돼도 다음 요청에서 최신본으로 자동 전환(주간 breakage 없음).
// build.protomaps.com 은 기본 UA 를 403 차단 → "hiheight/1.0" UA 필수.
// 앱은 /pmtiles/* 를 이 함수로 rewrite(vercel.json) → 요청 파일명 무시, 항상 최신 빌드.
const HOST = process.env.PMTILES_BUILD_HOST || "https://build.protomaps.com/";
const UA = "hiheight/1.0";
let cached = { file: null, at: 0 };
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");

async function resolveBuild() {
  const now = Date.now();
  if (cached.file && now - cached.at < 3600_000) return cached.file; // 1시간 캐시
  const base = new Date();
  for (let i = 0; i < 15; i++) {
    const fn = ymd(new Date(base.getTime() - i * 86400000)) + ".pmtiles";
    try {
      const r = await fetch(HOST + fn, { headers: { "User-Agent": UA, Range: "bytes=0-0" } });
      if (r.status === 206 || r.ok) { cached = { file: fn, at: now }; return fn; }
    } catch (_) { /* 다음 날짜 */ }
  }
  cached = { file: ymd(base) + ".pmtiles", at: now }; // 폴백
  return cached.file;
}

module.exports = async function handler(req, res) {
  let build = await resolveBuild();
  const headers = { "User-Agent": UA };
  if (req.headers.range) headers.Range = req.headers.range;
  if (req.headers["if-match"]) headers["If-Match"] = req.headers["if-match"];
  if (req.headers["if-none-match"]) headers["If-None-Match"] = req.headers["if-none-match"];
  const pass = (r) => {
    res.status(r.status);
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const v = r.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader("Access-Control-Expose-Headers", "ETag, Content-Range, Accept-Ranges, Content-Length");
  };
  try {
    let r = await fetch(HOST + build, { headers });
    if (r.status === 404) { // 빌드 로테이션됨 → 캐시 무효화 후 재탐지·1회 재시도
      cached = { file: null, at: 0 };
      build = await resolveBuild();
      r = await fetch(HOST + build, { headers });
    }
    pass(r);
    if (req.method === "HEAD") return res.end();
    return res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }
};
