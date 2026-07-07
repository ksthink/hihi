// 국가지점번호 (National Point Number) — 현재 위치 → 국가지점번호 변환.
// 행정안전부 규정 기준. iOS 이식 시 이 모듈을 1:1 참조(순수 수학, 브라우저 API 미사용).
//
// 체계:
//  - 좌표계: UTM-K (EPSG:5179, GRS80). 원점 경도 127.5°E·위도 38°N,
//    축척 0.9996, 가산값 X=1,000,000 · Y=2,000,000.
//  - 기준점('가가 0000 0000'): UTM-K 원점에서 서쪽 300km·남쪽 700km
//    → UTM-K 좌표 (X=700,000, Y=1,300,000).
//  - 격자: 기준점에서 동·북으로 100km 단위 한글(첫 글자=동/가로, 둘째=북/세로),
//    그 안을 10m 격자(숫자 4+4자리, 각 자리=10m 단위 동/북 거리).
//  예) '다사 5381 5262' = 기준점에서 동 253.81km·북 652.62km.
// 정밀도: WGS84→UTM-K 정변환은 Redfearn 급수(설악산·제주 포함 전국 오차 <0.1mm,
//         Krüger n-급수와 교차검증). 규정 예시 '다사 …' 격자 일치 확인.

const A = 6378137.0;                 // GRS80 장반경
const F = 1 / 298.257222101;         // GRS80 편평률
const K0 = 0.9996;
const LAT0 = (38.0 * Math.PI) / 180;
const LON0 = (127.5 * Math.PI) / 180;
const FE = 1_000_000.0, FN = 2_000_000.0;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const BASE_X = 700_000.0, BASE_Y = 1_300_000.0; // 국가지점번호 기준점(UTM-K)
const SEQ = "가나다라마바사아자차카타파하";      // 100km 격자 한글

function meridArc(lat) {
  return A * (
    (1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * lat
    - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * lat)
    + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * lat)
    - (35 * E2 ** 3 / 3072) * Math.sin(6 * lat)
  );
}
const M0 = meridArc(LAT0);

// WGS84(위도·경도, degrees) → UTM-K (EPSG:5179) {x, y} (m)
export function toUtmK(latDeg, lonDeg) {
  const lat = (latDeg * Math.PI) / 180, lon = (lonDeg * Math.PI) / 180;
  const sin = Math.sin(lat), cos = Math.cos(lat), tan = Math.tan(lat);
  const nu = A / Math.sqrt(1 - E2 * sin * sin);
  const T = tan * tan, C = EP2 * cos * cos;
  const a1 = (lon - LON0) * cos;
  const x = FE + K0 * nu * (a1 + (1 - T + C) * a1 ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * a1 ** 5 / 120);
  const y = FN + K0 * (meridArc(lat) - M0 + nu * tan * (a1 * a1 / 2 + (5 - T + 9 * C + 4 * C * C) * a1 ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * a1 ** 6 / 720));
  return { x, y };
}

// WGS84 → 국가지점번호. 반환: { code:"다사 5381 5262", east_m, north_m } | null(격자 밖)
export function nationalPointNumber(latDeg, lonDeg) {
  const { x, y } = toUtmK(latDeg, lonDeg);
  const dx = x - BASE_X, dy = y - BASE_Y;
  if (dx < 0 || dy < 0) return null;
  const ei = Math.floor(dx / 100_000), ni = Math.floor(dy / 100_000);
  if (ei >= SEQ.length || ni >= SEQ.length) return null;
  const ed = Math.floor((dx % 100_000) / 10);
  const nd = Math.floor((dy % 100_000) / 10);
  const p4 = (n) => String(n).padStart(4, "0");
  return { code: `${SEQ[ei]}${SEQ[ni]} ${p4(ed)} ${p4(nd)}`, east_m: dx, north_m: dy };
}
