# End-to-End Test Flow

This document tests the full Millenium Aqeeq Hotel QR ordering flow from guest scan to kitchen, service, billing and admin reporting.

## 1. Start Services

From `Final Millenium Project/backend`:

```bash
source .venv/bin/activate
uvicorn app.main:app --reload
```

From `Final Millenium Project/frontend`:

```bash
npm run dev
```

Open:

- Guest flow: `http://localhost:5174/qr/MAH-TABLE-12`
- Admin: `http://localhost:5174/admin`
- Kitchen: `http://localhost:5174/kitchen`
- Service: `http://localhost:5174/service`

Postgres/Redis can run either as native services (as installed previously) or via
`docker compose -f docker-compose.dev.yml up -d` from the project root now that Docker is
available - both point at the same `localhost:5432`/`localhost:6379`, so use whichever is
already running; don't start both at once.

### Testing from a phone on the same Wi-Fi

Use the frontend's **Network** URL instead of `localhost` (e.g. `http://192.168.x.x:5174/...`).
The backend's CORS policy explicitly allows private-network origins (192.168.x.x, 10.x.x.x,
172.16-31.x.x) on port 5174 for this reason - a phone hitting `localhost` would only ever reach
itself, not this machine. Push notifications are the one feature that will **not** work over the
plain `http://` LAN address (browsers require HTTPS or `localhost` for the Push API) - test those
on the laptop itself.

## 2. Login Accounts

Use these seeded development accounts:

- Admin: `admin@millenium.local` / `Admin@12345`
- Kitchen: `kitchen@millenium.local` / `Kitchen@12345`
- Service: `service@millenium.local` / `Service@12345`

## 3. Guest Scan and Session Creation

1. Open `http://localhost:5174/qr/MAH-TABLE-12`.
2. Confirm the page shows `Table 12`.
3. Confirm menu categories and items are visible.

Expected result:

- Backend validates QR token `MAH-TABLE-12`.
- The app creates or resumes one active dining session for Table 12.
- No bill should be requested at this stage.

## 4. Place a Guest Order

1. In the guest page, select menu items.
2. For items with modifiers, select required options.
3. Add items to cart.
4. Click `Send order`.

Expected result:

- Guest sees an order confirmation message.
- Order appears in the kitchen board under `placed`.
- Admin session shows payment state as `open`, not `bill_requested`.

Important:

- `bill_requested` should only appear after clicking `Request bill`.
- After final bill is requested, the session is locked for ordering. Any further order attempt is rejected.

## 4a. Stock-Limited Items

1. In Admin → Menu, edit an item and set `Stock quantity` to `2` (leave blank on other items for unlimited).
2. On the guest page, that item now shows `2 left` and a +/- stepper once added.
3. Try adding a 3rd unit (or submit an order for 3) - expect a rejection: `Only 2 of <item> left`.
4. Order exactly 2 - expect success; the item then shows `Sold out` in both admin and guest views, and stock reads `0`.

Expected result:

- Stock decrements only on successful order submission, never on unsuccessful attempts.
- An item with a blank stock quantity is never limited ("Unlimited stock" in the admin list).

## 5. Kitchen Workflow

Open `http://localhost:5174/kitchen`.

1. Confirm the order appears under `placed`.
2. Click `Move to confirmed`.
3. Confirm it moves to `confirmed`.
4. Click `Move to preparing`.
5. Confirm it moves to `preparing`.
6. Click `Move to ready`.
7. Confirm it moves to `ready`.

Expected result:

- Guest order status updates live.
- Service board receives the order once it is ready.

## 6. Service Workflow

Open `http://localhost:5174/service`.

1. Confirm the order appears under `ready`.
2. Click `Move to ready to serve`.
3. Click `Move to served`.

Expected result:

- Guest order status changes through service states.
- Admin session still remains active until payment is recorded.

## 7. Additional Order in Same Visit

1. Return to the guest page.
2. Add another item.
3. Click `Send order`.

Expected result:

- A second order is created in the same dining session.
- Admin session total increases.
- The system does not create a second bill/session for the same active Table 12 visit.

## 8. Request Bill

1. Make sure the cart is empty. If there are unsent items, click `Send order` first.
2. On the guest page, click `Request final bill`.
2. Open Admin.

Expected result:

- Admin session payment state changes to `bill_requested`.
- The bill covers every order in the dining session, not one order at a time.
- New orders are blocked for that session once the final bill has been requested.
- The session is still active until guest online payment succeeds or staff records payment.

## 9. Close the Session - Two Paths

### 9a. Guest pays online (Razorpay test mode)

