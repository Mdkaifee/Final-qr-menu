import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import LoginGate from "../components/LoginGate.jsx";
import { getRole, getToken, ROLE_HOME_PATH } from "../lib/api.js";

export default function HomePage() {
  const navigate = useNavigate();
  const [checkedSession, setCheckedSession] = useState(false);

  useEffect(() => {
    const token = getToken();
    const role = getRole();
    if (token && role && ROLE_HOME_PATH[role]) {
      navigate(ROLE_HOME_PATH[role], { replace: true });
      return;
    }
    setCheckedSession(true);
  }, [navigate]);

  // Avoid flashing the login form for an instant before the redirect above fires.
  if (!checkedSession) return null;

  return (
    <main className="page centered">
      <LoginGate onLogin={(result) => navigate(ROLE_HOME_PATH[result.role] || "/", { replace: true })} />
    </main>
  );
}
