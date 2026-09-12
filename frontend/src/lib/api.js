const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || "ws://localhost:8000";
const TOKEN_KEY = "millenium_admin_token";
const ROLE_KEY = "millenium_admin_role";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRole() {
  return localStorage.getItem(ROLE_KEY);
}

export function setToken(token, role) {
  localStorage.setItem(TOKEN_KEY, token);
  if (role) localStorage.setItem(ROLE_KEY, role);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
}

export const ROLE_HOME_PATH = {
  admin: "/admin",
  kitchen: "/kitchen",
  service: "/service"
};

export function wsUrl(path) {
  return `${WS_BASE_URL}${path}`;
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getToken();

  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(error.detail || "Request failed");
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export function money(value) {
  return `SAR ${Number(value || 0).toFixed(2)}`;
}

const PAYMENT_STATE_LABELS = {
  open: "Open",
  bill_requested: "Payment pending",
  paid: "Paid"
};

export function paymentStateLabel(state) {
  return PAYMENT_STATE_LABELS[state] || state;
}