1. On the guest page, once `bill_requested`, a `Pay now` button appears.
2. Click it - Razorpay's hosted checkout opens with the session total.
3. Use a Razorpay test card (e.g. `4111 1111 1111 1111`, any future expiry/CVV) to complete payment.

Expected result:

- The backend verifies the payment signature before accepting it; a tampered/forged signature is rejected with `Payment verification failed`.
- On success, the session becomes `completed` / `paid`, recorded with method `razorpay` and the real `razorpay_payment_id`.
- Razorpay's standard test/sandbox checkout only settles in INR, not SAR - this is a placeholder for the Saudi-approved gateway, not the final currency.

### 9b. Staff records cash/card payment manually

Open `http://localhost:5174/admin`.

1. Find the active Table 12 session.
2. Click `Mark paid`.

Expected result (both paths):

- Session status becomes `completed`.
- Payment state becomes `paid`.
- New orders cannot be added to that closed session.
- A future QR scan creates a new active session for Table 12.

## 9c. Push Notifications

1. On Admin, Kitchen, Service and the guest page, click the `Notifications` / `Enable order updates` button and accept the browser permission prompt.
2. Place a guest order - kitchen should receive a push even with that tab in the background.
3. Move an order to `ready` - service gets a push.
4. Guest requests the bill - admin gets a push.
5. Complete payment (either path in step 9) - the guest gets a "Payment received" push.

Expected result:

- Notifications arrive even when the relevant tab is not focused (that's the point of push vs. in-page status).
- No push is required for the app to keep working - it's additive on top of the existing live in-page/WebSocket status.
- This only works over `localhost` or HTTPS, not a plain `http://` LAN address (see phone-testing note above).

## 10. Admin Management Checks

In Admin:

1. Use the top tabs to move between `Overview`, `Menu`, `Modifiers`, `QR mappings`, `Staff users`, `Sessions` and `Sales`.
2. On `Menu`, click `Add category` or `Add menu item`, save from the modal, then confirm the new row appears.
3. Click `Edit` on a category or menu item, update it in the modal, then save.
4. Use menu row actions: `Deactivate`/`Activate`, `Delete`, and `Mark sold out`/`Mark available`.
5. Confirm status/delete actions in the confirmation modal.
6. On `Modifiers`, click `Add modifier`, save from the modal, then use `Edit`, `Deactivate`/`Activate` and `Delete`.
7. On `QR mappings`, click `Add QR mapping`, save from the modal, then use `Edit`, `Copy`, `Open`, `Deactivate`/`Activate` and `Delete`.
8. On `Staff users`, click `Add staff user`, save from the modal, then use `Edit`, `Deactivate`/`Activate` and `Delete`.
9. On `Sessions`, expand a session and use `Mark paid` after confirming the modal.
10. On `Sales`, check item sales, then use top `CSV` to download the report.

Expected result:

- Changes persist in PostgreSQL.
- Menu updates are reflected in the guest experience.
- Staff and admin data remain available after page refresh.
- Add/edit is handled through modals; list rows keep direct action buttons.
- Activate, deactivate, delete and payment actions use confirmation modals, not browser alerts.
- The system prevents deactivating, changing or deleting the only active admin account.
- Records with protected order/session history should be deactivated instead of deleted.

## 11. Common Test Problems

### Order shows `bill_requested` even though only an order was placed

Cause:

- The session already had a previous bill request from testing.

Expected behavior after the fix:

- `bill_requested` should only be shown after the guest clicks `Request final bill`.
- Creating a new order on an active `bill_requested` session is rejected, because final bill has already started.

### Kitchen does not show an order

Check:

- You are logged in.
- The order status is still one of `placed`, `confirmed`, `preparing` or `ready`.
- Refresh the kitchen board.

### Service does not show an order

Check:

- Kitchen moved the order to `ready`.
- You are logged in.
- Refresh the service board.

## 12. Final Acceptance Checklist

- Valid QR opens correct table.
- Guest can place an order.
- Kitchen receives and updates the order.
- Service receives ready orders and marks served.
- Guest can place multiple orders in one active visit.
- Bill request appears only after guest requests bill.
- Admin can mark session paid, or guest can pay online via Razorpay with signature verification.
- Paid/completed sessions reject further ordering.
- Reports and item sales update from real orders.
- Stock-limited items block over-ordering and auto-mark sold out at zero.
- Push notifications reach kitchen/service/admin/guest at the right lifecycle events.
- The app is reachable and fully functional from another device on the same Wi-Fi (CORS-wise);
  only push notifications are exempt (localhost/HTTPS only).
