// Vercel 서버리스 — 기저 타일 프록시(자체 호스팅 Cloudflare R2 → same-origin Range 전달).
// 배경: demo-bucket.protomaps.com/v4.pmtiles(고정 파일) 2026-07 삭제 → 한국 영역 base 를
//   R2 로 자체 호스팅(egress 무료). 이 함수는 웹 전용 same-origin 계층(CORS 회피)이며
//   Cache-Control 로 Vercel CDN 이 타일 range 응답을 캐시 → 함수 호출/전송 최소화.
//   iOS 네이티브는 로컬 번들 range 접근이라 이 계층 불필요(폐기 대상).
// 앱은 /pmtiles/<파일명> 을 이 함수로 rewrite(vercel.json, ?f=파일명) → 허용 목록 파일명만
// 해당 R2 객체로, 그 외(레거시 v4.pmtiles 등)는 base 로 폴백.
const R2_PUB = process.env.R2_PUB || "https://pub-cfc2302f77a446c1a0fdff6d0ae4e451.r2.dev";
const PMTILES_FILES = new Set(["kr-base.pmtiles", "kr-terrain.pmtiles", "kr-bus.pmtiles"]);
const PMTILES_URL = process.env.PMTILES_URL || `${R2_PUB}/kr-base.pmtiles`;

module.exports = async function handler(req, res) {
  const headers = { "User-Agent": "hiheight/1.0" }; // R2 pub.r2.dev 는 기본 UA 를 403 차단
  if (req.headers.range) headers.Range = req.headers.range;
  if (req.headers["if-match"]) headers["If-Match"] = req.headers["if-match"];
  if (req.headers["if-none-match"]) headers["If-None-Match"] = req.headers["if-none-match"];
  const name = String(req.query?.f || (req.url || "").split("?")[0].split("/").pop() || "");
  const url = PMTILES_FILES.has(name) ? `${R2_PUB}/${name}` : PMTILES_URL;
  try {
    const r = await fetch(url, { headers });
    res.status(r.status);
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const v = r.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader("Access-Control-Expose-Headers", "ETag, Content-Range, Accept-Ranges, Content-Length");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800, immutable"); // CDN 캐시(타일 불변)
    if (req.method === "HEAD") return res.end();
    return res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }
};
