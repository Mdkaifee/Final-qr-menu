import { useEffect, useMemo, useState } from "react";
import {
  Clipboard,
  CreditCard,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Save,
  Trash2,
  X
} from "lucide-react";
import ConfirmModal from "../components/ConfirmModal.jsx";
import LoginGate from "../components/LoginGate.jsx";
import NotificationCenter from "../components/NotificationCenter.jsx";
import { api, clearToken, getToken, money, paymentStateLabel } from "../lib/api.js";
import { useScrollReveal } from "../lib/reveal.js";

const blankCategory = { name: "", display_order: 0, is_active: true };
const blankItem = {
  category_id: "",
  name: "",
  description: "",
  price: "",
  image_url: "",
  is_available: true,
  is_active: true,
  display_order: 0,
  stock_quantity: ""
};
const blankTable = { label: "", qr_token: "", location: "Restaurant", is_active: true };
const blankUser = { name: "", email: "", password: "", role: "service", is_active: true };
const blankModifier = {
  menu_item_id: "",
  name: "",
  min_select: 0,
  max_select: 1,
  is_required: false,
  is_active: true,
  display_order: 0,
  options: "Regular|0"
};

const adminTabs = [
  { id: "overview", label: "Overview" },
  { id: "menu", label: "Menu" },
  { id: "modifiers", label: "Modifiers" },
  { id: "qr", label: "QR mappings" },
  { id: "staff", label: "Staff users" },
  { id: "sessions", label: "Sessions" },
  { id: "sales", label: "Sales" }
];

const modalTitles = {
  category: ["Add category", "Edit category"],
  item: ["Add menu item", "Edit menu item"],
  modifier: ["Add item modifier", "Edit item modifier"],
  table: ["Add QR mapping", "Edit QR mapping"],
  user: ["Add staff user", "Edit staff user"]
};

