// ── Supabase 클라이언트 ───────────────────────────────
// 온라인 기능(회원가입/로그인, 등반 기록 저장, 명산 팩 배포)용 백엔드.
// 핵심 오프라인 등반 런타임(지도/경로)은 로컬이 담당 — 여기는 "온라인일 때 동기화" 레이어.
//
// iOS 이식 시: 이 CDN ESM import 는 `supabase-swift` 네이티브 SDK 로 치환.
// 스키마·RLS·Storage 버킷은 그대로 재사용된다.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// Publishable 키 (신규 API 키 체계) — 브라우저용 공개키. RLS 로 보호되어 노출이 안전하다.
// (레거시 anon/service_role 키는 2026-07-04 폐기됨.)
// ⚠️ Secret 키(sb_secret_…)는 절대 이 파일에 두지 말 것 (RLS 우회 → 전체 DB 노출). 시드는 로컬 .env 로만.
const SUPABASE_URL = "https://durnojryhhsajnlwvdzt.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_qltsOvZhvVwPF5YNQARgCg_6KcV6Km5";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

// ── 인증 헬퍼 (이메일 + 비밀번호) ────────────────────
export const signUp = (email, password) => supabase.auth.signUp({ email, password });
export const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password });
export const signOut = () => supabase.auth.signOut();
