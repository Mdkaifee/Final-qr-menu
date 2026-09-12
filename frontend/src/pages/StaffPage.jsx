import { useEffect, useMemo, useState } from "react";
import { CreditCard, Power, RefreshCw } from "lucide-react";
import ConfirmModal from "../components/ConfirmModal.jsx";
import LoginGate from "../components/LoginGate.jsx";
import NotificationCenter from "../components/NotificationCenter.jsx";
import { api, clearToken, getToken, money, paymentStateLabel, wsUrl } from "../lib/api.js";
import { useScrollReveal } from "../lib/reveal.js";

const labels = {
  kitchen: {
    title: "Kitchen order board",
    statuses: ["placed", "confirmed", "preparing", "ready"],
    actions: {
      placed: "confirmed",
      confirmed: "preparing",
      preparing: "ready"
    }
  },
  service: {
    title: "Service order board",
    statuses: ["ready", "ready_to_serve", "served"],
    actions: {
      ready: "ready_to_serve",
      ready_to_serve: "served"
    }
  }
};

export default function StaffPage({ mode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(Boolean(getToken()));
  const [orders, setOrders] = useState([]);
  const [tables, setTables] = useState([]);
  const [tableFilter, setTableFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [billableSessions, setBillableSessions] = useState([]);
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [billingMessage, setBillingMessage] = useState("");
  const config = labels[mode];
  const canBill = mode === "service";

  useScrollReveal();

  useEffect(() => {
    if (!isLoggedIn) return;
    refresh();
    api("/api/staff/tables").then(setTables).catch(() => setTables([]));
    if (canBill) refreshSessions();
    const socket = new WebSocket(wsUrl("/ws/orders"));
    socket.onmessage = () => {
      refresh();
      if (canBill) refreshSessions();
    };
    return () => socket.close();
  }, [isLoggedIn, mode, tableFilter, statusFilter]);

  async function refreshSessions() {
    try {
      const data = await api("/api/staff/sessions");
      // Only sessions the guest has actually asked to pay - not "open" ones, since the
      // guest may still be ordering more and staff shouldn't be able to close those out.
      setBillableSessions(data.filter((session) => session.payment_state === "bill_requested"));
    } catch (err) {
      setBillingMessage(err.message);
    }
  }

  function logout() {
    clearToken();
    setIsLoggedIn(false);
  }

  function confirmMarkPaid(session) {
    setConfirmAction({
      title: "Mark session paid",
      message: `Session #${session.id} for ${session.table.label} (${money(session.total_amount)}) will be closed as paid, consolidating every order placed in this visit.`,
      confirmLabel: "Mark paid",
      action: session
    });
  }

  async function runMarkPaid() {
    const session = confirmAction?.action;
    setConfirmAction(null);
    if (!session) return;
    try {
      await api(`/api/staff/sessions/${session.id}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount: session.total_amount, method: "cash" })
      });
      setBillingMessage(`Session #${session.id} marked paid and closed.`);
      await refreshSessions();
    } catch (err) {
      setBillingMessage(err.message);
    }
  }

  const visibleOrders = useMemo(
    () => orders.filter((order) => config.statuses.includes(order.status)),
    [orders, config.statuses]
  );
  const billableBySessionId = useMemo(
    () => new Map(billableSessions.map((session) => [session.id, session])),
    [billableSessions]
  );

  async function refresh() {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status_filter", statusFilter);
    if (tableFilter) params.set("table_id", tableFilter);
    const data = await api(`/api/staff/orders${params.toString() ? `?${params}` : ""}`);
    setOrders(data);
  }

  async function move(order) {
    const nextStatus = config.actions[order.status];
    if (!nextStatus) return;

    await api(`/api/staff/orders/${order.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({
        status: nextStatus,
        note: `${mode} updated status`
      })
    });
    await refresh();
  }

  if (!isLoggedIn) {
    return <main className="page centered"><LoginGate onLogin={() => setIsLoggedIn(true)} allowedRoles={["admin", "kitchen", "service"]} /></main>;
  }

  return (
    <main className="page">
      <div className="section-head focus-in">
        <div>
          <p className="eyebrow">{mode}</p>
          <h1>{config.title}</h1>
        </div>
        <div className="actions header-row">
          <div className="filter-group">
            <select value={tableFilter} onChange={(event) => setTableFilter(event.target.value)}>
              <option value="">All tables</option>
              {tables.map((table) => <option key={table.id} value={table.id}>{table.label}</option>)}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">All statuses</option>
              {config.statuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
            </select>
          </div>
          <div className="action-group">
            <button className="button secondary" onClick={refresh}>
              <RefreshCw size={18} />
              Refresh
            </button>
            <NotificationCenter fetchPath="/api/push/notifications/staff" subscribePath="/api/push/subscribe/staff" />
            <button className="button secondary" onClick={() => setConfirmingLogout(true)} type="button">
              <Power size={18} />
              Logout
            </button>
          </div>
        </div>
      </div>

      {billingMessage && <p className="success inline">{billingMessage}</p>}

      <section className="order-board">
        {config.statuses.map((status) => (
          <article className="panel" key={status}>
            <h2>{status.replaceAll("_", " ")}</h2>
            <div className="order-list">
              {visibleOrders.filter((order) => order.status === status).map((order) => {
                const billableSession = canBill && status === "served" ? billableBySessionId.get(order.session_id) : null;
                const paymentClass = order.session_payment_state === "paid" ? "pill" : order.session_payment_state === "bill_requested" ? "pill status-info" : "pill neutral";
                return (
                  <div className="order-card" key={order.id}>
                    <div className="section-head compact-head">
                      <strong>{order.reference}</strong>
                      <span>{money(order.total_amount)}</span>
                    </div>
                    <div className="order-meta-row">
                      <span className="pill">{order.table_label}</span>
                      <span className={paymentClass}>Payment: {paymentStateLabel(order.session_payment_state)}</span>
                    </div>
                    {order.items.map((item) => (
                      <p key={item.id}>
                        {item.quantity} x {item.name_snapshot}
                        {item.modifiers?.length ? ` · ${item.modifiers.map((modifier) => modifier.option_name_snapshot).join(", ")}` : ""}
                      </p>
                    ))}
                    {order.customer_note && <p className="note-line">Note: {order.customer_note}</p>}
                    {config.actions[order.status] && (
                      <button className="button primary wide" onClick={() => move(order)}>
                        Move to {config.actions[order.status].replaceAll("_", " ")}
                      </button>
                    )}
                    {billableSession && (
                      <button className="button secondary wide" type="button" onClick={() => confirmMarkPaid(billableSession)}>
                        <CreditCard size={16} />
                        Mark paid ({money(billableSession.total_amount)})
                      </button>
                    )}
                    {canBill && status === "served" && !billableSession && order.session_payment_state === "open" && (
                      <p className="note-line">Waiting for guest to request the final bill.</p>
                    )}
                    {canBill && status === "served" && order.session_payment_state === "paid" && (
                      <p className="note-line">Payment completed for this full session.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </section>

      {confirmAction && <ConfirmModal config={confirmAction} onCancel={() => setConfirmAction(null)} onConfirm={runMarkPaid} />}
      {confirmingLogout && (
        <ConfirmModal
          config={{
            title: "Log out?",
            message: "You will need to sign in again to make further changes.",
            confirmLabel: "Logout"
          }}
          onCancel={() => setConfirmingLogout(false)}
          onConfirm={() => {
            setConfirmingLogout(false);
            logout();
          }}
        />
      )}
    </main>
  );
}
