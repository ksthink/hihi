// 하이하잇 관리자 콘솔 — 코스 큐레이션·스팟 보정·팩 배포 (로컬 전용 도구)
import maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/+esm";
import { Protocol } from "https://cdn.jsdelivr.net/npm/pmtiles@3.2.1/+esm";
import { buildStyle } from "../basemap-style.js";

const $ = (id) => document.getElementById(id);
const EMPTY = { type: "FeatureCollection", features: [] };

// 관리자 토큰 (원격 접속 시 /api 인증 — 서버 시작 로그의 ADMIN_TOKEN).
// /admin/?token=xxx 로 최초 진입하면 localStorage 에 저장 후 URL 에서 제거.
const TOKEN_KEY = "hiheight-admin-token";
let adminToken = localStorage.getItem(TOKEN_KEY) || "";
{
  const t = new URLSearchParams(location.search).get("token");
  if (t) {
    adminToken = t;
    localStorage.setItem(TOKEN_KEY, t);
    history.replaceState(null, "", location.pathname);
  }
}

const api = async (path, opts = {}) => {
  const headers = { ...(opts.headers || {}) };
  if (adminToken) headers["X-Admin-Token"] = adminToken;
  const r = await fetch("/api" + path, { ...opts, headers });
  const ct = r.headers.get("Content-Type") || "";
  const body = ct.includes("json") ? await r.json() : await r.text();
  if (r.status === 401) showLogin(); // 인증 만료/부재 → 로그인 게이트
  if (!r.ok) throw new Error(body.error || r.status);
  return body;
};

// ── 로그인 게이트 (비밀번호 → 토큰, 5회 실패 시 서버가 10분 잠금) ──
function showLogin() {
  $("login-overlay").hidden = false;
  $("login-pw").focus();
}
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("login-msg");
  msg.textContent = "";
  try {
    const r = await fetch("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: $("login-pw").value }),
    });
    const body = await r.json();
    if (!r.ok) { msg.textContent = body.error || r.status; $("login-pw").value = ""; return; }
    adminToken = body.token;
    localStorage.setItem(TOKEN_KEY, adminToken);
    location.reload(); // 토큰 확보 후 재부팅 (초기 로드 재실행)
  } catch (err) {
    msg.textContent = "로그인 실패: " + err.message;
  }
});

// ── 상태 ──
const S = {
  list: [],           // 초안 요약 목록
  code: null,         // 선택 산코드
  draft: null,        // 선택 산 draft
  selCourse: null,    // 선택 코스 id
  selSpot: null,      // 선택 스팟 id
  gpx: null,          // { text, candidate, raw } 업로드/매칭 미리보기
  addingSpot: false,
  dirty: false,
  region: "전체",     // 선택된 지역 필터
  networkFC: null,    // 구간망 GeoJSON (idx 부여 — 클릭 컴포저 조회용)
  compose: null,      // 수작업 코스 입력 { lines, segs[sn], history[] } (부록 D)
};

// ── 지역 분류 (region 자유문자열 → 6권역) ──
// 우선순위 순서대로 첫 매칭 채택. 수도권(경기)을 전라(광주)보다 먼저 검사해
// "경기도 광주시" 같은 문자열이 전라로 잘못 분류되지 않게 한다.
const REGIONS = ["수도권", "강원", "충청", "전라", "경상", "제주"];
const REGION_KEYS = {
  수도권: ["서울", "인천", "경기"],
  강원: ["강원"],
  충청: ["충청", "충북", "충남", "대전", "세종"],
  전라: ["전라", "전북", "전남", "광주"],
  경상: ["경상", "경북", "경남", "부산", "울산", "대구"],
  제주: ["제주"],
};
const ALL = "전체";
function regionGroup(region) {
  const t = region || "";
  for (const g of REGIONS) if (REGION_KEYS[g].some((k) => t.includes(k))) return g;
  return "기타";
}

// ── 지도 ──
maplibregl.addProtocol("pmtiles", new Protocol().tile);
const map = new maplibregl.Map({
  container: "map",
  style: buildStyle(`${location.origin}/pmtiles/v4.pmtiles`, "light"),
  center: [127.5, 36.5], zoom: 6.5,
  maxBounds: [[121.0, 31.0], [135.0, 40.5]], minZoom: 5,
  localIdeographFontFamily: "'Nanum Gothic Coding', 'Apple SD Gothic Neo', 'Malgun Gothic', monospace",
});
map.addControl(new maplibregl.NavigationControl({ showZoom: true }), "bottom-right");

