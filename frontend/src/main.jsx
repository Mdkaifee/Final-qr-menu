import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./pages/AppShell.jsx";
import AdminPage from "./pages/AdminPage.jsx";
import GuestPage from "./pages/GuestPage.jsx";
import HomePage from "./pages/HomePage.jsx";
import StaffPage from "./pages/StaffPage.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="/qr/:qrToken" element={<GuestPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/kitchen" element={<StaffPage mode="kitchen" />} />
          <Route path="/service" element={<StaffPage mode="service" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