export default function AdminPage() {
  const [isLoggedIn, setIsLoggedIn] = useState(Boolean(getToken()));
  const [activeTab, setActiveTab] = useState("overview");
  const [categories, setCategories] = useState([]);
  const [tables, setTables] = useState([]);
  const [locations, setLocations] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [users, setUsers] = useState([]);
  const [summary, setSummary] = useState(null);
  const [itemSales, setItemSales] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [sessionTableFilter, setSessionTableFilter] = useState("");
  const [sessionStatusFilter, setSessionStatusFilter] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [categoryForm, setCategoryForm] = useState(blankCategory);
  const [itemForm, setItemForm] = useState(blankItem);
  const [tableForm, setTableForm] = useState(blankTable);
  const [userForm, setUserForm] = useState(blankUser);
  const [modifierForm, setModifierForm] = useState(blankModifier);
  const [imageFile, setImageFile] = useState(null);

  useScrollReveal();

  useEffect(() => {
    if (isLoggedIn) {
      refresh().catch(handleRequestError);
    }
  }, [isLoggedIn]);

  const items = useMemo(
    () => categories.flatMap((category) => category.items.map((item) => ({ ...item, category: category.name }))),
    [categories]
  );
  const modifierGroups = useMemo(
    () => items.flatMap((item) => (item.modifier_groups || []).map((group) => ({ ...group, item_name: item.name }))),
    [items]
  );

  function handleRequestError(err) {
    const detail = err.message || "Action failed";
    if (["Authentication required", "Invalid token", "User not found", "Admin access required"].includes(detail)) {
      clearToken();
      setIsLoggedIn(false);
      setError("");
      setMessage("");
      return;
    }
    setError(detail);
  }

  async function runAction(action, successMessage) {
    setError("");
    try {
      await action();
      if (successMessage) setMessage(successMessage);
      await refresh();
    } catch (err) {
      handleRequestError(err);
    }
  }

  async function refresh() {
    const [categoryData, tableData, sessionData, userData, summaryData, itemSalesData, locationData] = await Promise.all([
      api("/api/admin/categories"),
      api("/api/admin/tables"),
      api("/api/admin/sessions"),
      api("/api/admin/users"),
      api("/api/admin/reports/summary"),
      api("/api/admin/reports/item-sales"),
      api("/api/admin/locations")
    ]);
    setCategories(categoryData);
    setTables(tableData);
    setSessions(sessionData);
    setUsers(userData);
    setSummary(summaryData);
    setItemSales(itemSalesData);
    setLocations(locationData);
  }

  function closeModal() {
    setModal(null);
    setImageFile(null);
    setCategoryForm(blankCategory);
    setItemForm(blankItem);
    setTableForm(blankTable);
    setUserForm(blankUser);
    setModifierForm(blankModifier);
  }

  function openAdd(type) {
    setError("");
    if (type === "category") setCategoryForm(blankCategory);
    if (type === "item") setItemForm(blankItem);
    if (type === "modifier") setModifierForm(blankModifier);
    if (type === "table") setTableForm(blankTable);
    if (type === "user") setUserForm(blankUser);
    setModal({ type, mode: "add" });
  }

  function openEdit(type, record) {
    setError("");
    if (type === "category") setCategoryForm({ ...record });
    if (type === "item") {
      setItemForm({
        ...record,
        price: record.price,
        image_url: record.image_url || "",
        stock_quantity: record.stock_quantity === null || record.stock_quantity === undefined ? "" : record.stock_quantity
      });
    }
    if (type === "modifier") {
      setModifierForm({
        ...record,
        options: record.options.map((option) => `${option.name}|${option.price_delta}`).join("\n")
      });
    }
    if (type === "table") setTableForm({ ...record });
    if (type === "user") setUserForm({ ...record, password: "" });
    setModal({ type, mode: "edit" });
  }

  function askConfirmation(config) {
    setConfirmAction(config);
  }

  async function confirmAndRun() {
    if (!confirmAction) return;
    const action = confirmAction.action;
    const successMessage = confirmAction.successMessage;
    setConfirmAction(null);
    await runAction(action, successMessage);
  }

  async function saveModal(event) {
    event.preventDefault();
    if (!modal) return;
    const actions = { category: saveCategory, item: saveItem, modifier: saveModifier, table: saveTable, user: saveUser };
    await actions[modal.type]();
  }

  async function saveCategory() {
    await runAction(async () => {
      const payload = {
        name: categoryForm.name,
        display_order: Number(categoryForm.display_order || 0),
        is_active: categoryForm.is_active
      };
      const path = categoryForm.id ? `/api/admin/categories/${categoryForm.id}` : "/api/admin/categories";
      await api(path, { method: categoryForm.id ? "PUT" : "POST", body: JSON.stringify(payload) });
      closeModal();
    }, "Category saved.");
  }

  async function saveItem() {
    await runAction(async () => {
      const payload = {
        category_id: Number(itemForm.category_id),
        name: itemForm.name,
        description: itemForm.description,
        price: String(itemForm.price),
        image_url: itemForm.image_url || null,
        is_available: itemForm.is_available,
        is_active: itemForm.is_active,
        display_order: Number(itemForm.display_order || 0),
        stock_quantity: itemForm.stock_quantity === "" ? null : Number(itemForm.stock_quantity)
      };
      const path = itemForm.id ? `/api/admin/items/${itemForm.id}` : "/api/admin/items";
      const saved = await api(path, { method: itemForm.id ? "PUT" : "POST", body: JSON.stringify(payload) });
      if (imageFile) {
        const formData = new FormData();
        formData.append("file", imageFile);
        await api(`/api/admin/items/${saved.id}/image`, { method: "POST", body: formData });
      }
      closeModal();
    }, "Menu item saved.");
  }

  async function saveModifier() {
    await runAction(async () => {
      const options = modifierForm.options
        .split("\n")
        .map((line, index) => {
          const [name, price = "0"] = line.split("|");
          return { name: name.trim(), price_delta: price.trim(), display_order: index + 1, is_active: true };
        })
        .filter((option) => option.name);
      const payload = {
        menu_item_id: Number(modifierForm.menu_item_id),
        name: modifierForm.name,
        min_select: Number(modifierForm.min_select),
        max_select: Number(modifierForm.max_select),
        is_required: modifierForm.is_required,
        is_active: modifierForm.is_active,
        display_order: Number(modifierForm.display_order || 0),
        options
      };
      const path = modifierForm.id ? `/api/admin/modifier-groups/${modifierForm.id}` : "/api/admin/modifier-groups";
      await api(path, { method: modifierForm.id ? "PUT" : "POST", body: JSON.stringify(payload) });
      closeModal();
    }, "Modifier group saved.");
  }

  async function saveTable() {
    await runAction(async () => {
      const payload = {
        label: tableForm.label,
        qr_token: tableForm.qr_token,
        location: tableForm.location,
        is_active: tableForm.is_active
      };
      const path = tableForm.id ? `/api/admin/tables/${tableForm.id}` : "/api/admin/tables";
      await api(path, { method: tableForm.id ? "PUT" : "POST", body: JSON.stringify(payload) });
      closeModal();
    }, "QR mapping saved.");
  }

  async function saveUser() {
    await runAction(async () => {
      const payload = {
        name: userForm.name,
        email: userForm.email,
        password: userForm.password,
        role: userForm.role,
        is_active: userForm.is_active
      };
      if (userForm.id && !payload.password) delete payload.password;
      const path = userForm.id ? `/api/admin/users/${userForm.id}` : "/api/admin/users";
      await api(path, { method: userForm.id ? "PUT" : "POST", body: JSON.stringify(payload) });
      closeModal();
    }, "User saved.");
  }

  function confirmCategoryToggle(category) {
    askConfirmation({
      title: `${category.is_active ? "Deactivate" : "Activate"} category`,
      message: `${category.name} will be ${category.is_active ? "hidden from guests" : "shown again"}.`,
      confirmLabel: category.is_active ? "Deactivate" : "Activate",
      danger: category.is_active,
      successMessage: `${category.name} ${category.is_active ? "deactivated" : "activated"}.`,
      action: () => api(`/api/admin/categories/${category.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: category.name, display_order: category.display_order, is_active: !category.is_active })
      })
    });
  }

  function confirmItemToggle(item) {
    askConfirmation({
      title: `${item.is_active ? "Deactivate" : "Activate"} menu item`,
      message: `${item.name} will be ${item.is_active ? "hidden from guests" : "shown again"}.`,
      confirmLabel: item.is_active ? "Deactivate" : "Activate",
      danger: item.is_active,
      successMessage: `${item.name} ${item.is_active ? "deactivated" : "activated"}.`,
      action: () => api(`/api/admin/items/${item.id}`, {
        method: "PUT",
        body: JSON.stringify({
          category_id: item.category_id,
          name: item.name,
          description: item.description,
          price: item.price,
          image_url: item.image_url,
          is_available: item.is_available,
          is_active: !item.is_active,
          display_order: item.display_order
        })
      })
    });
  }

  function confirmModifierToggle(group) {
    askConfirmation({
      title: `${group.is_active ? "Deactivate" : "Activate"} modifier`,
      message: `${group.name} will be ${group.is_active ? "hidden from item options" : "available again"}.`,
      confirmLabel: group.is_active ? "Deactivate" : "Activate",
      danger: group.is_active,
      successMessage: `${group.name} ${group.is_active ? "deactivated" : "activated"}.`,
      action: () => api(`/api/admin/modifier-groups/${group.id}`, {
        method: "PUT",
        body: JSON.stringify({
          menu_item_id: group.menu_item_id,
          name: group.name,
          min_select: group.min_select,
          max_select: group.max_select,
          is_required: group.is_required,
          display_order: group.display_order,
          is_active: !group.is_active,
          options: group.options.map((option) => ({
            name: option.name,
            price_delta: option.price_delta,
            is_active: option.is_active,
            display_order: option.display_order
          }))
        })
      })
    });
  }

  function confirmTableToggle(table) {
    askConfirmation({
      title: `${table.is_active ? "Deactivate" : "Activate"} QR mapping`,
      message: `${table.label} will be ${table.is_active ? "blocked for new guest scans" : "available for scans"}.`,
      confirmLabel: table.is_active ? "Deactivate" : "Activate",
      danger: table.is_active,
      successMessage: `${table.label} ${table.is_active ? "deactivated" : "activated"}.`,
      action: () => api(`/api/admin/tables/${table.id}`, {
        method: "PUT",
        body: JSON.stringify({ label: table.label, qr_token: table.qr_token, location: table.location, is_active: !table.is_active })
      })
    });
  }

  function confirmUserToggle(user) {
    askConfirmation({
      title: `${user.is_active ? "Deactivate" : "Activate"} staff user`,
      message: `${user.name} will ${user.is_active ? "no longer be able to sign in" : "be able to sign in again"}.`,
      confirmLabel: user.is_active ? "Deactivate" : "Activate",
      danger: user.is_active,
      successMessage: `${user.name} ${user.is_active ? "deactivated" : "activated"}.`,
      action: () => api(`/api/admin/users/${user.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: user.name, email: user.email, role: user.role, is_active: !user.is_active })
      })
    });
  }

  function confirmAvailability(item) {
    askConfirmation({
      title: item.is_available ? "Mark item sold out" : "Mark item available",
      message: `${item.name} will be ${item.is_available ? "unavailable for guest ordering" : "available for guest ordering"}.`,
      confirmLabel: item.is_available ? "Mark sold out" : "Mark available",
      danger: item.is_available,
      successMessage: `${item.name} is now ${item.is_available ? "sold out" : "available"}.`,
      action: () => api(`/api/admin/items/${item.id}/availability?is_available=${!item.is_available}`, { method: "PATCH" })
    });
  }

  function confirmDelete(type, record, path) {
    askConfirmation({
      title: `Delete ${type}`,
      message: `${record.name || record.label} will be permanently deleted if it has no protected history.`,
      confirmLabel: "Delete",
      danger: true,
      successMessage: `${record.name || record.label} deleted.`,
      action: () => api(path, { method: "DELETE" })
    });
  }

  function confirmPayment(session) {
    askConfirmation({
      title: "Mark session paid",
      message: `Session #${session.id} for ${session.table.label} will be closed as paid, consolidating every order placed in this visit.`,
      confirmLabel: "Mark paid",
      successMessage: `Session #${session.id} marked paid and closed.`,
      action: () => api(`/api/admin/sessions/${session.id}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount: session.total_amount, method: "cash" })
      })
    });
  }

  async function copyQrLink(table) {
    await navigator.clipboard.writeText(`${window.location.origin}/qr/${table.qr_token}`);
    setMessage(`Copied QR link for ${table.label}.`);
  }

  async function downloadCsv() {
    await runAction(async () => {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || "http://localhost:8000"}/api/admin/reports/item-sales.csv`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      if (response.status === 401 || response.status === 403) throw new Error("Invalid token");
      if (!response.ok) throw new Error("CSV download failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "item-sales.csv";
      link.click();
      URL.revokeObjectURL(url);
    }, "CSV downloaded.");
  }

  function logout() {
    clearToken();
    setIsLoggedIn(false);
  }

  function confirmLogout() {
    askConfirmation({
      title: "Log out?",
      message: "You will need to sign in again to make further changes.",
      confirmLabel: "Logout",
      action: () => logout()
    });
  }

  if (!isLoggedIn) {
    return <main className="page centered"><LoginGate onLogin={() => setIsLoggedIn(true)} allowedRoles={["admin"]} /></main>;
  }

  return (
    <main className="page admin-page">
      <div className="section-head focus-in">
        <div>
          <p className="eyebrow">Admin dashboard</p>
          <h1>Restaurant operations</h1>
        </div>
        <div className="actions">
          <NotificationCenter fetchPath="/api/push/notifications/staff" subscribePath="/api/push/subscribe/staff" />
          <button className="button secondary" onClick={downloadCsv} type="button"><Download size={18} />CSV</button>
          <button className="button secondary" onClick={() => runAction(refresh, "Dashboard refreshed.")} type="button"><RefreshCw size={18} />Refresh</button>
          <button className="button secondary" onClick={confirmLogout} type="button"><Power size={18} />Logout</button>
        </div>
      </div>

      {message && <p className="success inline">{message}</p>}
      {error && <p className="error-text panel-alert">{error}</p>}

      <nav className="admin-tabs" aria-label="Admin sections">
        {adminTabs.map((tab) => (
          <button key={tab.id} className={activeTab === tab.id ? "active" : ""} type="button" onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </nav>

      <TabActions activeTab={activeTab} openAdd={openAdd} />

      {activeTab === "overview" && <OverviewTab summary={summary} categories={categories} tables={tables} users={users} sessions={sessions} />}
      {activeTab === "menu" && (
        <MenuTab
          categories={categories}
          items={items}
          openEdit={openEdit}
          confirmCategoryToggle={confirmCategoryToggle}
          confirmItemToggle={confirmItemToggle}
          confirmAvailability={confirmAvailability}
          confirmDelete={confirmDelete}
        />
      )}
      {activeTab === "modifiers" && <ModifierTab modifierGroups={modifierGroups} openEdit={openEdit} confirmModifierToggle={confirmModifierToggle} confirmDelete={confirmDelete} />}
      {activeTab === "qr" && <QrTab tables={tables} openEdit={openEdit} confirmTableToggle={confirmTableToggle} confirmDelete={confirmDelete} copyQrLink={copyQrLink} />}
      {activeTab === "staff" && <StaffTab users={users} openEdit={openEdit} confirmUserToggle={confirmUserToggle} confirmDelete={confirmDelete} />}
      {activeTab === "sessions" && (
        <SessionsTab
          sessions={sessions}
          tables={tables}
          tableFilter={sessionTableFilter}
          setTableFilter={setSessionTableFilter}
          statusFilter={sessionStatusFilter}
          setStatusFilter={setSessionStatusFilter}
          selectedSession={selectedSession}
          setSelectedSession={setSelectedSession}
          confirmPayment={confirmPayment}
        />
      )}
      {activeTab === "sales" && <SalesTab itemSales={itemSales} />}

      {modal && (
        <AdminModal title={modalTitles[modal.type][modal.mode === "edit" ? 1 : 0]} onClose={closeModal} onSubmit={saveModal}>
          <ModalFields
            type={modal.type}
            mode={modal.mode}
            categories={categories}
            items={items}
            categoryForm={categoryForm}
            setCategoryForm={setCategoryForm}
            itemForm={itemForm}
            setItemForm={setItemForm}
            setImageFile={setImageFile}
            modifierForm={modifierForm}
            setModifierForm={setModifierForm}
            tableForm={tableForm}
            setTableForm={setTableForm}
            locations={locations}
            userForm={userForm}
            setUserForm={setUserForm}
          />
        </AdminModal>
      )}

      {confirmAction && <ConfirmModal config={confirmAction} onCancel={() => setConfirmAction(null)} onConfirm={confirmAndRun} />}
    </main>
  );
}

function TabActions({ activeTab, openAdd }) {
  if (activeTab === "menu") {
    return (
      <section className="admin-addbar">
        <button className="button primary" type="button" onClick={() => openAdd("category")}><Plus size={18} />Add category</button>
        <button className="button primary" type="button" onClick={() => openAdd("item")}><Plus size={18} />Add menu item</button>
      </section>
    );
  }
  if (activeTab === "modifiers") {
    return <section className="admin-addbar"><button className="button primary" type="button" onClick={() => openAdd("modifier")}><Plus size={18} />Add modifier</button></section>;
  }
  if (activeTab === "qr") {
    return <section className="admin-addbar"><button className="button primary" type="button" onClick={() => openAdd("table")}><Plus size={18} />Add QR mapping</button></section>;
  }
  if (activeTab === "staff") {
    return <section className="admin-addbar"><button className="button primary" type="button" onClick={() => openAdd("user")}><Plus size={18} />Add staff user</button></section>;
  }
  return null;
}

function OverviewTab({ summary, categories, tables, users, sessions }) {
  return (
    <section className="admin-grid">
      <article className="panel wide-panel">
        <PanelTitle title="Overview" subtitle="Quick health check for the hotel QR ordering demo." />
        <ReportStrip summary={summary} />
        <div className="metric-grid">
          <Metric label="Categories" value={categories.length} />
          <Metric label="Menu items" value={categories.reduce((total, category) => total + category.items.length, 0)} />
          <Metric label="QR mappings" value={tables.length} />
          <Metric label="Staff users" value={users.length} />
          <Metric label="Active sessions" value={sessions.filter((session) => session.status === "active").length} />
        </div>
      </article>
    </section>
  );
}

function MenuTab({ categories, items, openEdit, confirmCategoryToggle, confirmItemToggle, confirmAvailability, confirmDelete }) {
  return (
    <section className="admin-grid compact-admin-grid">
      <article className="panel">
        <PanelTitle title="Categories" subtitle="Edit opens a modal. Status changes ask for confirmation." />
        <div className="stack-list">
          {categories.map((category) => (
            <Row key={category.id} title={category.name} meta={`${category.items.length} items · order ${category.display_order}`}>
              <button className="button compact" type="button" onClick={() => openEdit("category", category)}><Pencil size={15} />Edit</button>
              <button className="button compact" type="button" onClick={() => confirmCategoryToggle(category)}>{category.is_active ? "Deactivate" : "Activate"}</button>
              <button className="button compact danger-button" type="button" onClick={() => confirmDelete("category", category, `/api/admin/categories/${category.id}`)}><Trash2 size={15} />Delete</button>
              <span className={category.is_active ? "pill" : "pill danger"}>{category.is_active ? "Active" : "Inactive"}</span>
            </Row>
          ))}
          {!categories.length && <EmptyLine text="No categories yet." />}
        </div>
      </article>

      <article className="panel">
        <PanelTitle title="Menu items" subtitle="Availability and active status are separate controls." />
        <div className="stack-list">
          {items.map((item) => (
            <Row
              key={item.id}
              title={item.name}
              meta={`${item.category} · ${money(item.price)} · ${item.modifier_groups?.length || 0} modifiers · ${item.stock_quantity === null || item.stock_quantity === undefined ? "Unlimited stock" : `${item.stock_quantity} left`}`}
            >
              <button className="button compact" type="button" onClick={() => openEdit("item", item)}><Pencil size={15} />Edit</button>
              <button className="button compact" type="button" onClick={() => confirmItemToggle(item)}>{item.is_active ? "Deactivate" : "Activate"}</button>
              <button className="button compact" type="button" onClick={() => confirmAvailability(item)}>{item.is_available ? "Mark sold out" : "Mark available"}</button>
              <button className="button compact danger-button" type="button" onClick={() => confirmDelete("menu item", item, `/api/admin/items/${item.id}`)}><Trash2 size={15} />Delete</button>
              <span className={item.is_active ? "pill" : "pill danger"}>{item.is_active ? "Active" : "Inactive"}</span>
              <span className={item.is_available ? "pill" : "pill danger"}>{item.is_available ? "Available" : "Sold out"}</span>
            </Row>
          ))}
          {!items.length && <EmptyLine text="No menu items yet." />}
        </div>
      </article>
    </section>
  );
}

function ModifierTab({ modifierGroups, openEdit, confirmModifierToggle, confirmDelete }) {
  return (
    <section className="admin-grid">
      <article className="panel wide-panel">
        <PanelTitle title="Modifiers" subtitle="Add-ons, spice levels and required choices for menu items." />
        <div className="stack-list">
          {modifierGroups.map((group) => (
            <Row key={group.id} title={group.name} meta={`${group.item_name} · ${group.options.length} options`}>
              <button className="button compact" type="button" onClick={() => openEdit("modifier", group)}><Pencil size={15} />Edit</button>
              <button className="button compact" type="button" onClick={() => confirmModifierToggle(group)}>{group.is_active ? "Deactivate" : "Activate"}</button>
              <button className="button compact danger-button" type="button" onClick={() => confirmDelete("modifier", group, `/api/admin/modifier-groups/${group.id}`)}><Trash2 size={15} />Delete</button>
              <span className={group.is_required ? "pill" : "pill neutral"}>{group.is_required ? "Required" : "Optional"}</span>
              <span className={group.is_active ? "pill" : "pill danger"}>{group.is_active ? "Active" : "Inactive"}</span>
            </Row>
          ))}
          {!modifierGroups.length && <EmptyLine text="No modifiers yet." />}
        </div>
      </article>
    </section>
  );
}

function QrTab({ tables, openEdit, confirmTableToggle, confirmDelete, copyQrLink }) {
  return (
    <section className="admin-grid">
      <article className="panel wide-panel">
        <PanelTitle title="QR mappings" subtitle="Manage table, room and location QR codes." />
        <div className="stack-list">
          {tables.map((table) => (
            <Row key={table.id} title={table.label} meta={`${table.location} · ${table.qr_token}`}>
              <button className="button compact" type="button" onClick={() => openEdit("table", table)}><Pencil size={15} />Edit</button>
              <button className="button compact" type="button" onClick={() => confirmTableToggle(table)}>{table.is_active ? "Deactivate" : "Activate"}</button>
              <button className="button compact danger-button" type="button" onClick={() => confirmDelete("QR mapping", table, `/api/admin/tables/${table.id}`)}><Trash2 size={15} />Delete</button>
              <button className="button compact" type="button" onClick={() => copyQrLink(table)}><Clipboard size={15} />Copy</button>
              <a className="button compact" href={`/qr/${table.qr_token}`} target="_blank" rel="noreferrer"><ExternalLink size={15} />Open</a>
              <span className={table.is_active ? "pill" : "pill danger"}>{table.is_active ? "Active" : "Inactive"}</span>
            </Row>
          ))}
          {!tables.length && <EmptyLine text="No QR mappings yet." />}
        </div>
      </article>
    </section>
  );
}

function StaffTab({ users, openEdit, confirmUserToggle, confirmDelete }) {
  return (
    <section className="admin-grid">
      <article className="panel wide-panel">
        <PanelTitle title="Staff users" subtitle="Manage admin, kitchen and service accounts." />
        <div className="stack-list">
          {users.map((user) => (
            <Row key={user.id} title={user.name} meta={`${user.email} · ${user.role}`}>
              <button className="button compact" type="button" onClick={() => openEdit("user", user)}><Pencil size={15} />Edit</button>
              <button className="button compact" type="button" onClick={() => confirmUserToggle(user)}>{user.is_active ? "Deactivate" : "Activate"}</button>
              <button className="button compact danger-button" type="button" onClick={() => confirmDelete("staff user", user, `/api/admin/users/${user.id}`)}><Trash2 size={15} />Delete</button>
              <span className={user.is_active ? "pill" : "pill danger"}>{user.is_active ? "Active" : "Inactive"}</span>
            </Row>
          ))}
          {!users.length && <EmptyLine text="No users yet." />}
        </div>
      </article>
    </section>
  );
}

function SessionsTab({
  sessions,
  tables,
  tableFilter,
  setTableFilter,
  statusFilter,
  setStatusFilter,
  selectedSession,
  setSelectedSession,
  confirmPayment
}) {
  const filteredSessions = sessions.filter((session) => {
    if (tableFilter && String(session.table.id) !== tableFilter) return false;
    if (statusFilter && session.payment_state !== statusFilter) return false;
    return true;
  });

  return (
    <section className="admin-grid">
      <article className="panel wide-panel">
        <PanelTitle title="Dining sessions and billing" subtitle="Details expand inline; payment closes the active session." />
        <div className="filter-row">
          <select value={tableFilter} onChange={(event) => setTableFilter(event.target.value)}>
            <option value="">All tables</option>
            {tables.map((table) => <option key={table.id} value={table.id}>{table.label}</option>)}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="bill_requested">Payment pending</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        <div className="session-table">
          {filteredSessions.map((session) => (
            <div key={session.id}>
              <button className="link-button" type="button" onClick={() => setSelectedSession(selectedSession?.id === session.id ? null : session)}>#{session.id}</button>
              <span>{session.table.label}</span>
              <span>{paymentStateLabel(session.payment_state)}</span>
              <strong>{money(session.total_amount)}</strong>
              <button
                className="button compact"
                type="button"
                disabled={session.payment_state !== "bill_requested"}
                title={session.payment_state === "open" ? "Waiting for the guest to request the bill." : ""}
                onClick={() => confirmPayment(session)}
              >
                <CreditCard size={16} />Mark paid
              </button>
            </div>
          ))}
          {!filteredSessions.length && <EmptyLine text={sessions.length ? "No sessions match these filters." : "No dining sessions yet."} />}
        </div>
        {selectedSession && <SessionDetail session={selectedSession} />}
      </article>
    </section>
  );
}

function SalesTab({ itemSales }) {
  return (
    <section className="admin-grid">
      <article className="panel wide-panel">
        <PanelTitle title="Item sales" subtitle="Exportable sales rows from real orders." />
        <div className="session-table">
          {itemSales.map((row) => (
            <div key={row.menu_item_id}>
              <span>#{row.menu_item_id}</span>
              <span>{row.item_name}</span>
              <span>{row.quantity} sold</span>
              <strong>{money(row.gross_sales)}</strong>
              <span />
            </div>
          ))}
          {!itemSales.length && <EmptyLine text="No item sales yet." />}
        </div>
      </article>
    </section>
  );
}

function ModalFields(props) {
  const { type } = props;
  if (type === "category") return <CategoryFields {...props} />;
  if (type === "item") return <ItemFields {...props} />;
  if (type === "modifier") return <ModifierFields {...props} />;
  if (type === "table") return <TableFields {...props} />;
  return <UserFields {...props} />;
}

function CategoryFields({ categoryForm, setCategoryForm }) {
  return (
    <>
      <label>Name<input required placeholder="Breakfast" value={categoryForm.name} onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })} /></label>
      <label>Display order<input required type="number" value={categoryForm.display_order} onChange={(event) => setCategoryForm({ ...categoryForm, display_order: Number(event.target.value) })} /></label>
      <Toggle label="Active" checked={categoryForm.is_active} onChange={(value) => setCategoryForm({ ...categoryForm, is_active: value })} />
    </>
  );
}

function ItemFields({ categories, itemForm, setItemForm, setImageFile }) {
  return (
    <>
      <label>Category<select value={itemForm.category_id} onChange={(event) => setItemForm({ ...itemForm, category_id: event.target.value })} required>
        <option value="">Select category</option>
        {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select></label>
      <label>Item name<input required placeholder="Chicken Kabsa" value={itemForm.name} onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })} /></label>
      <label>Description<textarea placeholder="Short guest-facing description" value={itemForm.description} onChange={(event) => setItemForm({ ...itemForm, description: event.target.value })} /></label>
      <div className="two-column">
        <label>Price<input required type="number" step="0.01" value={itemForm.price} onChange={(event) => setItemForm({ ...itemForm, price: event.target.value })} /></label>
        <label>Display order<input type="number" value={itemForm.display_order} onChange={(event) => setItemForm({ ...itemForm, display_order: Number(event.target.value) })} /></label>
      </div>
      <label>
        Stock quantity (leave blank for unlimited)
        <input
          type="number"
          min="0"
          placeholder="Unlimited"
          value={itemForm.stock_quantity}
          onChange={(event) => setItemForm({ ...itemForm, stock_quantity: event.target.value })}
        />
      </label>
      <label>Image URL<input placeholder="/uploads/menu/item.jpg" value={itemForm.image_url || ""} onChange={(event) => setItemForm({ ...itemForm, image_url: event.target.value })} /></label>
      <label>Upload image<input type="file" accept="image/*" onChange={(event) => setImageFile(event.target.files?.[0] || null)} /></label>
      <div className="inline-controls">
        <Toggle label="Available" checked={itemForm.is_available} onChange={(value) => setItemForm({ ...itemForm, is_available: value })} />
        <Toggle label="Active" checked={itemForm.is_active} onChange={(value) => setItemForm({ ...itemForm, is_active: value })} />
      </div>
    </>
  );
}