map.on("load", () => {
  for (const id of ["network", "courses", "spots", "gpx-raw", "gpx-matched", "compose"])
    map.addSource(id, { type: "geojson", data: EMPTY });

  map.addLayer({ id: "network-line", type: "line", source: "network",
    paint: { "line-color": "#c9c9c9", "line-width": 1.2 } });
  // 컴포즈 모드 전용: 구간 클릭 히트 + 담긴 코스 미리보기(검정 굵은 선)
  map.addLayer({ id: "network-hit", type: "line", source: "network",
    paint: { "line-color": "#000", "line-opacity": 0.001, "line-width": 16 } });
  map.addLayer({ id: "compose-line", type: "line", source: "compose",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#111", "line-width": 5 } });

  map.addLayer({ id: "courses-line", type: "line", source: "courses",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["case", ["==", ["get", "status"], "ready"], "#111111", "#9a9a9a"],
      "line-width": ["case", ["get", "sel"], 4.5, 2.2],
    } });
  map.addLayer({ id: "courses-hit", type: "line", source: "courses",
    paint: { "line-color": "#000", "line-opacity": 0.001, "line-width": 14 } });

  // GPX 미리보기: 원본(점선) / 매칭 결과(그래프=실선, gpx-fallback=대시)
  map.addLayer({ id: "gpx-raw-line", type: "line", source: "gpx-raw",
    paint: { "line-color": "#888", "line-width": 1.6, "line-dasharray": [1.5, 2] } });
  map.addLayer({ id: "gpx-match-graph", type: "line", source: "gpx-matched",
    filter: ["==", ["get", "src"], "graph"],
    layout: { "line-cap": "round" },
    paint: { "line-color": "#111", "line-width": 4 } });
  map.addLayer({ id: "gpx-match-gpx", type: "line", source: "gpx-matched",
    filter: ["==", ["get", "src"], "gpx"],
    paint: { "line-color": "#111", "line-width": 4, "line-dasharray": [1.2, 1.2] } });

  map.addLayer({ id: "spots-dots", type: "circle", source: "spots",
    paint: {
      "circle-radius": ["case", ["get", "sel"], 7, 5],
      "circle-color": ["match", ["get", "category"],
        "분기점", "#111111", "시종점", "#555555", "정상", "#000000", "#8a8a8a"],
      "circle-opacity": ["case", ["get", "deleted"], 0.25, 1],
      "circle-stroke-width": 1.5, "circle-stroke-color": "#ffffff",
    } });
  map.addLayer({ id: "spots-names", type: "symbol", source: "spots",
    layout: {
      "text-field": ["get", "name"], "text-font": ["Nanum Gothic Coding Regular"],
      "text-size": 11, "text-offset": [0, 0.9], "text-anchor": "top",
      "text-allow-overlap": true,
    },
    paint: { "text-color": "#111", "text-halo-color": "#fff", "text-halo-width": 1.5 } });

  wireMapEvents();
  if (S.draft) { // 지도 로드 전에 산을 선택했다면 데이터 재주입
    renderCourses();
    renderSpots();
    loadNetwork(S.code);
  }
});

// ── draft 저장 (디바운스 자동저장) ──
let saveTimer = null;
function markDirty() {
  S.dirty = true;
  $("save-state").textContent = "저장 대기…";
  $("save-state").className = "dirty";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 800);
}
async function saveDraft() {
  if (!S.dirty || !S.code) return;
  try {
    await api(`/mountains/${S.code}/draft`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(S.draft),
    });
    S.dirty = false;
    $("save-state").textContent = "저장됨 ✓";
    $("save-state").className = "";
  } catch (e) {
    $("save-state").textContent = "저장 실패: " + e.message;
  }
}

