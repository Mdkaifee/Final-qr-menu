import hashlib
import hmac
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import razorpay
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.core.push import send_push
from app.db.models import (
    DiningSession,
    MenuCategory,
    MenuItem,
    MenuModifierGroup,
    MenuModifierOption,
    Order,
    OrderItem,
    OrderItemModifier,
    OrderStatusHistory,
    Payment,
    RestaurantTable,
)
from app.db.session import get_db
from app.realtime import manager
from app.schemas import (
    CategoryRead,
    OrderCreate,
    OrderRead,
    QRSessionResponse,
    RazorpayOrderRead,
    RazorpayVerify,
    SessionSummary,
)

router = APIRouter(prefix="/guest", tags=["guest"])


@router.post("/qr/{qr_token}/session", response_model=QRSessionResponse)
def open_or_resume_session(qr_token: str, db: Session = Depends(get_db)) -> QRSessionResponse:
    table = db.scalar(select(RestaurantTable).where(RestaurantTable.qr_token == qr_token))
    if not table or not table.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="QR code is not active")

    session = db.scalar(
        select(DiningSession).where(
            DiningSession.table_id == table.id,
            DiningSession.status == "active",
            DiningSession.payment_state.in_(["open", "bill_requested"]),
        )
    )
    if not session:
        session = DiningSession(table_id=table.id)
        db.add(session)
        db.commit()
        db.refresh(session)

    return QRSessionResponse(
        session_id=session.id,
        table=table,
        status=session.status,
        payment_state=session.payment_state,
    )


@router.get("/menu", response_model=list[CategoryRead])
def get_active_menu(db: Session = Depends(get_db)) -> list[MenuCategory]:
    return list(
        db.scalars(
            select(MenuCategory)
            .where(MenuCategory.is_active.is_(True))
            .options(
                selectinload(MenuCategory.items)
                .selectinload(MenuItem.modifier_groups)
                .selectinload(MenuModifierGroup.options)
            )
            .order_by(MenuCategory.display_order, MenuCategory.name)
        )
    )


@router.get("/sessions/{session_id}", response_model=SessionSummary)
def get_session(session_id: int, db: Session = Depends(get_db)) -> SessionSummary:
    session = load_session_or_404(session_id, db)
    return build_session_summary(session)


@router.post("/sessions/{session_id}/orders", response_model=OrderRead, status_code=status.HTTP_201_CREATED)
async def create_order(
    session_id: int,
    payload: OrderCreate,
    db: Session = Depends(get_db),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> Order:
    session = db.scalar(select(DiningSession).where(DiningSession.id == session_id))
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if session.status != "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Session is closed for ordering")
    if session.payment_state != "open":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Final bill has already been requested for this visit",
        )

    if idempotency_key:
        existing_order = db.scalar(
            select(Order).where(Order.session_id == session_id, Order.idempotency_key == idempotency_key)
        )
        if existing_order:
            return load_order_or_404(existing_order.id, db)

    item_ids = [cart_item.menu_item_id for cart_item in payload.items]
    menu_items = {
        item.id: item
        for item in db.scalars(
            select(MenuItem).where(
                MenuItem.id.in_(item_ids),
                MenuItem.is_active.is_(True),
                MenuItem.is_available.is_(True),
            )
            .options(selectinload(MenuItem.modifier_groups).selectinload(MenuModifierGroup.options))
        )
    }

    if len(menu_items) != len(set(item_ids)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="One or more menu items are unavailable")

    requested_quantity: dict[int, int] = {}
    for cart_item in payload.items:
        requested_quantity[cart_item.menu_item_id] = requested_quantity.get(cart_item.menu_item_id, 0) + cart_item.quantity

    for menu_item_id, quantity in requested_quantity.items():
        menu_item = menu_items[menu_item_id]
        if menu_item.stock_quantity is not None and quantity > menu_item.stock_quantity:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Only {menu_item.stock_quantity} of {menu_item.name} left",
            )

    order = Order(
        session_id=session.id,
        reference=f"ORD-{uuid4().hex[:8].upper()}",
        status="placed",
        customer_note=payload.customer_note,
        idempotency_key=idempotency_key,
    )
    db.add(order)
    db.flush()

    total = Decimal("0.00")
    for cart_item in payload.items:
        menu_item = menu_items[cart_item.menu_item_id]
        selected_options = validate_modifier_selection(menu_item, cart_item.modifier_option_ids)
        unit_total = menu_item.price + sum((option.price_delta for option in selected_options), Decimal("0.00"))
        line_total = unit_total * cart_item.quantity
        total += line_total
        order_item = OrderItem(
            order_id=order.id,
            menu_item_id=menu_item.id,
            name_snapshot=menu_item.name,
            unit_price=unit_total,
            quantity=cart_item.quantity,
            note=cart_item.note,
        )
        db.add(order_item)
        db.flush()

        for option in selected_options:
            db.add(
                OrderItemModifier(
                    order_item_id=order_item.id,
                    modifier_option_id=option.id,
                    group_name_snapshot=option.group.name,
                    option_name_snapshot=option.name,
                    price_delta=option.price_delta,
                )
            )

    order.total_amount = total

    menu_changed = False
    for menu_item_id, quantity in requested_quantity.items():
        menu_item = menu_items[menu_item_id]
        if menu_item.stock_quantity is not None:
            menu_item.stock_quantity = max(menu_item.stock_quantity - quantity, 0)
            if menu_item.stock_quantity == 0:
                menu_item.is_available = False
            menu_changed = True

    db.add(OrderStatusHistory(order_id=order.id, status="placed", actor="guest", note="Order submitted"))
    db.commit()

    order = load_order_or_404(order.id, db)
    await manager.broadcast("orders", {"type": "order.created", "order_id": order.id, "reference": order.reference})
    await manager.broadcast(f"session:{session.id}", {"type": "order.created", "order": serialize_order(order)})
    if menu_changed:
        await manager.broadcast("menu", {"type": "menu.updated"})
    send_push(
        db,
        "role",
        "kitchen",
        "New order",
        f"{session.table.label} · {order.reference}",
        url="/kitchen",
    )
    return order


