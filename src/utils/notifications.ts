/**
 * Utility for PWA & Browser Notifications
 */

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    return false;
  }
  if (Notification.permission === 'granted') {
    return true;
  }
  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }
  return false;
}

export function getNotificationPermissionState(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function triggerKickReminderNotification(wifeName = 'Діанка') {
  const title = 'Поштовхи 💕';
  const bodyText = `Доброго ранку! Не забудьте розпочати сьогоднішню сесію відліку поштовхів для ${wifeName} ✨`;

  if ('Notification' in window) {
    let permission = Notification.permission;
    if (permission === 'default') {
      const granted = await requestNotificationPermission();
      permission = granted ? 'granted' : 'denied';
    }

    if (permission === 'granted') {
      try {
        const options = {
          body: bodyText,
          icon: '/favicon.svg',
          badge: '/favicon.svg',
          tag: 'daily-kick-reminder'
        };

        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
          const registration = await navigator.serviceWorker.ready;
          await registration.showNotification(title, options);
        } else {
          new Notification(title, options);
        }
        return true;
      } catch (err) {
        console.warn('Failed to send native notification:', err);
      }
    }
  }

  // Fallback toast / alert if native notifications are not available
  alert(`🔔 ${title}\n${bodyText}`);
  return true;
}
