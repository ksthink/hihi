// 기저지도 POI 아이콘 — 외부 스프라이트/CDN 없이 캔버스로 즉석 생성.
// 웹앱(app.js)과 관리자 콘솔(admin/admin.js)이 같은 것을 쓴다.
//   ⚠️ 예전엔 app.js 안에만 있어서 관리자 지도에는 아이콘이 통째로 안 나왔다.
//      "기호" 체크를 켜도 아무 변화가 없어 설정이 반영 안 되는 것처럼 보였다 (2026-07-23).
// iOS 이식 시 동일 아이콘 id 로 UIImage 를 스타일에 등록하면 됨
// (실제로 MapView.registerPOIIcons 가 SF Symbols 로 같은 id 를 채운다).
export const POI_TEXT = { toilets: "WC", parking: "P", information: "i", place_of_worship: "卍", helipad: "H" };

export function makePoiIcon(map, id, theme = "light") {
  const kind = id.replace(/^poi-/, "");
  const dark = theme === "dark";
  const fg = dark ? "#f2f2f2" : "#111111";
  const bg = dark ? "#000000" : "#ffffff";
  const S = 20, P = 2;                       // 뱃지 크기(css px), 여백
  const cv = document.createElement("canvas");
  cv.width = cv.height = S * 2;              // 2x 해상도
  const ctx = cv.getContext("2d");
  ctx.scale(2, 2);

  // 뱃지: 역·헬기장은 원형(관제 기호 관례), 나머지는 라운드 사각
  ctx.fillStyle = bg;
  ctx.strokeStyle = fg;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  if (kind === "station" || kind === "helipad") ctx.arc(S / 2, S / 2, S / 2 - P, 0, Math.PI * 2);
  else ctx.roundRect(P, P, S - 2 * P, S - 2 * P, 4);
  ctx.fill(); ctx.stroke();

  ctx.fillStyle = fg;
  ctx.strokeStyle = fg;
  if (kind in POI_TEXT) {
    // 글자 아이콘 (WC · P · i · 卍)
    const t = POI_TEXT[kind];
    ctx.font = `bold ${t.length > 1 ? 8 : 11}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(t, S / 2, S / 2 + 0.5);
  } else if (kind === "bus_stop") {
    // 버스: 차체 + 창 + 바퀴
    ctx.beginPath(); ctx.roundRect(5.5, 5, 9, 8, 1.5); ctx.fill();
    ctx.fillStyle = bg;
    ctx.fillRect(6.5, 6.5, 7, 2.5);
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(7.5, 14, 1.2, 0, Math.PI * 2); ctx.arc(12.5, 14, 1.2, 0, Math.PI * 2); ctx.fill();
  } else if (kind === "station") {
    // 전철: 차체 + 창 + 하단 레일
    ctx.beginPath(); ctx.roundRect(6, 4.5, 8, 8.5, 2); ctx.fill();
    ctx.fillStyle = bg;
    ctx.fillRect(7, 6, 6, 3);
    ctx.fillStyle = fg;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(6.5, 15.5); ctx.lineTo(9, 13); ctx.moveTo(13.5, 15.5); ctx.lineTo(11, 13); ctx.stroke();
  } else if (kind === "drinking_water") {
    // 물방울
    ctx.beginPath();
    ctx.moveTo(S / 2, 4.5);
    ctx.bezierCurveTo(13.5, 8.5, 14, 10.5, 14, 12);
    ctx.arc(S / 2, 12, 4, 0, Math.PI, false);
    ctx.bezierCurveTo(6, 10.5, 6.5, 8.5, S / 2, 4.5);
    ctx.fill();
  } else if (kind === "viewpoint") {
    // 조망점: 시점(점) + 부챗살(국제 지도 관례)
    ctx.lineWidth = 1.3;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const a of [-52, -26, 0, 26, 52]) {
      const r = (a - 90) * Math.PI / 180;
      ctx.moveTo(S / 2, 13.5);
      ctx.lineTo(S / 2 + Math.cos(r) * 8, 13.5 + Math.sin(r) * 8);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(S / 2, 13.5, 1.8, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "shelter") {
    // 정자: 지붕(팔작 곡선) + 기둥 2 + 마루
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.beginPath();                              // 지붕
    ctx.moveTo(4.5, 9);
    ctx.quadraticCurveTo(S / 2, 3, 15.5, 9);
    ctx.lineTo(4.5, 9);
    ctx.fill();
    ctx.beginPath();                              // 기둥
    ctx.moveTo(7, 9.5); ctx.lineTo(7, 14.5);
    ctx.moveTo(13, 9.5); ctx.lineTo(13, 14.5);
    ctx.stroke();
    ctx.fillRect(5, 14.5, 10, 1.4);               // 마루
  } else {
    return; // 모르는 아이콘은 생성하지 않음
  }
  if (!map.hasImage(id)) map.addImage(id, ctx.getImageData(0, 0, S * 2, S * 2), { pixelRatio: 2 });
}

// styleimagemissing 연결 — getTheme() 은 호출 시점의 테마를 돌려주는 함수
// (테마 전환 후 재생성되는 아이콘이 새 색을 쓰도록 값이 아니라 함수로 받는다).
export function attachPoiIcons(map, getTheme = () => "light") {
  map.on("styleimagemissing", (e) => {
    if (e.id.startsWith("poi-")) makePoiIcon(map, e.id, getTheme());
  });
}