@router.post("/sessions/{session_id}/bill-request", response_model=SessionSummary)
async def request_bill(session_id: int, db: Session = Depends(get_db)) -> SessionSummary:
    session = load_session_or_404(session_id, db)
    if session.status != "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Session is already closed")
    if session.payment_state != "open":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bill already requested")

    total = sum((order.total_amount for order in session.orders), Decimal("0.00"))
    if total <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to bill yet")

    session.payment_state = "bill_requested"
    db.commit()
    db.refresh(session)
    await manager.broadcast("orders", {"type": "bill.requested", "session_id": session.id})
    await manager.broadcast(f"session:{session.id}", {"type": "bill.requested", "session_id": session.id})
    send_push(
        db,
        "role",
        "admin",
        "Bill requested",
        f"{session.table.label} asked for the bill.",
        url="/admin",
    )
    return build_session_summary(session)


@router.post("/sessions/{session_id}/payment/razorpay-order", response_model=RazorpayOrderRead)
def create_razorpay_order(session_id: int, db: Session = Depends(get_db)) -> RazorpayOrderRead:
    session = load_session_or_404(session_id, db)
    if session.status != "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Session is already closed")
    if session.payment_state != "bill_requested":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Request final bill before payment")

    total = sum((order.total_amount for order in session.orders), Decimal("0.00"))
    if total <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to pay yet")

    settings = get_settings()
    if not settings.razorpay_key_id or not settings.razorpay_key_secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Online payment is not configured")

    client = razorpay.Client(auth=(settings.razorpay_key_id, settings.razorpay_key_secret))
    amount_in_minor_units = int(total * 100)
    # Razorpay standard checkout (test/sandbox) only settles in INR; a Saudi-market gateway
    # (Moyasar/HyperPay/Tap/Checkout.com etc.) would be swapped in here for SAR at go-live.
    razorpay_order = client.order.create(
        {
            "amount": amount_in_minor_units,
            "currency": "INR",
            "receipt": f"session-{session.id}",
            "notes": {"session_id": str(session.id), "table": session.table.label},
        }
    )
    return RazorpayOrderRead(
        order_id=razorpay_order["id"],
        amount=amount_in_minor_units,
        currency=razorpay_order["currency"],
        key_id=settings.razorpay_key_id,
    )