// ── 산 검색/추가 ──
let qTimer = null;
$("mnt-q").addEventListener("input", () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(async () => {
    const q = $("mnt-q").value.trim();
    const box = $("mnt-results");
    if (!q) { box.hidden = true; return; }
    const rows = await api(`/mnt-codes?q=${encodeURIComponent(q)}`);
    box.innerHTML = "";
    for (const m of rows) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="nm ${m.has_src ? "" : "no-src"}">${m.name}</span>
        <span class="dim">${m.region || ""} ${m.elev ? m.elev + "m" : ""} · ${m.code}</span>`;
      const btn = document.createElement("button");
      if (m.has_draft) { btn.textContent = "관리 중"; btn.disabled = true; }
      else if (!m.has_src) { btn.textContent = "원본 없음"; btn.disabled = true; btn.title = "mountain/<산코드>/ 에 산림청 원본이 없음"; }
      else { btn.textContent = "추가"; btn.onclick = () => addMountain(m.code); }
      li.appendChild(btn);
      box.appendChild(li);
    }
    if (!rows.length) box.innerHTML = `<li><span class="dim">검색 결과 없음</span></li>`;
    box.hidden = false;
  }, 250);
});

async function addMountain(code) {
  const r = await api("/mountains", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  $("mnt-results").hidden = true;
  $("mnt-q").value = "";
  await refreshList();
  await selectMountain(code);
  if (r.job_id) pollJob(r.job_id, async () => {
    if (S.code === code) await selectMountain(code); // 자동 시드 반영
  });
}

// ── 초안 목록 (지역 필터 + 권역별 그룹) ──
async function refreshList() {
  S.list = await api("/mountains");
  renderRegionTabs();
  renderDraftList();
}

// 지역 필터 탭 — 전체 + 6권역(+데이터에 있으면 기타). 각 버튼에 개수 표시.
function renderRegionTabs() {
  const counts = { [ALL]: S.list.length };
  for (const m of S.list) {
    const g = regionGroup(m.region);
    counts[g] = (counts[g] || 0) + 1;
  }
  const groups = [ALL, ...REGIONS, ...(counts["기타"] ? ["기타"] : [])];
  if (!groups.includes(S.region)) S.region = ALL; // 기타가 사라진 경우 등 폴백
  const tabs = $("region-tabs");
  tabs.innerHTML = "";
  for (const g of groups) {
    const n = counts[g] || 0;
    const b = document.createElement("button");
    b.className = (g === S.region ? "active " : "") + (n === 0 && g !== ALL ? "empty" : "");
    b.innerHTML = `${g}<span class="cnt">${n}</span>`;
    b.onclick = () => { S.region = g; renderRegionTabs(); renderDraftList(); };
    tabs.appendChild(b);
  }
}

function renderDraftList() {
  const ul = $("draft-list");
  ul.innerHTML = "";
  let items = S.list.map((m) => ({ ...m, group: regionGroup(m.region) }));
  if (S.region !== ALL) items = items.filter((m) => m.group === S.region);
  const gi = (g) => { const i = REGIONS.indexOf(g); return i < 0 ? 99 : i; }; // 기타는 맨 뒤
  items.sort((a, b) => gi(a.group) - gi(b.group)
    || (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, "ko"));
  if (!items.length) {
    ul.innerHTML = `<li class="empty-note dim">이 지역에 관리 중인 산이 없습니다.</li>`;
    return;
  }
  const showHeads = S.region === ALL; // 전체 볼 때만 권역 소제목 삽입
  let curGroup = null;
  for (const m of items) {
    if (showHeads && m.group !== curGroup) {
      curGroup = m.group;
      const h = document.createElement("li");
      h.className = "region-head";
      h.textContent = curGroup;
      ul.appendChild(h);
    }
    const li = document.createElement("li");
    li.className = m.code === S.code ? "sel" : "";
    const pub = m.publish?.pack_version ? `v${m.publish.pack_version}` : "미배포";
    li.innerHTML = `<div><div class="nm">${m.name}</div>
      <div class="meta">코스 ${m.ready}/${m.courses} ready · 스팟 ${m.spots} · ${pub}
      ${m.published ? "" : '<span class="unpub">비공개</span>'}</div></div>
      <span class="dim">${m.code}</span>`;
    li.onclick = () => selectMountain(m.code);
    ul.appendChild(li);
  }
}

// ── 산 선택 ──
async function selectMountain(code) {
  await saveDraft();
  S.code = code;
  S.selCourse = null; S.selSpot = null; S.gpx = null; S.addingSpot = false;
  if (S.compose) exitCompose();
  S.draft = await api(`/mountains/${code}/draft`);
  $("sec-mnt").hidden = false;
  $("sec-mnt-empty").hidden = true;
  clearGpxPreview();
  closeSpotEditor();
  renderMountain();
  refreshList();
  const b = S.draft.mountain.bbox;
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 30, duration: 600 });
  loadNetwork(code);
}

async function loadNetwork(code) {
  const src = map.getSource("network"); // 지도 로드 전이면 map load 핸들러가 재시도
  if (!src) return;
  try {
    const fc = await api(`/mountains/${code}/network`);
    // sn 은 path 분할로 중복될 수 있어 클라이언트 인덱스로 피처 식별 (클릭 컴포저)
    fc.features.forEach((f, i) => { f.properties.idx = i; });
    S.networkFC = fc;
    src.setData(fc);
  } catch (_) { S.networkFC = null; src.setData(EMPTY); } // 원본 없는 legacy 산
}

function renderMountain() {
  const m = S.draft.mountain;
  $("mnt-title").textContent = `${m.name} (${m.code})`;
  $("m-name").value = m.name || "";
  $("m-region").value = m.region || "";
  $("m-elev").value = m.elev ?? "";
  $("m-sort").value = m.sort_order ?? 100;
  $("m-famous").checked = !!m.famous;
  $("m-published").checked = !!m.published;
  const p = S.draft.publish;
  $("pub-info").textContent = p?.pack_version
    ? `현재 v${p.pack_version}${p.published_at ? " · " + p.published_at.slice(0, 16) : ""}${p.pack_size_kb ? " · " + Math.round(p.pack_size_kb / 1024) + "MB" : ""}`
    : "아직 배포되지 않음";
  renderCourses();
  renderSpots();
}

for (const [id, key, cast] of [["m-region", "region", String], ["m-elev", "elev", Number],
  ["m-sort", "sort_order", Number], ["m-famous", "famous", Boolean], ["m-published", "published", Boolean]]) {
  $(id).addEventListener("change", (e) => {
    const v = cast === Boolean ? e.target.checked : cast(e.target.value);
    S.draft.mountain[key] = (cast === Number && Number.isNaN(v)) ? null : v;
    markDirty(); refreshList();
  });
}

// 이름 편집 (등록 후에도 변경 가능) — 빈 이름 방지 + 제목·목록 즉시 반영
$("m-name").addEventListener("change", (e) => {
  const m = S.draft.mountain;
  const v = e.target.value.trim();
  if (!v) { e.target.value = m.name || ""; return; } // 빈 이름은 무시하고 원복
  m.name = v;
  $("mnt-title").textContent = `${v} (${m.code})`;
  const row = S.list.find((x) => x.code === m.code); // 재조회 없이 목록 즉시 갱신
  if (row) { row.name = v; renderRegionTabs(); renderDraftList(); }
  markDirty();
});

// ── 코스 ──
function courseFC() {
  return { type: "FeatureCollection", features: (S.draft?.courses || []).map((c) => ({
    type: "Feature",
    geometry: { type: "MultiLineString", coordinates: c.lines },
    properties: { id: c.id, status: c.status, sel: c.id === S.selCourse },
  })) };
}

function renderCourses() {
  if (map.getSource("courses")) map.getSource("courses").setData(courseFC());
  const cs = S.draft.courses;
  $("course-count").textContent = `(${cs.filter((c) => c.status === "ready").length}/${cs.length} 배포)`;
  const ul = $("course-list");
  ul.innerHTML = "";
  for (const c of cs) {
    const li = document.createElement("li");
    li.className = (c.id === S.selCourse ? "sel " : "") + (c.status === "ready" ? "" : "off");
    li.dataset.id = c.id;
    const src = c.source?.type === "gpx" ? `GPX ${Math.round((c.source.matched_ratio ?? 0) * 100)}%`
      : c.source?.type === "manual" ? "수작업"
      : c.source?.type === "forest_auto" ? "자동" : "기존";
    const k = c.computed || {};
    li.innerHTML = `
      <div class="c-head">
        ${c.no != null ? `<span class="c-no">${c.no}</span>` : ""}
        <input class="c-name" title="클릭해서 코스명 수정" value="${(c.name || "").replace(/"/g, "&quot;")}" />
        <span class="badge ${c.source?.type === "gpx" ? "gpx" : ""}">${src}</span>
        <span class="badge ${c.status === "ready" ? "ready" : ""}">${c.status === "ready" ? "배포" : "초안"}</span>
      </div>
      <div class="c-meta">${c.difficulty} · ${k.distance_km ?? "?"}km · ↑${k.ascent ?? "?"}m · ${k.min_elev ?? "?"}~${k.max_elev ?? "?"}m</div>
      <div class="c-tools row">
        <select class="c-diff">${["초급", "중급", "고급"].map((d) =>
          `<option ${d === c.difficulty ? "selected" : ""}>${d}</option>`).join("")}</select>
        <button class="c-status">${c.status === "ready" ? "초안으로" : "배포에 포함"}</button>
        <button class="c-recompute" title="거리·프로파일·난이도 재계산">재계산</button>
        <button class="c-del danger">삭제</button>
        <input class="c-desc" placeholder="설명" value="${(c.desc || "").replace(/"/g, "&quot;")}" />
      </div>`;
    li.onclick = (e) => { if (e.target.tagName !== "INPUT" && e.target.tagName !== "SELECT" && e.target.tagName !== "BUTTON") selectCourse(c.id, true); };
    li.querySelector(".c-name").addEventListener("change", (e) => { c.name = e.target.value.trim(); markDirty(); });
    li.querySelector(".c-name").addEventListener("focus", () => selectCourse(c.id, false)); // DOM 재생성 없음 — 편집 유지
    li.querySelector(".c-diff").addEventListener("change", (e) => { c.difficulty = e.target.value; markDirty(); renderCourses(); });
    li.querySelector(".c-desc").addEventListener("change", (e) => { c.desc = e.target.value.trim() || null; markDirty(); });
    li.querySelector(".c-status").onclick = () => {
      c.status = c.status === "ready" ? "draft" : "ready";
      markDirty(); renderCourses(); refreshList();
    };
    li.querySelector(".c-recompute").onclick = async () => {
      await saveDraft();
      const upd = await api(`/mountains/${S.code}/courses/${c.id}/recompute`, { method: "POST" });
      Object.assign(c, upd);
      renderCourses();
    };
    li.querySelector(".c-del").onclick = () => {
      if (!confirm(`코스 "${c.name}" 삭제?`)) return;
      S.draft.courses = S.draft.courses.filter((x) => x.id !== c.id);
      if (S.selCourse === c.id) S.selCourse = null;
      markDirty(); renderCourses(); refreshList();
    };
    ul.appendChild(li);
  }
}

// 선택 표시만 갱신 (목록 DOM 은 재생성하지 않음 — 이름 입력 포커스가 죽지 않도록)
function updateCourseSelection() {
  if (map.getSource("courses")) map.getSource("courses").setData(courseFC());
  document.querySelectorAll("#course-list li").forEach((li) =>
    li.classList.toggle("sel", li.dataset.id === S.selCourse));
}

function selectCourse(id, fit) {
  S.selCourse = id;
  updateCourseSelection();
  const c = S.draft.courses.find((x) => x.id === id);
  if (c && fit) {
    const pts = c.lines.flat();
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]],
      { padding: 60, duration: 500 });
  }
  document.querySelector(`#course-list li[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
}

