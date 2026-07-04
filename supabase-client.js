// ── Supabase 클라이언트 ───────────────────────────────
// 온라인 기능(회원가입/로그인, 등반 기록 저장, 명산 팩 배포)용 백엔드.
// 핵심 오프라인 등반 런타임(지도/경로)은 로컬이 담당 — 여기는 "온라인일 때 동기화" 레이어.
//
// iOS 이식 시: 이 CDN ESM import 는 `supabase-swift` 네이티브 SDK 로 치환.
// 스키마·RLS·Storage 버킷은 그대로 재사용된다.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// anon(public) 키 — RLS 로 보호되어 클라이언트 노출이 안전하다.
// ⚠️ service_role(secret) 키는 절대 이 파일에 두지 말 것 (RLS 우회 → 전체 DB 노출).
const SUPABASE_URL = "https://durnojryhhsajnlwvdzt.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1cm5vanJ5aGhzYWpubHd2ZHp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNDkwMzAsImV4cCI6MjA5ODYyNTAzMH0.58S7heEpebOWFITj5tXymYtJMO79wDO8B_X39gDLWtw";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

// ── 인증 헬퍼 (이메일 + 비밀번호) ────────────────────
export const signUp = (email, password) => supabase.auth.signUp({ email, password });
export const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password });
export const signOut = () => supabase.auth.signOut();
