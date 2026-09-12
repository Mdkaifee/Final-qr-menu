import { NavLink, Outlet } from "react-router-dom";
import { Building2, ChefHat, LayoutDashboard, QrCode, Utensils } from "lucide-react";
import { useScrollReveal } from "../lib/reveal.js";

export default function AppShell() {
  // Safety net: every route renders inside this shell, so scroll-reveal keeps working
  // even if an individual page forgets to call the hook itself.
  useScrollReveal();

  return (
    <div className="app">
      <header className="app-header">
        <NavLink className="brand" to="/">
          <span className="brand-mark"><Building2 size={21} /></span>
          <span>
            <strong>Millenium Aqeeq</strong>
            <small>Hotel QR Dining</small>
          </span>
        </NavLink>
        <nav>
          <NavLink to="/qr/MAH-TABLE-12">
            <QrCode size={16} />
            Guest
          </NavLink>
          <NavLink to="/admin">
            <LayoutDashboard size={16} />
            Admin
          </NavLink>
          <NavLink to="/kitchen">
            <ChefHat size={16} />
            Kitchen
          </NavLink>
          <NavLink to="/service">
            <Utensils size={16} />
            Service
          </NavLink>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