// ── 수작업 코스 입력 (클릭 컴포저, 부록 D) ──
// 회색 구간망을 시점→종점 순서로 클릭해 코스를 구성. 끝점이 40m 이내면 방향 맞춰
// 이어붙이고, 안 닿으면 새 라인 파트로 추가(산림청 데이터의 실제 갭 허용) + 경고.
const SNAP_M = 40;
function havM(a, b) { // 좌표 [lon,lat] 간 거리(m)
  const R = 6371000, r = Math.PI / 180;
  const dLa = (b[1] - a[1]) * r, dLo = (b[0] - a[0]) * r;
  const h = Math.sin(dLa / 2) ** 2 +
    Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const composeFC = () => ({ type: "FeatureCollection", features: (S.compose?.lines || [])
  .map((ln) => ({ type: "Feature", geometry: { type: "LineString", coordinates: ln }, properties: {} })) });

function renderCompose(msg) {
  map.getSource("compose")?.setData(composeFC());
  const c = S.compose;
  const parts = c.lines.length;
  const km = c.lines.reduce((t, ln) => {
    for (let i = 1; i < ln.length; i++) t += havM(ln[i - 1], ln[i]);
    return t;
  }, 0) / 1000;
  $("compose-stat").textContent =
    `구간 ${c.segs.length}개 · ${km.toFixed(1)}km` + (parts > 1 ? ` · ⚠ 비연결 파트 ${parts}개` : "");
  $("compose-info").innerHTML = msg ||
    `시점부터 종점까지 회색 구간을 <b>순서대로 클릭</b>하세요.`;
}

function startCompose() {
  if (S.compose) return exitCompose();
  if (!S.networkFC?.features?.length) { alert("구간망 원본이 없는 산입니다. GPX 업로드를 사용하세요."); return; }
  S.compose = { lines: [], segs: [], history: [] };
  S.addingSpot = false;
  $("spot-add").classList.remove("active");
  $("compose-box").hidden = false;
  $("compose-start").classList.add("active");
  $("compose-start").textContent = "코스 입력 중… (버리기로 종료)";
  map.getCanvas().style.cursor = "crosshair";
  renderCompose();
}

function exitCompose() {
  S.compose = null;
  $("compose-box").hidden = true;
  $("compose-start").classList.remove("active");
  $("compose-start").textContent = "＋ 코스 등록 (지도에서 구간 클릭)";
  map.getCanvas().style.cursor = "";
  map.getSource("compose")?.setData(EMPTY);
}

function composeClick(idx) {
  const c = S.compose;
  const f = S.networkFC.features[idx];
  if (!f) return;
  const pts = f.geometry.coordinates.map((p) => [p[0], p[1]]);
  c.history.push({ lines: c.lines.map((ln) => ln.slice()), segs: c.segs.slice() });
  c.segs.push(f.properties.sn ?? idx);
  let warn = null;
  if (!c.lines.length) {
    c.lines.push(pts);
  } else {
    const last = c.lines[c.lines.length - 1];
    const end = last[last.length - 1];
    if (havM(end, pts[0]) <= SNAP_M) last.push(...pts.slice(1));
    else if (havM(end, pts[pts.length - 1]) <= SNAP_M) last.push(...pts.slice(0, -1).reverse());
    else if (c.lines.length === 1 && c.segs.length === 2 &&
             (havM(last[0], pts[0]) <= SNAP_M || havM(last[0], pts[pts.length - 1]) <= SNAP_M)) {
      // 첫 구간을 반대 방향으로 클릭한 경우 — 두 번째 클릭에서 자동 정렬
      last.reverse();
      if (havM(last[last.length - 1], pts[0]) <= SNAP_M) last.push(...pts.slice(1));
      else last.push(...pts.slice(0, -1).reverse());
    } else {
      c.lines.push(pts);
      warn = `<span class="warn">⚠ 이전 구간과 연결되지 않아 새 파트로 추가했습니다 (잘못 클릭했다면 "마지막 취소").</span>`;
    }
  }
  renderCompose(warn);
}

$("compose-start").onclick = startCompose;
$("compose-cancel").onclick = exitCompose;
$("compose-undo").onclick = () => {
  const c = S.compose;
  if (!c?.history.length) return;
  const prev = c.history.pop();
  c.lines = prev.lines; c.segs = prev.segs;
  renderCompose();
};
$("compose-done").onclick = async () => {
  const c = S.compose;
  if (!c?.lines.length) { alert("클릭한 구간이 없습니다."); return; }
  const no = Math.max(0, ...S.draft.courses.map((x) => x.no || 0)) + 1;
  const name = (prompt(`코스 이름 (번호 ${no}번은 자동 부여)`, `${no}코스`) || "").trim();
  if (!name) return; // 취소
  const course = {
    id: "c-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4),
    no, name, difficulty: "초급", desc: null, kind: "운영자 큐레이션",
    status: "draft",
    source: { type: "manual", segments: c.segs },
    segments: null,
    lines: c.lines.map((ln) => ln.map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)])),
    computed: {},
  };
  S.draft.courses.push(course);
  S.selCourse = course.id;
  exitCompose();
  markDirty();
  await saveDraft(); // recompute 는 디스크의 draft 를 읽으므로 먼저 저장
  try {
    const upd = await api(`/mountains/${S.code}/courses/${course.id}/recompute`, { method: "POST" });
    Object.assign(course, upd);
  } catch (e) {
    alert("통계 계산 실패(코스는 저장됨): " + e.message);
  }
  renderCourses(); refreshList();
};

