/**
 * Notification service for PWA push notifications and in-app toasts.
 * Handles both Web Push API and in-app toast notifications.
 */

export type NotificationType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  title: string;
  message?: string;
  type: NotificationType;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

/**
 * Request permission for push notifications.
 * Returns true if permission was granted or already exists.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) {
    console.warn("Notifications not supported");
    return false;
  }

  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  const permission = await Notification.requestPermission();
  return permission === "granted";
}

/**
 * Subscribe to push notifications via the service worker.
 */
export async function subscribeToPushNotifications(vapidKey: string): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    console.warn("Push notifications not supported");
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });

    // In production, send subscription to your backend
    console.log("Push subscription created:", subscription);
    return subscription;
  } catch (error) {
    console.error("Failed to subscribe to push notifications:", error);
    return null;
  }
}

/**
 * Show a desktop notification.
 */
export function showNotification(title: string, options?: NotificationOptions): void {
  if (Notification.permission === "granted") {
    new Notification(title, {
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      ...options,
    });
  }
}

/**
 * Convert VAPID key from base64 to Uint8Array.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Notify user of forecast completion.
 */
export function notifyForecastComplete(datasetName: string, targetColumn: string): void {
  showNotification(`Forecast Complete: ${datasetName}`, {
    body: `Prediction for ${targetColumn} is ready`,
    tag: "forecast-complete",
    requireInteraction: false,
  });
}

/**
 * Notify user of insights availability.
 */
export function notifyInsightsReady(forecastName: string): void {
  showNotification(`Business Insights Ready`, {
    body: `Analysis for ${forecastName} is available`,
    tag: "insights-ready",
    requireInteraction: false,
  });
}

/**
 * Notify user of sync/background operation completion.
 */
export function notifySync(message: string): void {
  showNotification(`Sync Complete`, {
    body: message,
    tag: "sync-complete",
    requireInteraction: false,
  });
}
