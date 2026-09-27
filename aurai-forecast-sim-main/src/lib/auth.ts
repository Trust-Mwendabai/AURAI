// @ts-nocheck
import { api, getToken, setToken } from "@/lib/apiClient";

let cachedUser: any = null;

function toUser(u: any) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name || u.email?.split("@")[0],
    avatar_url: u.avatar_url,
    plan: u.plan,
    preferences: u.preferences,
  };
}

export function getCurrentUser(): any {
  return cachedUser;
}

export function isAuthed() {
  return !!cachedUser;
}

export async function refreshSession() {
  if (!getToken()) {
    cachedUser = null;
    return null;
  }
  try {
    const { user } = await api.get("/auth/me");
    cachedUser = toUser(user);
  } catch {
    setToken(null);
    cachedUser = null;
  }
  return cachedUser;
}

export async function initAuthListener() {
  await refreshSession();
}

export async function register(name: string, email: string, password: string) {
  const { token, user } = await api.post("/auth/register", { name, email, password });
  setToken(token);
  cachedUser = toUser(user);
  return getCurrentUser();
}

export async function login(email: string, password: string) {
  const { token, user } = await api.post("/auth/login", { email, password });
  setToken(token);
  cachedUser = toUser(user);
  return getCurrentUser();
}

export async function logout() {
  try {
    await api.post("/auth/logout");
  } catch {
    /* ignore */
  }
  setToken(null);
  cachedUser = null;
}

export async function requestPasswordReset(email: string) {
  await api.post("/auth/forgot-password", { email });
}

// Used by /reset-password, which is opened from the emailed link carrying
// ?email=&token= — there is no logged-in session at that point.
export async function resetPasswordWithToken(email: string, token: string, password: string) {
  await api.post("/auth/reset-password", { email, token, password });
}

export async function updatePassword(newPassword: string) {
  const { user } = await api.patch("/auth/profile", { password: newPassword });
  cachedUser = toUser(user);
}

export async function updateProfile(patch: any) {
  if (!cachedUser) return null;
  const { user } = await api.patch("/auth/profile", patch);
  cachedUser = toUser(user);
  return getCurrentUser();
}

// Legacy alias
export const resetPassword = requestPasswordReset;
