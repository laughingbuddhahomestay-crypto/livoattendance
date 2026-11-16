/**
 * Netlify Identity integration helper.
 * Uses window.netlifyIdentity provided by the official CDN widget in index.html.
 * Handles user invitations by email, password setting, and roles ('admin', 'manager').
 */

declare global {
  interface Window {
    netlifyIdentity?: any;
  }
}

export interface NetlifyUser {
  id: string;
  email: string;
  user_metadata?: {
    full_name?: string;
  };
  app_metadata?: {
    roles?: string[];
  };
  jwt: () => Promise<string>;
}

export function getNetlifyIdentity(): any | null {
  if (typeof window !== 'undefined' && window.netlifyIdentity) {
    return window.netlifyIdentity;
  }
  return null;
}

export function initNetlifyIdentity(onLogin?: (user: NetlifyUser) => void, onLogout?: () => void) {
  const ni = getNetlifyIdentity();
  if (!ni) return;

  try {
    ni.init();

    if (onLogin) {
      ni.on('login', (user: NetlifyUser) => {
        onLogin(user);
        ni.close();
      });
    }

    if (onLogout) {
      ni.on('logout', () => {
        onLogout();
      });
    }
  } catch (err) {
    console.warn('[IDENTITY] Netlify Identity init notice:', err);
  }
}

export function openIdentityModal(tab: 'login' | 'signup' = 'login') {
  const ni = getNetlifyIdentity();
  if (ni) {
    ni.open(tab);
  } else {
    console.warn('[IDENTITY] Netlify Identity widget is not loaded.');
  }
}

export function closeIdentityModal() {
  const ni = getNetlifyIdentity();
  if (ni) {
    ni.close();
  }
}

export function logoutIdentity() {
  const ni = getNetlifyIdentity();
  if (ni) {
    ni.logout();
  }
}
