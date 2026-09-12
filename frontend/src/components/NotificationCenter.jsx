import { useEffect, useRef, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { api } from "../lib/api.js";
import { disablePush, enablePush, getPushSubscription } from "../lib/push.js";

export default function NotificationCenter({ fetchPath, subscribePath, wide = false }) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    getPushSubscription()
      .then((subscription) => setEnabled(Boolean(subscription)))
      .catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    function onDocumentClick(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, []);

  async function loadNotifications() {
    try {
      setItems(await api(fetchPath));
    } catch (err) {
      setNotice(err.message);
    }
  }

  async function handleBellClick() {
    const willOpen = !open;
    setOpen(willOpen);
    if (!willOpen) return;

    await loadNotifications();
    // The bell itself is the "turn it on" action - clicking it is the obvious thing to do,
    // so don't make people also hunt for a separate switch inside the panel to actually enable it.
    if (!enabled) await doEnable();
  }

  async function doEnable() {
    setBusy(true);
    setNotice("");
    try {
      await enablePush(subscribePath);
      setEnabled(true);
      setNotice("Notifications turned on for this device.");
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(event) {
    event.stopPropagation();
    if (!enabled) {
      await doEnable();
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      await disablePush();
      setEnabled(false);
      setNotice("Notifications turned off on this device.");
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="notification-center" ref={containerRef}>
      <button className={`button secondary${wide ? " wide" : ""}`} type="button" onClick={handleBellClick}>
        {enabled ? <Bell size={18} /> : <BellOff size={18} />}
        Notifications
      </button>

      {open && (
        <div className="notification-panel">
          <div className="notification-panel-head">
            <strong>Notifications</strong>
            <label className="inline-toggle notification-toggle">
              <input type="checkbox" checked={enabled} disabled={busy} onChange={toggleEnabled} />
              {enabled ? "On" : "Off"}
            </label>
          </div>
          {notice && <p className="field-help notification-notice">{notice}</p>}
          <div className="notification-list">
            {items.length === 0 && <p className="muted">No notifications yet.</p>}
            {items.map((item) => (
              <div key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </div>
                <small>{new Date(item.created_at).toLocaleString()}</small>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
