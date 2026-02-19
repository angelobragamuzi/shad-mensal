"use client";

export type SessionNotificationTone = "info" | "success" | "error";

export interface SessionNotification {
  id: string;
  message: string;
  tone: SessionNotificationTone;
  createdAt: string;
}

export interface SessionNotificationInput {
  message: string;
  tone?: SessionNotificationTone;
}

export const SESSION_NOTIFICATION_EVENT = "shad-session-notification";
export const SESSION_NOTIFICATION_STORAGE_KEY = "shad-session-notifications";

const MAX_SESSION_NOTIFICATIONS = 60;

function buildNotificationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function buildSessionNotification(input: SessionNotificationInput): SessionNotification {
  return {
    id: buildNotificationId(),
    message: input.message.trim(),
    tone: input.tone ?? "info",
    createdAt: new Date().toISOString(),
  };
}

export function loadSessionNotifications(): SessionNotification[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(SESSION_NOTIFICATION_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SessionNotification[] | null;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => Boolean(item?.id) && Boolean(item?.message) && Boolean(item?.createdAt))
      .slice(0, MAX_SESSION_NOTIFICATIONS);
  } catch {
    return [];
  }
}

export function saveSessionNotifications(items: SessionNotification[]): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    SESSION_NOTIFICATION_STORAGE_KEY,
    JSON.stringify(items.slice(0, MAX_SESSION_NOTIFICATIONS))
  );
}

export function clearSessionNotifications(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(SESSION_NOTIFICATION_STORAGE_KEY);
}

export function emitSessionNotification(input: SessionNotificationInput): void {
  if (typeof window === "undefined") return;

  const next = buildSessionNotification(input);
  const current = loadSessionNotifications();
  saveSessionNotifications([next, ...current]);

  window.dispatchEvent(
    new CustomEvent<SessionNotification>(SESSION_NOTIFICATION_EVENT, {
      detail: next,
    })
  );
}