// ── GPX 업로드/매칭 ──
$("gpx-file").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  S.gpx = { text: await f.text(), name: f.name };
  await runMatch();
});
$("gpx-rematch").onclick = runMatch;
$("gpx-cancel").onclick = () => { S.gpx = null; clearGpxPreview(); };
$("gpx-accept").onclick = () => {
  if (!S.gpx?.candidate) return;
  S.draft.courses.push(S.gpx.candidate);
  S.selCourse = S.gpx.candidate.id;
  S.gpx = null;
  clearGpxPreview();
  markDirty(); renderCourses(); refreshList();
};

async function runMatch() {
  if (!S.gpx) return;
  const tau = $("gpx-tau").value || 25, detour = $("gpx-detour").value || 1.6;
  $("gpx-report").hidden = false;
  $("gpx-report").textContent = "매칭 중…";
  try {
    const r = await api(`/mountains/${S.code}/gpx?tau=${tau}&detour=${detour}`, {
      method: "POST", headers: { "Content-Type": "application/gpx+xml" }, body: S.gpx.text,
    });
    S.gpx.candidate = r.course;
    map.getSource("gpx-raw").setData(r.preview.raw);
    map.getSource("gpx-matched").setData(r.preview.matched);
    const rep = r.report;
    const fb = rep.fallbacks.length
      ? `<div class="warn">구간망 밖 ${rep.fallbacks.length}곳 (GPX 원 좌표 유지): ${rep.fallbacks.map((f) => f.km + "km").join(", ")}</div>`
      : "<div>전 구간 구간망 매칭 ✓</div>";
    $("gpx-report").innerHTML =
      `매칭률 <b>${Math.round(rep.matched_ratio * 100)}%</b> · ${rep.distance_km}km · ↑${rep.ascent}m · 최대이탈 ${Math.round(rep.max_dev_m)}m ${fb}`;
    $("gpx-actions").hidden = false;
    const pts = r.preview.raw.features[0].geometry.coordinates;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]],
      { padding: 60, duration: 500 });
  } catch (err) {
    $("gpx-report").innerHTML = `<span class="warn">매칭 실패: ${err.message}</span>`;
    $("gpx-actions").hidden = true;
  }
}