function ModifierFields({ items, modifierForm, setModifierForm }) {
  return (
    <>
      <label>Menu item<select value={modifierForm.menu_item_id} onChange={(event) => setModifierForm({ ...modifierForm, menu_item_id: event.target.value })} required>
        <option value="">Select item</option>
        {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Group name<input required placeholder="Spice level" value={modifierForm.name} onChange={(event) => setModifierForm({ ...modifierForm, name: event.target.value })} /></label>
      <div className="two-column">
        <label>Minimum<input required type="number" value={modifierForm.min_select} onChange={(event) => setModifierForm({ ...modifierForm, min_select: event.target.value })} /></label>
        <label>Maximum<input required type="number" value={modifierForm.max_select} onChange={(event) => setModifierForm({ ...modifierForm, max_select: event.target.value })} /></label>
      </div>
      <label>Options<textarea required value={modifierForm.options} onChange={(event) => setModifierForm({ ...modifierForm, options: event.target.value })} /></label>
      <small className="field-help">Use one option per line: Name|price_delta, for example Cheese|4.</small>
      <div className="inline-controls">
        <Toggle label="Required" checked={modifierForm.is_required} onChange={(value) => setModifierForm({ ...modifierForm, is_required: value })} />
        <Toggle label="Active" checked={modifierForm.is_active} onChange={(value) => setModifierForm({ ...modifierForm, is_active: value })} />
      </div>
    </>
  );
}

function TableFields({ tableForm, setTableForm, locations = [] }) {
  const isKnownLocation = tableForm.location === "" || locations.includes(tableForm.location);
  const [addingLocation, setAddingLocation] = useState(!isKnownLocation);

  return (
    <>
      <label>Table or location<input required placeholder="Table 12" value={tableForm.label} onChange={(event) => setTableForm({ ...tableForm, label: event.target.value })} /></label>
      <label>QR token<input required placeholder="MAH-TABLE-12" value={tableForm.qr_token} onChange={(event) => setTableForm({ ...tableForm, qr_token: event.target.value })} /></label>
      <label>
        Location
        {addingLocation ? (
          <input
            required
            placeholder="Main Restaurant"
            value={tableForm.location}
            onChange={(event) => setTableForm({ ...tableForm, location: event.target.value })}
          />
        ) : (
          <select
            required
            value={tableForm.location}
            onChange={(event) => {
              if (event.target.value === "__add_new__") {
                setTableForm({ ...tableForm, location: "" });
                setAddingLocation(true);
              } else {
                setTableForm({ ...tableForm, location: event.target.value });
              }
            }}
          >
            <option value="" disabled>Select a location</option>
            {locations.map((location) => (
              <option key={location} value={location}>{location}</option>
            ))}
            <option value="__add_new__">+ Add new location</option>
          </select>
        )}
      </label>
      <Toggle label="Active" checked={tableForm.is_active} onChange={(value) => setTableForm({ ...tableForm, is_active: value })} />
    </>
  );
}

function UserFields({ mode, userForm, setUserForm }) {
  const [showPassword, setShowPassword] = useState(false);
  return (
    <>
      <label>Name<input required placeholder="Service Staff" value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} /></label>
      <label>Email<input required placeholder="service@millenium.local" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} /></label>
      <label>
        Password
        <span className="password-field">
          <input type={showPassword ? "text" : "password"} required={mode === "add"} placeholder={mode === "edit" ? "Leave empty to keep password" : "Password"} value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} />
          <button className="icon-button" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>
            {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </span>
      </label>
      <label>Role<select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value })}>
        <option value="admin">Admin</option>
        <option value="kitchen">Kitchen</option>
        <option value="service">Service</option>
      </select></label>
      <Toggle label="Active" checked={userForm.is_active} onChange={(value) => setUserForm({ ...userForm, is_active: value })} />
    </>
  );
}

