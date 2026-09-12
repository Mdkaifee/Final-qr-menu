from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_billing, require_staff
from app.api.guest import build_session_summary, load_order_or_404, record_session_payment, serialize_order
from app.core.push import send_push
from app.db.models import DiningSession, Order, OrderItem, OrderStatusHistory, RestaurantTable, User
from app.db.session import get_db
from app.realtime import manager
from app.schemas import OrderRead, OrderStatusUpdate, PaymentCreate, SessionSummary, StaffOrderRead, TableRead

router = APIRouter(prefix="/staff", tags=["staff"], dependencies=[Depends(require_staff)])

ALLOWED_TRANSITIONS = {
    "placed": {"confirmed", "cancelled"},
    "confirmed": {"preparing", "cancelled"},
    "preparing": {"ready", "cancelled"},
    "ready": {"ready_to_serve"},
    "ready_to_serve": {"served"},
    "served": set(),
    "cancelled": set(),
}


@router.get("/tables", response_model=list[TableRead])
def list_staff_tables(db: Session = Depends(get_db)) -> list[RestaurantTable]:
    return list(db.scalars(select(RestaurantTable).where(RestaurantTable.is_active.is_(True)).order_by(RestaurantTable.label)))


@router.get("/orders", response_model=list[StaffOrderRead])
def list_orders(
    status_filter: str | None = None,
    table_id: int | None = None,
    db: Session = Depends(get_db),
) -> list[StaffOrderRead]:
    query = (
        select(Order)
        .options(selectinload(Order.items), selectinload(Order.session).selectinload(DiningSession.table))
        .order_by(Order.created_at.desc())
    )
    if status_filter:
        query = query.where(Order.status == status_filter)
    if table_id:
        query = query.where(Order.session.has(table_id=table_id))
    return [to_staff_order(order) for order in db.scalars(query)]


@router.patch("/orders/{order_id}/status", response_model=OrderRead)
async def update_order_status(
    order_id: int,
    payload: OrderStatusUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_staff),
) -> Order:
    order = load_order_or_404(order_id, db)
    allowed_next = ALLOWED_TRANSITIONS.get(order.status, set())
    if payload.status not in allowed_next:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot move order from {order.status} to {payload.status}",
        )

    order.status = payload.status
    db.add(OrderStatusHistory(order_id=order.id, status=payload.status, actor=user.email, note=payload.note))
    db.commit()
    order = load_order_or_404(order_id, db)

    await manager.broadcast("orders", {"type": "order.updated", "order": serialize_order(order)})
    await manager.broadcast(f"session:{order.session_id}", {"type": "order.updated", "order": serialize_order(order)})
    send_push(
        db,
        "session",
        str(order.session_id),
        "Order update",
        f"{order.reference} is now {payload.status.replace('_', ' ')}",
        url="/",
    )
    if payload.status == "ready":
        send_push(db, "role", "service", "Order ready", f"{order.reference} is ready to serve", url="/service")
    return order


@router.get("/sessions", response_model=list[SessionSummary])
def list_billable_sessions(
    db: Session = Depends(get_db),
    user: User = Depends(require_billing),
) -> list[SessionSummary]:
    sessions = db.scalars(
        select(DiningSession)
        .options(
            selectinload(DiningSession.table),
            selectinload(DiningSession.orders).selectinload(Order.items).selectinload(OrderItem.modifiers),
            selectinload(DiningSession.payments),
        )
        .order_by(DiningSession.id.desc())
    )
    return [build_session_summary(session) for session in sessions]


@router.post("/sessions/{session_id}/payments", response_model=SessionSummary)
async def record_staff_payment(
    session_id: int,
    payload: PaymentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_billing),
) -> SessionSummary:
    return await record_session_payment(db, session_id, payload.amount, payload.method, payload.provider_reference)


def to_staff_order(order: Order) -> StaffOrderRead:
    return StaffOrderRead(
        id=order.id,
        session_id=order.session_id,
        reference=order.reference,
        status=order.status,
        customer_note=order.customer_note,
        total_amount=order.total_amount,
        created_at=order.created_at,
        updated_at=order.updated_at,
        items=order.items,
        table_id=order.session.table.id,
        table_label=order.session.table.label,
        session_payment_state=order.session.payment_state,
    )
