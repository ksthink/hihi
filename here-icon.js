// 내 위치 픽토그램 — **앱 `ios/HiHeight/HereIcon.swift` 의 grid 와 같은 격자**다.
// POIIcons 와 같은 계약: 같은 표시가 플랫폼마다 다른 그림으로 보이지 않게 좌표를 그대로 옮긴다.
//
// 원본(2026-08-13 사용자 제공)을 실측해 옮겼다 — 40px 캔버스에서 인물이 17×28px,
// 머리 7×7px, 머리와 몸통 사이 4px. 셀 3.5px 로 나누면 5칸 × 8줄로 떨어진다.
// 머리가 몸통 중심에서 반 칸 왼쪽인 것도 원본 그대로다(대칭으로 고치지 않았다).
export const HERE_GRID = [
  ".##..",
  ".##..",
  ".....",
  "#####",
  "#####",
  "#####",
  "##.##",
  "##.##",
];

// CSS `mask-image` 용 실루엣. **색을 담지 않는다** — 색은 CSS 가 var(--text) 로 칠하므로
// 다크/라이트 전환에 자바스크립트가 끼어들 필요가 없다(테마 토글이 CSS 변수만 바꾼다).
export function hereMaskUrl() {
  let d = "";
  HERE_GRID.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch === "#") d += `M${c} ${r}h1v1h-1z`;
    });
  });
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${HERE_GRID[0].length} ${HERE_GRID.length}">` +
    `<path d="${d}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
