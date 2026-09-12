# Final Millenium Project

Database-backed dynamic QR ordering system starter for the Millenium Aqeeq hotel restaurant project.

The PDF was treated as project reference only. The implemented stack follows its recommended technologies:

- Frontend: React
- Backend: Python FastAPI
- Database: PostgreSQL
- Realtime: WebSockets
- Cache/queue-ready layer: Redis
- Notifications/payments: provider-ready placeholders, because Firebase/payment providers require client credentials

Deployment is intentionally not included.

## Project Structure

```text
Final Millenium Project/
  backend/                 FastAPI API, PostgreSQL models, business logic
  frontend/                React guest/admin/kitchen/service interface
  docs/                    Notes for continuing implementation
  docker-compose.dev.yml   Local PostgreSQL + Redis only
  .env.example             Shared development environment sample
```

## Local Setup

1. Copy environment values. The backend reads `.env` from its own working directory
   (`backend/`), not the project root, so copy it there directly:

```bash
cp .env.example backend/.env
cp .env.example frontend/.env
```

2. Start local database services:

```bash
docker compose -f docker-compose.dev.yml up -d
```

3. Backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The backend creates tables and seed data on startup for development.

4. Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5174`.

## Demo URLs

- Presentation/home: `http://localhost:5174`
- Guest QR flow: `http://localhost:5174/qr/MAH-TABLE-12`
- Admin panel: `http://localhost:5174/admin`
- Kitchen screen: `http://localhost:5174/kitchen`
- Service screen: `http://localhost:5174/service`

Default admin login:

- Email: `admin@millenium.local`
- Password: `Admin@12345`

## What Is Implemented

- Dynamic QR token mapped to a backend table record
- Active dining session creation/reuse per table
- Menu categories and items from PostgreSQL
- Menu modifiers/options
- Cart and order submission
- Duplicate-submit protection with idempotency keys
- Multiple orders under one active dining session
- Kitchen/service status workflow
- Guest live order status via WebSockets
- Admin menu item availability and table QR activation controls
- Per-item stock/quantity tracking (optional; blank = unlimited), auto sold-out at zero
- Admin reports and CSV export
- Bill request and payment closure
- Guest online checkout via Razorpay (test mode) with signature-verified webhook-style confirmation
- Web Push notifications (self-hosted VAPID, not Firebase-dependent) for: kitchen on new order,
  service on order-ready, admin on bill-request, guest on order status changes and payment received
- Backend safeguards against new orders on paid/completed sessions

## End-to-End Testing

Use [docs/END_TO_END_TEST_FLOW.md](docs/END_TO_END_TEST_FLOW.md) for the full guest, kitchen, service, billing and admin QA flow.

## Provider-Dependent Work

- Razorpay is wired in test mode (guest self-checkout from the bill screen). Razorpay's standard
  checkout only settles in INR; swapping in a Saudi-market gateway (Moyasar/HyperPay/Tap/Checkout.com)
  for real SAR settlement is still pending client/provider selection.
- Push notifications use a self-generated VAPID keypair (standard Web Push), not the Firebase project
  shown in the client's console screenshots - that would require a Firebase service-account private key
  for the backend to send through Firebase's Admin SDK, which was not provided. The current approach
  delivers real browser push without that credential, but note push (and its service worker) only
  works over HTTPS or `localhost` - it will not work when a phone opens the plain `http://<lan-ip>` URL.
# Final-qr-menu
