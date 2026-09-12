import { useState } from "react";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { api, setToken } from "../lib/api.js";

const ROLE_LABELS = { admin: "an admin", kitchen: "a kitchen", service: "a service" };

export default function LoginGate({ onLogin, allowedRoles }) {
  const [email, setEmail] = useState("admin@millenium.local");
  const [password, setPassword] = useState("Admin@12345");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      const result = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });

      if (allowedRoles && !allowedRoles.includes(result.role)) {
        setError(
          `This is ${ROLE_LABELS[result.role] || "a"} account and can't sign in here. Use the ${result.role} page instead.`
        );
        return;
      }

      setToken(result.access_token, result.role);
      onLogin(result);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form className="login-card" onSubmit={submit}>
      <p className="eyebrow">Staff login</p>
      <h1>Sign in to continue</h1>
      <label>
        Email
        <input value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label>
        Password
        <span className="password-field">
          <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} />
          <button className="icon-button" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>
            {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </span>
      </label>
      {error && <p className="error-text">{error}</p>}
      <button className="button primary wide" type="submit">
        <LogIn size={18} />
        Sign in
      </button>
    </form>
  );
}
