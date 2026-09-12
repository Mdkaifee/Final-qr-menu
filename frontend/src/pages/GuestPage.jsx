import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, CreditCard, Minus, Plus, ReceiptText, Send } from "lucide-react";
import NotificationCenter from "../components/NotificationCenter.jsx";
import { api, money, paymentStateLabel, wsUrl } from "../lib/api.js";
import { useScrollReveal } from "../lib/reveal.js";

let razorpayScriptPromise = null;
function loadRazorpayScript() {
  if (window.Razorpay) return Promise.resolve();
  if (!razorpayScriptPromise) {
    razorpayScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load the payment page. Check your connection and try again."));
      document.body.appendChild(script);
    });
  }
  return razorpayScriptPromise;
}

export default function GuestPage() {
  const { qrToken } = useParams();
  const [session, setSession] = useState(null);
  const [menu, setMenu] = useState([]);
  const [cart, setCart] = useState({});
  const [selectedOptions, setSelectedOptions] = useState({});
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [payingOnline, setPayingOnline] = useState(false);
  const [message, setMessage] = useState("");

  useScrollReveal();

  useEffect(() => {
    let ignore = false;

    async function boot() {
      setLoading(true);
      try {
        const [sessionData, menuData] = await Promise.all([
          api(`/api/guest/qr/${qrToken}/session`, { method: "POST" }),
          api("/api/guest/menu")
        ]);
        if (!ignore) {
          setSession(sessionData);
          setMenu(menuData);
          refreshSession(sessionData.session_id);
        }
      } catch (error) {
        if (!ignore) setMessage(error.message);
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    boot();
    return () => {
      ignore = true;
    };
  }, [qrToken]);

  useEffect(() => {
    if (!session?.session_id) return;

    const socket = new WebSocket(wsUrl(`/ws/sessions/${session.session_id}`));
    socket.onmessage = () => refreshSession();
    return () => socket.close();
  }, [session?.session_id]);

  const menuItems = useMemo(() => menu.flatMap((category) => category.items), [menu]);
  const cartLines = Object.values(cart)
    .map((line) => ({ ...line, item: menuItems.find((entry) => entry.id === line.menu_item_id) }))
    .filter((line) => line.item);
  const total = cartLines.reduce((sum, line) => sum + getLineUnitPrice(line.item, line.modifier_option_ids) * line.quantity, 0);
  const sessionTotal = Number(session?.summary?.total_amount || 0);
  const paymentState = session?.summary?.payment_state || session?.payment_state;
  const billingLocked = paymentState !== "open";
  const sessionOrders = session?.summary?.orders || [];
  const pendingOrders = sessionOrders.filter((order) => order.status !== "served");
  const allOrdersServed = sessionOrders.length > 0 && pendingOrders.length === 0;
  const canRequestBill = paymentState === "open" && sessionTotal > 0 && cartLines.length === 0 && allOrdersServed;
  const billButtonHint = getBillButtonHint({ canRequestBill, cartLines, sessionTotal, pendingOrders });

  function selectOption(item, group, option) {
    setSelectedOptions((current) => {
      const itemSelection = { ...(current[item.id] || {}) };
      const selectedForGroup = new Set(itemSelection[group.id] || []);

      if (group.max_select === 1) {
        itemSelection[group.id] = [option.id];
      } else if (selectedForGroup.has(option.id)) {
        selectedForGroup.delete(option.id);
        itemSelection[group.id] = Array.from(selectedForGroup);
      } else if (selectedForGroup.size < group.max_select) {
        selectedForGroup.add(option.id);
        itemSelection[group.id] = Array.from(selectedForGroup);
      }

      return { ...current, [item.id]: itemSelection };
    });
  }

  function getSelectedOptionIds(item) {
    return Object.values(selectedOptions[item.id] || {}).flat().sort((a, b) => a - b);
  }

  function getCartKey(item, optionIds = getSelectedOptionIds(item)) {
    return `${item.id}:${optionIds.join(".")}`;
  }

  function validateRequiredModifiers(item) {
    for (const group of item.modifier_groups || []) {
      if (!group.is_active) continue;
      const count = (selectedOptions[item.id]?.[group.id] || []).length;
      if (group.is_required && count < Math.max(group.min_select, 1)) {
        setMessage(`Please select ${group.name} for ${item.name}.`);
        return false;
      }
      if (count < group.min_select || count > group.max_select) {
        setMessage(`Select between ${group.min_select} and ${group.max_select} options for ${group.name}.`);
        return false;
      }
    }
    return true;
  }

  function addItem(item) {
    if (billingLocked) {
      setMessage("Final bill has already been requested for this visit.");
      return;
    }
    if (!validateRequiredModifiers(item)) return;
    const optionIds = getSelectedOptionIds(item);
    const key = getCartKey(item, optionIds);
    setCart((current) => ({
      ...current,
      [key]: {
        menu_item_id: item.id,
        modifier_option_ids: optionIds,
        quantity: (current[key]?.quantity || 0) + 1
      }
    }));
  }

  function removeLine(line) {
    const key = getCartKey(line.item, line.modifier_option_ids);
    setCart((current) => {
      const next = { ...current };
      next[key] = { ...next[key], quantity: next[key].quantity - 1 };
      if (next[key].quantity <= 0) delete next[key];
      return next;
    });
  }

  async function refreshSession(sessionId = session?.session_id) {
    if (!sessionId) return;
    const next = await api(`/api/guest/sessions/${sessionId}`);
    setSession((current) => ({ ...current, summary: next }));
  }

  async function submitOrder() {
    if (!session?.session_id || cartLines.length === 0 || submitting || billingLocked) return;
    setSubmitting(true);
    try {
      const order = await api(`/api/guest/sessions/${session.session_id}/orders`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          customer_note: note,
          items: cartLines.map((line) => ({
            menu_item_id: line.item.id,
            quantity: line.quantity,
            note: "",
            modifier_option_ids: line.modifier_option_ids
          }))
        })
      });

      setMessage(`Order ${order.reference} sent to kitchen.`);
      setCart({});
      setNote("");
      await refreshSession();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function requestBill() {
    if (!session?.session_id) return;
    if (cartLines.length > 0) {
      setMessage("Send the current order first, then request the final bill once.");
      return;
    }
    try {
      const summary = await api(`/api/guest/sessions/${session.session_id}/bill-request`, { method: "POST" });
      setSession((current) => ({ ...current, payment_state: summary.payment_state, summary }));
      setCart({});
      setNote("");
      setMessage("Final bill request sent. This covers every order in this visit.");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function payOnline() {
    if (!session?.session_id || payingOnline) return;
    setPayingOnline(true);
    try {
      const order = await api(`/api/guest/sessions/${session.session_id}/payment/razorpay-order`, { method: "POST" });
      await loadRazorpayScript();
      const checkout = new window.Razorpay({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        order_id: order.order_id,
        name: "Millenium Aqeeq",
        description: `Table ${session.table.label}`,
        handler: async (response) => {
          try {
            const summary = await api(`/api/guest/sessions/${session.session_id}/payment/razorpay-verify`, {
              method: "POST",
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature
              })
            });
            setSession((current) => ({ ...current, summary }));
            setMessage("Payment received. Thank you!");
          } catch (error) {
            setMessage(error.message);
          }
        },
        modal: { ondismiss: () => setPayingOnline(false) },
        theme: { color: "#145c4f" }
      });
      checkout.open();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setPayingOnline(false);
    }
  }


  if (loading) {
    return <main className="page"><div className="empty-state">Opening QR session...</div></main>;
  }

  if (!session) {
    return <main className="page"><div className="empty-state error">{message || "QR is unavailable."}</div></main>;
  }

  return (
    <main className="page guest-layout">
      <section className="menu-panel">
        <div className="section-head focus-in">
          <div>
            <p className="eyebrow">{session.table.location}</p>
            <h1>{session.table.label}</h1>
          </div>
          <span className="pill">Session #{session.session_id}</span>
        </div>

        {menu.map((category) => (
          <section className="menu-section" key={category.id}>
            <h2>{category.name}</h2>
            <div className="menu-items">
              {category.items.filter((item) => item.is_active).map((item) => {
                const quantity = cart[getCartKey(item)]?.quantity || 0;
                const totalInCart = Object.values(cart)
                  .filter((line) => line.menu_item_id === item.id)
                  .reduce((sum, line) => sum + line.quantity, 0);
                const atStockLimit = item.stock_quantity !== null && item.stock_quantity !== undefined && totalInCart >= item.stock_quantity;
                const cannotOrder = !item.is_available || atStockLimit || billingLocked;
                return (
                  <article className={cannotOrder ? "disabled" : ""} key={item.id}>
                    <div>
                      <h3>{item.name}</h3>
                      <p>{item.description}</p>
                      <strong>{money(item.price)}</strong>
                      {billingLocked && <span className="stock-note">Final bill requested</span>}
                      {item.is_available && item.stock_quantity !== null && item.stock_quantity !== undefined && (
                        <span className="stock-note">{Math.max(item.stock_quantity - totalInCart, 0)} left</span>
                      )}
                      <ModifierGroups item={item} selectedOptions={selectedOptions} onSelect={selectOption} />
                    </div>
                    <div className={quantity > 0 ? "stepper" : "stepper single-action"}>
                      {quantity > 0 && (
                        <button
                          onClick={() => removeLine({ item, modifier_option_ids: getSelectedOptionIds(item) })}
                          aria-label={`Remove ${item.name}`}
                          type="button"
                        >
                          <Minus size={16} />
                        </button>
                      )}
                      {quantity > 0 && <span className="stepper-count">{quantity}</span>}
                      <button onClick={() => addItem(item)} disabled={cannotOrder} aria-label={`Add ${item.name}`} type="button">
                        <Plus size={16} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </section>

      <aside className="cart-panel focus-in delay-1">
        <div className="cart-panel-head">
          <h2>Your order</h2>
          <span className={paymentState === "paid" ? "pill" : paymentState === "bill_requested" ? "pill status-info" : "pill neutral"}>
            {paymentStateLabel(paymentState)}
          </span>
        </div>
        {cartLines.length === 0 ? (
          <p className="muted">{billingLocked ? "Ordering is closed for this visit." : "Add items from the menu."}</p>
        ) : (
          <div className="cart-lines">
            {cartLines.map((line) => (
              <div key={getCartKey(line.item, line.modifier_option_ids)}>
                <span>
                  {line.quantity} x {line.item.name}
                  <small>{formatSelectedOptions(line.item, line.modifier_option_ids)}</small>
                </span>
                <strong>{money(getLineUnitPrice(line.item, line.modifier_option_ids) * line.quantity)}</strong>
                <button className="icon-mini" onClick={() => removeLine(line)} aria-label="Remove line">
                  <Minus size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Order note" disabled={billingLocked} />
        {cartLines.length > 0 && (
          <div className="cart-total">
            <span>This order</span>
            <strong>{money(total)}</strong>
          </div>
        )}
        <button className="button primary wide" onClick={submitOrder} disabled={!cartLines.length || submitting || billingLocked}>
          <Send size={18} />
          {submitting ? "Sending..." : "Send order"}
        </button>

        <div className="session-total-block">
          <div className="cart-total session-total">
            <span>Session total so far</span>
            <strong>{money(sessionTotal)}</strong>
          </div>
          <p className="field-help">
            {paymentState === "paid"
              ? "Payment is complete. Thank you."
              : paymentState === "bill_requested"
                ? "Final bill requested — this covers every order from this visit, all at once. New ordering is now closed for this session."
                : cartLines.length > 0
                  ? "Send the current order before requesting the final bill."
                  : allOrdersServed
                    ? "All orders are served. You can request the final bill when you are done ordering."
                    : "Request final bill will unlock after every order has been served."}
          </p>
          <button
            className="button secondary wide"
            onClick={requestBill}
            disabled={!canRequestBill}
            title={billButtonHint}
          >
            <ReceiptText size={18} />
            Request final bill
          </button>
          {!canRequestBill && !billingLocked && billButtonHint && <p className="note-line">{billButtonHint}</p>}
          {paymentState === "bill_requested" && (
            <button className="button primary wide" onClick={payOnline} disabled={payingOnline} type="button">
              <CreditCard size={18} />
              {payingOnline ? "Opening payment..." : "Pay now"}
            </button>
          )}
        </div>
        <NotificationCenter
          fetchPath={`/api/push/notifications/session/${session.session_id}`}
          subscribePath={`/api/push/subscribe/session/${session.session_id}`}
          wide
        />
        {message && <p className="success"><CheckCircle2 size={16} />{message}</p>}
        <OrderStatus summary={session.summary} />
      </aside>
    </main>
  );
}

function ModifierGroups({ item, selectedOptions, onSelect }) {
  if (!item.modifier_groups?.length) return null;

  return (
    <div className="modifier-groups">
      {item.modifier_groups.filter((group) => group.is_active).map((group) => (
        <fieldset key={group.id}>
          <legend>{group.name}{group.is_required ? " required" : ""}</legend>
          <div className="modifier-options">
            {group.options.filter((option) => option.is_active).map((option) => {
              const selected = (selectedOptions[item.id]?.[group.id] || []).includes(option.id);
              return (
                <button
                  className={selected ? "selected" : ""}
                  key={option.id}
                  onClick={() => onSelect(item, group, option)}
                  type="button"
                >
                  {option.name}
                  {Number(option.price_delta) > 0 ? ` +${money(option.price_delta)}` : ""}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function getLineUnitPrice(item, optionIds) {
  const options = getOptions(item, optionIds);
  return Number(item.price) + options.reduce((sum, option) => sum + Number(option.price_delta), 0);
}

function getOptions(item, optionIds) {
  const allOptions = (item.modifier_groups || []).flatMap((group) => group.options || []);
  return optionIds.map((id) => allOptions.find((option) => option.id === id)).filter(Boolean);
}

function formatSelectedOptions(item, optionIds) {
  const names = getOptions(item, optionIds).map((option) => option.name);
  return names.length ? names.join(", ") : "No modifiers";
}

function getBillButtonHint({ canRequestBill, cartLines, sessionTotal, pendingOrders }) {
  if (canRequestBill) return "";
  if (cartLines.length > 0) return "Send the current order first.";
  if (sessionTotal <= 0) return "Nothing to bill yet — add and send an order first.";
  if (pendingOrders.length > 0) {
    return `${pendingOrders.length} order${pendingOrders.length === 1 ? "" : "s"} still need${pendingOrders.length === 1 ? "s" : ""} to be served before final bill.`;
  }
  return "";
}

const ORDER_STATUS_PILL = {
  placed: "pill neutral",
  confirmed: "pill status-info",
  preparing: "pill status-info",
  ready: "pill status-info",
  ready_to_serve: "pill status-info",
  served: "pill",
  cancelled: "pill danger"
};

function OrderStatus({ summary }) {
  if (!summary?.orders?.length) return null;

  return (
    <section className="status-list">
      <h3>Order status</h3>
      {summary.orders.map((order) => (
        <div className="status-card" key={order.id}>
          <div className="status-card-head">
            <span>{order.reference}</span>
            <span className={ORDER_STATUS_PILL[order.status] || "pill neutral"}>{order.status.replaceAll("_", " ")}</span>
          </div>
          {order.items.map((item) => (
            <p key={item.id}>
              {item.quantity} x {item.name_snapshot}
              {item.modifiers?.length ? ` · ${item.modifiers.map((modifier) => modifier.option_name_snapshot).join(", ")}` : ""}
            </p>
          ))}
          {order.customer_note && <p className="note-line">Note: {order.customer_note}</p>}
        </div>
      ))}
    </section>
  );
}