@router.post("/sessions/{session_id}/payment/razorpay-verify", response_model=SessionSummary)
async def verify_razorpay_payment(session_id: int, payload: RazorpayVerify, db: Session = Depends(get_db)) -> SessionSummary:
    session = load_session_or_404(session_id, db)
    if session.status == "completed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Session is already completed")

    settings = get_settings()
    if not settings.razorpay_key_secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Online payment is not configured")

    expected_signature = hmac.new(
        settings.razorpay_key_secret.encode("utf-8"),
        f"{payload.razorpay_order_id}|{payload.razorpay_payment_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected_signature, payload.razorpay_signature):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment verification failed")

    total = sum((order.total_amount for order in session.orders), Decimal("0.00"))
    db.add(
        Payment(
            session_id=session.id,
            amount=total,
            method="razorpay",
            provider_reference=payload.razorpay_payment_id,
            status="captured",
        )
    )
    session.status = "completed"
    session.payment_state = "paid"
    session.closed_at = datetime.now(timezone.utc)
    db.commit()
    session = load_session_or_404(session_id, db)

    await manager.broadcast(f"session:{session.id}", {"type": "session.paid", "session_id": session.id})
    await manager.broadcast("orders", {"type": "session.paid", "session_id": session.id})
    send_push(db, "session", str(session.id), "Payment received", "Thank you! Your bill is settled.", url="/")
    return build_session_summary(session)


def load_session_or_404(session_id: int, db: Session) -> DiningSession:
    session = db.scalar(
        select(DiningSession)
        .where(DiningSession.id == session_id)
        .options(
            selectinload(DiningSession.table),
            selectinload(DiningSession.orders).selectinload(Order.items).selectinload(OrderItem.modifiers),
            selectinload(DiningSession.payments),
        )
    )
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session


def load_order_or_404(order_id: int, db: Session) -> Order:
    order = db.scalar(
        select(Order)
        .where(Order.id == order_id)
        .options(selectinload(Order.items).selectinload(OrderItem.modifiers))
    )
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return order


def validate_modifier_selection(menu_item: MenuItem, option_ids: list[int]) -> list[MenuModifierOption]:
    option_ids = list(dict.fromkeys(option_ids))
    groups = [group for group in menu_item.modifier_groups if group.is_active]
    options_by_id = {
        option.id: option
        for group in groups
        for option in group.options
        if option.is_active
    }

    selected_options: list[MenuModifierOption] = []
    for option_id in option_ids:
        option = options_by_id.get(option_id)
        if not option:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Modifier option {option_id} is not valid for {menu_item.name}",
            )
        selected_options.append(option)

    for group in groups:
        selected_count = sum(1 for option in selected_options if option.group_id == group.id)
        if group.is_required and selected_count < max(group.min_select, 1):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{group.name} is required for {menu_item.name}",
            )
        if selected_count < group.min_select or selected_count > group.max_select:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Select between {group.min_select} and {group.max_select} options for {group.name}",
            )

    return selected_options


def build_session_summary(session: DiningSession) -> SessionSummary:
    total = sum((order.total_amount for order in session.orders), Decimal("0.00"))
    return SessionSummary(
        id=session.id,
        table=session.table,
        status=session.status,
        payment_state=session.payment_state,
        opened_at=session.opened_at,
        closed_at=session.closed_at,
        orders=session.orders,
        total_amount=total,
    )


async def record_session_payment(
    db: Session,
    session_id: int,
    amount: Decimal,
    method: str,
    provider_reference: str | None,
) -> SessionSummary:
    """Shared cash/card settlement path used by both admin and service billing screens."""
    session = load_session_or_404(session_id, db)
    if session.status == "completed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Session is already completed")
    if session.payment_state != "bill_requested":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Guest has not requested the bill yet - they may still be ordering more.",
        )

    db.add(
        Payment(
            session_id=session.id,
            amount=amount,
            method=method,
            provider_reference=provider_reference,
            status="recorded",
        )
    )
    session.status = "completed"
    session.payment_state = "paid"
    session.closed_at = datetime.now(timezone.utc)
    db.commit()
    session = load_session_or_404(session_id, db)

    await manager.broadcast(f"session:{session.id}", {"type": "session.paid", "session_id": session.id})
    await manager.broadcast("orders", {"type": "session.paid", "session_id": session.id})
    send_push(db, "session", str(session.id), "Payment received", "Thank you! Your bill is settled.", url="/")
    return build_session_summary(session)


def serialize_order(order: Order) -> dict:
    return {
        "id": order.id,
        "reference": order.reference,
        "status": order.status,
        "total_amount": str(order.total_amount),
        "items": [
            {
                "name": item.name_snapshot,
                "quantity": item.quantity,
                "unit_price": str(item.unit_price),
                "note": item.note,
                "modifiers": [
                    {
                        "group": modifier.group_name_snapshot,
                        "option": modifier.option_name_snapshot,
                        "price_delta": str(modifier.price_delta),
                    }
                    for modifier in item.modifiers
                ],
            }
            for item in order.items
        ],
    }
