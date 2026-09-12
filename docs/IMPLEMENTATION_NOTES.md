# Implementation Notes

## Source of Truth

The attached PDF is reference material for scope and recommended technology. Runtime behavior should be driven by the backend and PostgreSQL, not hardcoded browser state.

## Current Modules

- `backend/app/db/models.py`: relational data model for the restaurant QR ordering flow
- `backend/app/api/guest.py`: QR validation, dining session, guest menu, order, bill request and
  Razorpay checkout/verify APIs
- `backend/app/api/admin.py`: menu, table/QR and billing management APIs
- `backend/app/api/staff.py`: kitchen/service status workflow APIs
- `backend/app/api/push.py` + `backend/app/core/push.py`: Web Push subscription storage and sending
  (self-hosted VAPID, no Firebase Admin SDK dependency)
- `frontend/src/pages/GuestPage.jsx`: guest mobile web ordering experience, incl. quantity stepper,
  Razorpay "Pay now" and push opt-in
- `frontend/src/pages/AdminPage.jsx`: tabbed admin dashboard with modal add/edit flows, row actions,
  logout confirmation and push opt-in
- `frontend/src/pages/StaffPage.jsx`: kitchen and service dashboard with push opt-in
- `frontend/src/lib/push.js` + `frontend/public/sw.js`: shared push subscribe helper and service worker

### Local env file gotcha

`Settings` (`backend/app/core/config.py`) loads `.env` relative to the backend process's working
directory, i.e. `backend/.env` - not the project-root `.env` the original setup instructions implied.
The README now points `cp .env.example` at `backend/.env` directly. Because the `Settings` defaults
happened to mirror `.env.example`'s DB/Redis/JWT values, this was silently masked until fields with no
safe default (Razorpay keys, VAPID keys) were added and came back empty.

## Completed Backend Work

- Alembic migration scaffolding added for future schema revisions
- Dev-safe startup migrations added for current local database changes
- Role-specific users seeded for admin, kitchen and service
- Item modifier groups/options added
- Selected modifier snapshots stored with order items
- Menu image upload endpoint and `/uploads` static serving added
- Idempotency keys added for order submission
- Admin reports and CSV export endpoints added
- Staff table/status filtering endpoints added
- Last-active-admin protection added for staff user activation changes
- Safe delete endpoints added for admin-managed records, with history checks where needed

## Completed Frontend Work

- Full admin dashboard expanded with report cards
- Category, menu item, modifier, QR table and staff user add/edit modals added
- Activate/deactivate and availability row actions added to admin lists
- Top tabs added to keep admin sections short and separated
- Confirmation modal added for activate, deactivate, delete and mark-paid actions
- Password visibility toggles added to login and staff user password fields
- Session detail and billing controls added
- Guest modifier selection and idempotent submit behavior added
- Staff filtering by table/status added
- Richer order cards include table labels, notes and modifiers

## Remaining Provider-Dependent Work

- Razorpay test-mode checkout is wired end-to-end (order create -> hosted checkout -> HMAC-verified
  confirmation). Currently settles in INR only; swap in the Saudi-approved gateway for SAR at go-live.
- Web Push is wired end-to-end using a self-generated VAPID keypair, not the client's Firebase project.
  Works identically from the browser's perspective; no service-account credential was needed or used.

## Next Production-Hardening Work

- Generate formal Alembic revision files before a production database is used
- Add automated backend/API tests and frontend component tests
- Add stricter role-specific UI routing after final staff permissions are approved
- Add cloud/object storage for production menu images
- Add full payment method screens after the approved provider is selected

## Deployment

Deployment is intentionally excluded from this code pass, per request.