function clearGpxPreview() {
  for (const s of ["gpx-raw", "gpx-matched"]) map.getSource(s)?.setData(EMPTY);
  $("gpx-report").hidden = true;
  $("gpx-actions").hidden = true;
  $("gpx-file").value = "";
}

// ── 스팟 ──
function spotFC() {
  const showDel = $("spot-show-del").checked;
  return { type: "FeatureCollection", features: (S.draft?.spots || [])
    .filter((s) => showDel || !s.deleted)
    .map((s) => ({ type: "Feature",
      geometry: { type: "Point", coordinates: s.coord },
      properties: { id: s.id, category: s.category, name: s.name || "",
        deleted: !!s.deleted, sel: s.id === S.selSpot } })) };
}

function renderSpots() {
  if (map.getSource("spots")) map.getSource("spots").setData(spotFC());
  const sp = S.draft.spots;
  $("spot-count").textContent =
    `(${sp.filter((s) => !s.deleted).length}개 · 이름 ${sp.filter((s) => s.name && !s.deleted).length})`;
}
$("spot-show-del").addEventListener("change", renderSpots);

function openSpotEditor(id) {
  S.selSpot = id;
  const s = S.draft.spots.find((x) => x.id === id);
  if (!s) return;
  $("spot-editor").hidden = false;
  $("sp-cat-label").textContent = s.category + (s.origin === "manual" ? " (수동)" : "");
  $("sp-id").textContent = " " + s.id;
  $("sp-name").value = s.name || "";
  $("sp-cat").value = s.category;
  $("sp-detail").textContent = [s.detail, s.etc].filter(Boolean).join(" · ");
  $("sp-del").textContent = s.deleted ? "복원" : "삭제";
  renderSpots();
}
function closeSpotEditor() {
  S.selSpot = null;
  $("spot-editor").hidden = true;
  if (map.getSource("spots")) renderSpots();
}
$("sp-name").addEventListener("change", (e) => {
  const s = S.draft.spots.find((x) => x.id === S.selSpot);
  if (s) { s.name = e.target.value.trim() || null; markDirty(); renderSpots(); }
});
$("sp-cat").addEventListener("change", (e) => {
  const s = S.draft.spots.find((x) => x.id === S.selSpot);
  if (s) { s.category = e.target.value; markDirty(); renderSpots(); openSpotEditor(s.id); }
});
$("sp-del").onclick = () => {
  const s = S.draft.spots.find((x) => x.id === S.selSpot);
  if (!s) return;
  if (s.origin === "manual" && !s.deleted) {
    S.draft.spots = S.draft.spots.filter((x) => x.id !== s.id); // 수동 추가는 완전 삭제
    closeSpotEditor();
  } else {
    s.deleted = !s.deleted;
    openSpotEditor(s.id);
  }
  markDirty(); renderSpots(); refreshList();
};
$("sp-close").onclick = closeSpotEditor;

$("spot-add").onclick = () => {
  if (S.compose) exitCompose(); // 컴포즈와 스팟 추가는 동시 불가
  S.addingSpot = !S.addingSpot;
  $("spot-add").classList.toggle("active", S.addingSpot);
  map.getCanvas().style.cursor = S.addingSpot ? "crosshair" : "";
};

