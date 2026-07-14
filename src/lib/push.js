// Web Push: tilmeld/afmeld denne browser til push-notifikationer.
// Abonnementet gemmes i Supabase-tabellen push_subscriptions (RLS: kun egne rækker);
// selve udsendelsen sker server-side i api/send-notifications.js.
import { db } from "./supabase.js";

function isPushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// iOS kræver at appen er føjet til hjemmeskærmen, før Web Push virker (iOS 16.4+)
function needsHomeScreenInstall() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  return isIos && !standalone;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try { return await navigator.serviceWorker.register("/sw.js"); } catch (e) { return null; }
}

async function getExistingSubscription() {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Slår notifikationer til: beder om tilladelse, abonnerer og gemmer i Supabase.
// Kaster en Error med en dansk besked, hvis noget forhindrer det.
async function enablePush(token, userId) {
  if (!isPushSupported()) throw new Error("Denne browser understøtter ikke notifikationer.");
  if (needsHomeScreenInstall()) throw new Error("Føj først appen til hjemmeskærmen (Del → Føj til hjemmeskærm), og slå så notifikationer til derfra.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifikationer blev ikke tilladt i browseren.");

  const reg = await registerServiceWorker();
  if (!reg) throw new Error("Kunne ikke starte notifikations-tjenesten.");
  await navigator.serviceWorker.ready;

  const keyRes = await fetch("/api/send-notifications?action=vapidKey");
  const { publicKey } = keyRes.ok ? await keyRes.json() : {};
  if (!publicKey) throw new Error("Notifikationer er ikke sat op på serveren endnu (VAPID-nøgle mangler).");

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const json = sub.toJSON();
  await db.upsert(token, "push_subscriptions", [{
    user_id: userId,
    endpoint: sub.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  }], "endpoint");
  return sub;
}

async function disablePush(token) {
  const sub = await getExistingSubscription();
  if (!sub) return;
  try { await db.del(token, "push_subscriptions", `endpoint=eq.${encodeURIComponent(sub.endpoint)}`); } catch (e) {}
  await sub.unsubscribe();
}

export { isPushSupported, needsHomeScreenInstall, registerServiceWorker, getExistingSubscription, enablePush, disablePush };
