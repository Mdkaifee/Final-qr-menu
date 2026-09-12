import { X } from "lucide-react";

export default function ConfirmModal({ config, onCancel, onConfirm }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="admin-modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="modal-head">
          <div>
            <p className="eyebrow">Confirm action</p>
            <h2 id="confirm-title">{config.title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="Close confirmation"><X size={18} /></button>
        </div>
        <p>{config.message}</p>
        <div className="modal-actions">
          <button className={config.danger ? "button danger-solid" : "button primary"} type="button" onClick={onConfirm}>{config.confirmLabel}</button>
          <button className="button secondary" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </section>
    </div>
  );
}