function AdminModal({ title, children, onClose, onSubmit }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="admin-modal" onSubmit={onSubmit}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close modal"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">
          <button className="button primary" type="submit"><Save size={18} />Save</button>
          <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="inline-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

function ReportStrip({ summary }) {
  if (!summary) return null;
  return (
    <section className="report-strip">
      <div><span>Open sessions</span><strong>{summary.open_sessions}</strong></div>
      <div><span>Completed</span><strong>{summary.completed_sessions}</strong></div>
      <div><span>Orders</span><strong>{summary.order_count}</strong></div>
      <div><span>Gross sales</span><strong>{money(summary.gross_sales)}</strong></div>
      <div><span>Paid</span><strong>{money(summary.paid_total)}</strong></div>
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PanelTitle({ title, subtitle }) {
  return (
    <div className="panel-title">
      <h2>{title}</h2>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

function Row({ title, meta, children }) {
  return (
    <div>
      <span>
        <strong>{title}</strong>
        <small>{meta}</small>
      </span>
      <span className="row-actions">{children}</span>
    </div>
  );
}

function EmptyLine({ text }) {
  return <p className="empty-line">{text}</p>;
}

function SessionDetail({ session }) {
  return (
    <section className="session-detail">
      <h3>Session #{session.id} detail</h3>
      {session.orders.length === 0 ? (
        <p>No orders in this session yet.</p>
      ) : session.orders.map((order) => (
        <article key={order.id}>
          <strong>{order.reference} · {order.status.replaceAll("_", " ")}</strong>
          {order.items.map((item) => (
            <p key={item.id}>
              {item.quantity} x {item.name_snapshot} · {money(item.unit_price)}
              {item.modifiers?.length ? ` · ${item.modifiers.map((modifier) => modifier.option_name_snapshot).join(", ")}` : ""}
            </p>
          ))}
        </article>
      ))}
    </section>
  );
}
