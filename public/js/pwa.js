// Phone app (installable PWA) + phone notifications (Web Push).
import { api } from './lib.js';

export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isMobile = () => isIOS() || /android|mobile/i.test(navigator.userAgent);
export const isMac = () => /Macintosh|Mac OS X/.test(navigator.userAgent) && !isIOS();
const flag = (on) => { try { on ? localStorage.setItem('cs-push', '1') : localStorage.removeItem('cs-push'); } catch {} };
export const pushOnHere = () => { try { return localStorage.getItem('cs-push') === '1'; } catch { return false; } };
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

let installPrompt = null; // Android/desktop Chrome "Install app" prompt
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
export const canPromptInstall = () => !!installPrompt;
export async function promptInstall() {
  if (!installPrompt) return false;
  installPrompt.prompt();
  const r = await installPrompt.userChoice;
  installPrompt = null;
  return r.outcome === 'accepted';
}

export async function registerSW(onOpenLink) {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'open') onOpenLink?.(e.data.link);
    });
    // keep this device's subscription fresh if notifications were already allowed
    if (pushSupported() && Notification.permission === 'granted') enablePush({ silent: true }).catch(() => {});
  } catch (err) { console.warn('Service worker failed', err); }
}

function urlB64ToUint8Array(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function pushStatus() {
  if (!pushSupported()) return { supported: false };
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg && await reg.pushManager.getSubscription();
  flag(!!sub && Notification.permission === 'granted');
  return { supported: true, permission: Notification.permission, subscribed: !!sub };
}

export async function enablePush({ silent = false } = {}) {
  if (!pushSupported()) throw new Error(isIOS() && !isStandalone() ? 'On iPhone, first add the app to your Home Screen, then open it from there.' : 'This browser does not support notifications — use Chrome, Edge or Safari.');
  const perm = Notification.permission === 'granted' ? 'granted' : silent ? Notification.permission : await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked — see “How to fix” under Profile → Notifications.');
  const { key } = await api('/push/key');
  const sub = await subscribeWithRetry(key);
  const device = `${isIOS() ? 'iPhone/iPad' : /android/i.test(navigator.userAgent) ? 'Android' : isMac() ? 'Mac' : /Windows/.test(navigator.userAgent) ? 'Windows PC' : 'Computer'}${isStandalone() ? ' app' : ' browser'}`;
  const r = await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), device } });
  flag(true);
  return r;
}

const sameKey = (sub, key) => {
  const k = sub?.options?.applicationServerKey;
  if (!k) return true; // can't tell — keep it
  const a = new Uint8Array(k), b = urlB64ToUint8Array(key);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};
// Subscribing sometimes fails with "push service error" (a stale registration from an earlier try,
// or the browser couldn't reach its push service). Clear the old registration and try again before giving up.
async function subscribeWithRetry(key) {
  const opts = { userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) };
  let reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && sameKey(sub, key)) return sub;
  if (sub) await sub.unsubscribe().catch(() => {});
  try { return await reg.pushManager.subscribe(opts); } catch (first) {
    console.warn('Push subscribe failed, retrying with a fresh service worker', first);
    try {
      const old = await reg.pushManager.getSubscription();
      if (old) await old.unsubscribe().catch(() => {});
      await reg.unregister();
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      reg = await navigator.serviceWorker.ready;
      await new Promise((r) => setTimeout(r, 800));
      return await reg.pushManager.subscribe(opts);
    } catch (second) {
      throw new Error(pushHelp(second));
    }
  }
}
function pushHelp(err) {
  const ua = navigator.userAgent;
  const msg = String(err?.message || err);
  if (navigator.brave) return 'Brave blocks these alerts by default: open brave://settings/privacy, turn on "Use Google services for push messaging", restart Brave and try again.';
  if (/Edg\//.test(ua)) return `Edge couldn't reach its notification service (${msg}). Check that a VPN, ad-blocker or firewall isn't blocking it, restart Edge, then try again — or use Chrome.`;
  if (/Chrome\//.test(ua) && !/OPR|Arc/.test(ua)) return `Chrome couldn't reach Google's notification service (${msg}). Turn off any VPN/ad-blocker for a moment, quit Chrome completely (⌘Q / close all windows), reopen and try again.`;
  if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return `Safari couldn't set up alerts (${msg}). Make sure macOS is up to date and Safari → Settings → Websites → Notifications allows this site, then try again.`;
  return `This browser couldn't set up alerts (${msg}). Try Chrome or Safari.`;
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg && await reg.pushManager.getSubscription();
  if (sub) {
    await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  }
  flag(false);
}