// ── 지도 이벤트 (코스 클릭·스팟 클릭/드래그·스팟 추가) ──
function wireMapEvents() {
  // 컴포즈 모드: 구간망 클릭 → 코스에 순서대로 담기
  map.on("click", "network-hit", (e) => {
    if (!S.compose) return;
    composeClick(e.features[0].properties.idx);
  });
  map.on("mouseenter", "network-hit", () => { if (S.compose) map.getCanvas().style.cursor = "crosshair"; });
  map.on("click", "courses-hit", (e) => {
    if (S.addingSpot || S.compose) return;
    const id = e.features[0].properties.id;
    selectCourse(id, false);
    e.preventDefault?.();
  });
  map.on("click", "spots-dots", (e) => {
    if (S.addingSpot || S.compose) return;
    openSpotEditor(e.features[0].properties.id);
  });
  map.on("click", (e) => {
    if (!S.addingSpot || !S.draft) return;
    const id = "sp-new-" + Math.random().toString(36).slice(2, 8);
    S.draft.spots.push({ id, category: "분기점", name: null,
      coord: [+e.lngLat.lng.toFixed(6), +e.lngLat.lat.toFixed(6)],
      detail: null, etc: null, origin: "manual", moved: false, deleted: false });
    S.addingSpot = false;
    $("spot-add").classList.remove("active");
    map.getCanvas().style.cursor = "";
    markDirty(); renderSpots(); openSpotEditor(id);
  });
  for (const layer of ["courses-hit", "spots-dots"]) {
    map.on("mouseenter", layer, () => { if (!S.addingSpot) map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layer, () => { if (!S.addingSpot) map.getCanvas().style.cursor = ""; });
  }
  // 스팟 드래그 이동
  map.on("mousedown", "spots-dots", (e) => {
    if (S.addingSpot || S.compose) return;
    e.preventDefault();
    const id = e.features[0].properties.id;
    const s = S.draft.spots.find((x) => x.id === id);
    if (!s) return;
    openSpotEditor(id);
    map.getCanvas().style.cursor = "grabbing";
    const onMove = (ev) => {
      s.coord = [+ev.lngLat.lng.toFixed(6), +ev.lngLat.lat.toFixed(6)];
      renderSpots();
    };
    map.on("mousemove", onMove);
    map.once("mouseup", () => {
      map.off("mousemove", onMove);
      map.getCanvas().style.cursor = "";
      s.moved = true;
      markDirty();
    });
  });
}

// ── 배포 ──
$("publish").onclick = async () => {
  if (!S.code) return;
  const ready = S.draft.courses.filter((c) => c.status === "ready").length;
  if (!confirm(`${S.draft.mountain.name} 배포 — ready 코스 ${ready}개가 Supabase 에 반영됩니다. 진행?`)) return;
  await saveDraft();
  const { job_id } = await api(`/mountains/${S.code}/publish`, { method: "POST" });
  $("publish").disabled = true;
  pollJob(job_id, async () => {
    $("publish").disabled = false;
    S.draft = await api(`/mountains/${S.code}/draft`);
    renderMountain(); refreshList();
  });
};

$("prod-del").onclick = async () => {
  if (!S.code) return;
  const nm = S.draft.mountain.name, code = S.code;
  if (!confirm(`"${nm}"(${code})을 앱에서 완전히 삭제합니다.\n\n· Supabase 카탈로그 행 삭제\n· R2 팩 파일(packs/${code}/) 삭제\n· 로컬 초안 삭제\n\n되돌릴 수 없습니다. 진행할까요?`)) return;
  S.dirty = false; // 삭제할 초안을 다시 저장하지 않도록
  const r = await api(`/mountains/${code}`, { method: "DELETE" });
  S.code = null; S.draft = null;
  $("sec-mnt").hidden = true;
  $("sec-mnt-empty").hidden = false;
  for (const s of ["network", "courses", "spots"]) map.getSource(s)?.setData(EMPTY);
  refreshList();
  alert(`"${nm}" 삭제 완료 — 카탈로그 ${r.catalog_deleted ? "1행" : "없음"}, R2 파일 ${r.r2_deleted ?? 0}개, 초안 ${r.draft_removed ? "제거" : "없음"}`
    + (r.unpublish_error ? `\n⚠ 배포본 삭제 오류: ${r.unpublish_error}` : "")
    + `\n\n앱은 새로고침하면 반영됩니다.`);
};

function pollJob(id, onDone) {
  $("job-panel").hidden = false;
  const t = setInterval(async () => {
    try {
      const j = await api(`/jobs/${id}`);
      $("job-step").textContent = `${j.title} — ${j.step}` + (j.state === "error" ? " (실패)" : "");
      $("job-fill").style.width = Math.round(j.progress * 100) + "%";
      $("job-log").textContent = j.log.slice(-8).join("\n") + (j.error ? "\n⚠ " + j.error : "");
      $("job-log").scrollTop = $("job-log").scrollHeight;
      if (j.state === "done" || j.state === "error") {
        clearInterval(t);
        if (j.state === "done") onDone?.(j);
        else $("publish").disabled = false;
      }
    } catch { clearInterval(t); }
  }, 1000);
}

// ── 로그아웃: 저장된 토큰 제거 → 로그인 게이트로 ──
$("logout").onclick = () => {
  localStorage.removeItem(TOKEN_KEY);
  adminToken = "";
  location.reload();
};

// ── 단 배치·크기 (드래그) ── 웹 전용 관리자 도구 (iOS 이식 무관)
// 상하 2단(v) ↔ 좌우 2단(h) 전환은 #side 의 flex-direction 을 뒤집는 것.
const SPLIT_KEY = "hiheight-admin-split";     // v 모드: 상단(목록) 높이 px
const SPLITW_KEY = "hiheight-admin-splitw";   // h 모드: 좌측(목록) 폭 px
const SIDEW_KEY = "hiheight-admin-sidew";     // h 모드: 사이드 전체 폭 px
const LAYOUT_KEY = "hiheight-admin-layout";   // "v"(상하) | "h"(좌우)
{
  const side = $("side"), top = $("side-top"), divider = $("side-divider");
  const bar = $("bottom-bar"), toggle = $("dock-toggle");
  const ls = (k) => +localStorage.getItem(k) || 0;
  let layout = localStorage.getItem(LAYOUT_KEY) === "h" ? "h" : "v";

  const clampH = (h) => Math.max(80, Math.min(side.getBoundingClientRect().height - 160, h));
  const clampCol = (w) => Math.max(200, Math.min(side.getBoundingClientRect().width - 240, w));
  const clampSide = (w) => Math.max(560, Math.min(window.innerWidth - 260, w));
  let raf = false;
  const resizeMap = () => { if (!raf) { raf = true; requestAnimationFrame(() => { raf = false; map.resize(); }); } };

  function applyLayout(mode) {
    layout = mode;
    side.classList.toggle("mode-h", mode === "h");
    if (mode === "h") {                     // 좌우 2단: 폭을 인라인으로 지정
      top.style.height = "";
      side.style.width = clampSide(ls(SIDEW_KEY) || 700) + "px";
      top.style.width = clampCol(ls(SPLITW_KEY) || 320) + "px";
    } else {                                // 상하 2단: 높이만, 폭은 CSS(360)
      top.style.width = ""; side.style.width = "";
      const h = ls(SPLIT_KEY);
      top.style.height = h ? clampH(h) + "px" : ""; // 없으면 CSS 42%
    }
    localStorage.setItem(LAYOUT_KEY, mode);
    resizeMap();
  }

  // 구분선 드래그 = 크기 조절 (모드에 따라 높이/폭)
  divider.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY;
    const r0 = top.getBoundingClientRect(), sh = r0.height, sw = r0.width;
    document.body.style.userSelect = "none";
    const onMove = (ev) => {
      if (layout === "h") { top.style.width = clampCol(sw + ev.clientX - sx) + "px"; resizeMap(); }
      else top.style.height = clampH(sh + ev.clientY - sy) + "px";
    };
    const onUp = () => {
      divider.removeEventListener("pointermove", onMove);
      divider.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      const r = top.getBoundingClientRect();
      localStorage.setItem(layout === "h" ? SPLITW_KEY : SPLIT_KEY,
        Math.round(layout === "h" ? r.width : r.height));
    };
    divider.addEventListener("pointermove", onMove);
    divider.addEventListener("pointerup", onUp);
  });

  // 편집 패널 바 드래그 → 목록 오른쪽=좌우(h) / 목록 왼쪽·아래=상하(v)
  const hint = document.createElement("div");
  hint.id = "dock-hint"; hint.hidden = true; document.body.appendChild(hint);
  const zoneOf = (x) => (x > top.getBoundingClientRect().right ? "h" : "v");
  const showHint = (zone) => {
    if (!zone) { hint.hidden = true; return; }
    hint.hidden = false;
    if (zone === "h") {
      const r = top.getBoundingClientRect();
      hint.style.left = (r.right + 10) + "px"; hint.style.top = "88px";
      hint.style.width = Math.min(340, window.innerWidth - r.right - 28) + "px";
      hint.style.height = Math.round(window.innerHeight * 0.6) + "px";
      hint.textContent = "좌우 2단";
    } else {
      hint.style.left = "8px"; hint.style.top = Math.round(window.innerHeight * 0.46) + "px";
      hint.style.width = "344px"; hint.style.height = Math.round(window.innerHeight * 0.46) + "px";
      hint.textContent = "상하 2단";
    }
  };
  bar.addEventListener("pointerdown", (e) => {
    if (e.target.closest("#dock-toggle")) return; // 토글 버튼 클릭은 드래그 아님
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    bar.classList.add("dragging");
    document.body.style.userSelect = "none";
    const onMove = (ev) => { const z = zoneOf(ev.clientX); showHint(z !== layout ? z : null); };
    const onUp = (ev) => {
      bar.removeEventListener("pointermove", onMove);
      bar.removeEventListener("pointerup", onUp);
      bar.classList.remove("dragging");
      document.body.style.userSelect = "";
      hint.hidden = true;
      const z = zoneOf(ev.clientX);
      if (z !== layout) applyLayout(z);
    };
    bar.addEventListener("pointermove", onMove);
    bar.addEventListener("pointerup", onUp);
  });
  toggle.onclick = () => applyLayout(layout === "h" ? "v" : "h"); // 한 번에 전환(폴백)

  let rz;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => applyLayout(layout), 120); });
  applyLayout(layout); // 저장된 배치 복원
}

// ── 부팅 ── (401 이면 api() 가 로그인 게이트를 띄움)
refreshList().catch(() => {});
