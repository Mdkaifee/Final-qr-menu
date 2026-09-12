from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_admin
from app.api.guest import build_session_summary, load_session_or_404, record_session_payment
from app.core.security import hash_password
from app.db.models import (
    DiningSession,
    MenuCategory,
    MenuItem,
    MenuModifierGroup,
    MenuModifierOption,
    Order,
    OrderItem,
    OrderItemModifier,
    Payment,
    RestaurantTable,
    User,
)
from app.db.session import get_db
from app.realtime import manager
from app.schemas import (
    CategoryRead,
    CategoryWrite,
    ItemSalesRow,
    MenuItemRead,
    MenuItemWrite,
    ModifierGroupRead,
    ModifierGroupWrite,
    PaymentCreate,
    SalesSummary,
    SessionSummary,
    TableRead,
    TableWrite,
    UserRead,
    UserUpdate,
    UserWrite,
)

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])
UPLOAD_DIR = Path("uploads/menu")


@router.get("/categories", response_model=list[CategoryRead])
def list_categories(db: Session = Depends(get_db)) -> list[MenuCategory]:
    return list(
        db.scalars(
            select(MenuCategory)
            .options(
                selectinload(MenuCategory.items)
                .selectinload(MenuItem.modifier_groups)
                .selectinload(MenuModifierGroup.options)
            )
            .order_by(MenuCategory.display_order, MenuCategory.name)
        )
    )


@router.post("/categories", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
def create_category(payload: CategoryWrite, db: Session = Depends(get_db)) -> MenuCategory:
    category = MenuCategory(**payload.model_dump())
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@router.put("/categories/{category_id}", response_model=CategoryRead)
def update_category(category_id: int, payload: CategoryWrite, db: Session = Depends(get_db)) -> MenuCategory:
    category = db.get(MenuCategory, category_id)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    for field, value in payload.model_dump().items():
        setattr(category, field, value)
    db.commit()
    db.refresh(category)
    return category


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(category_id: int, db: Session = Depends(get_db)) -> Response:
    category = db.get(MenuCategory, category_id)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    item_count = db.scalar(select(func.count()).select_from(MenuItem).where(MenuItem.category_id == category_id)) or 0
    if item_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Category has menu items. Move or delete items first, or deactivate the category.",
        )

    db.delete(category)
    db.commit()
    await manager.broadcast("menu", {"type": "menu.updated"})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/items", response_model=MenuItemRead, status_code=status.HTTP_201_CREATED)
async def create_menu_item(payload: MenuItemWrite, db: Session = Depends(get_db)) -> MenuItem:
    if not db.get(MenuCategory, payload.category_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    item = MenuItem(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    await manager.broadcast("menu", {"type": "menu.updated"})
    return item


@router.put("/items/{item_id}", response_model=MenuItemRead)
async def update_menu_item(item_id: int, payload: MenuItemWrite, db: Session = Depends(get_db)) -> MenuItem:
    item = db.get(MenuItem, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu item not found")

    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    await manager.broadcast("menu", {"type": "menu.updated"})
    return item


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_menu_item(item_id: int, db: Session = Depends(get_db)) -> Response:
    item = db.get(MenuItem, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu item not found")

    order_item_count = db.scalar(select(func.count()).select_from(OrderItem).where(OrderItem.menu_item_id == item_id)) or 0
    if order_item_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Menu item has order history. Deactivate it instead of deleting.",
        )

    db.delete(item)
    db.commit()
    await manager.broadcast("menu", {"type": "menu.updated"})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/items/{item_id}/image", response_model=MenuItemRead)
async def upload_menu_item_image(
    item_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> MenuItem:
    item = db.get(MenuItem, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu item not found")
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only image uploads are allowed")

    extension = Path(file.filename or "").suffix.lower() or ".jpg"
    filename = f"{item_id}-{uuid4().hex}{extension}"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    destination = UPLOAD_DIR / filename
    destination.write_bytes(await file.read())
    item.image_url = f"/uploads/menu/{filename}"
    db.commit()
    db.refresh(item)
    await manager.broadcast("menu", {"type": "menu.updated"})
    return item


@router.patch("/items/{item_id}/availability", response_model=MenuItemRead)
async def set_item_availability(item_id: int, is_available: bool, db: Session = Depends(get_db)) -> MenuItem:
    item = db.get(MenuItem, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu item not found")
    item.is_available = is_available
    db.commit()
    db.refresh(item)
    await manager.broadcast("menu", {"type": "menu.updated"})
    return item


@router.post("/modifier-groups", response_model=ModifierGroupRead, status_code=status.HTTP_201_CREATED)
async def create_modifier_group(payload: ModifierGroupWrite, db: Session = Depends(get_db)) -> MenuModifierGroup:
    if not db.get(MenuItem, payload.menu_item_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu item not found")

    data = payload.model_dump(exclude={"options"})
    group = MenuModifierGroup(**data)
    db.add(group)
    db.flush()
    for option in payload.options:
        db.add(MenuModifierOption(group_id=group.id, **option.model_dump()))
    db.commit()
    group = load_modifier_group_or_404(group.id, db)
    await manager.broadcast("menu", {"type": "menu.updated"})
    return group


@router.put("/modifier-groups/{group_id}", response_model=ModifierGroupRead)
async def update_modifier_group(
    group_id: int,
    payload: ModifierGroupWrite,
    db: Session = Depends(get_db),
) -> MenuModifierGroup:
    group = load_modifier_group_or_404(group_id, db)
    if not db.get(MenuItem, payload.menu_item_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Menu item not found")

    for field, value in payload.model_dump(exclude={"options"}).items():
        setattr(group, field, value)
    group.options.clear()
    db.flush()
    for option in payload.options:
        db.add(MenuModifierOption(group_id=group.id, **option.model_dump()))
    db.commit()
    group = load_modifier_group_or_404(group.id, db)
    await manager.broadcast("menu", {"type": "menu.updated"})
    return group


@router.delete("/modifier-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_modifier_group(group_id: int, db: Session = Depends(get_db)) -> Response:
    group = load_modifier_group_or_404(group_id, db)
    used_option_count = (
        db.scalar(
            select(func.count())
            .select_from(OrderItemModifier)
            .where(
                OrderItemModifier.modifier_option_id.in_(
                    select(MenuModifierOption.id).where(MenuModifierOption.group_id == group_id)
                )
            )
        )
        or 0
    )
    if used_option_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Modifier has order history. Deactivate it instead of deleting.",
        )

    db.delete(group)
    db.commit()
    await manager.broadcast("menu", {"type": "menu.updated"})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


SEEDED_LOCATIONS = [
    "Main Restaurant",
    "Rooftop Terrace",
    "Poolside",
    "Room Service",
    "Banquet Hall",
    "Garden Seating",
    "Lobby Lounge",
]


@router.get("/locations", response_model=list[str])
def list_locations(db: Session = Depends(get_db)) -> list[str]:
    in_use = [
        location
        for location in db.scalars(select(RestaurantTable.location).distinct().order_by(RestaurantTable.location))
        if location
    ]
    return list(dict.fromkeys([*SEEDED_LOCATIONS, *in_use]))


@router.get("/tables", response_model=list[TableRead])
def list_tables(db: Session = Depends(get_db)) -> list[RestaurantTable]:
    return list(db.scalars(select(RestaurantTable).order_by(RestaurantTable.label)))


@router.post("/tables", response_model=TableRead, status_code=status.HTTP_201_CREATED)
def create_table(payload: TableWrite, db: Session = Depends(get_db)) -> RestaurantTable:
    existing = db.scalar(select(RestaurantTable).where(RestaurantTable.qr_token == payload.qr_token))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="QR token already exists")

    table = RestaurantTable(**payload.model_dump())
    db.add(table)
    db.commit()
    db.refresh(table)
    return table


@router.put("/tables/{table_id}", response_model=TableRead)
def update_table(table_id: int, payload: TableWrite, db: Session = Depends(get_db)) -> RestaurantTable:
    table = db.get(RestaurantTable, table_id)
    if not table:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Table not found")

    existing = db.scalar(
        select(RestaurantTable).where(RestaurantTable.qr_token == payload.qr_token, RestaurantTable.id != table_id)
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="QR token already exists")

    for field, value in payload.model_dump().items():
        setattr(table, field, value)
    db.commit()
    db.refresh(table)
    return table


@router.delete("/tables/{table_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_table(table_id: int, db: Session = Depends(get_db)) -> Response:
    table = db.get(RestaurantTable, table_id)
    if not table:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Table not found")

    session_count = db.scalar(select(func.count()).select_from(DiningSession).where(DiningSession.table_id == table_id)) or 0
    if session_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="QR mapping has dining sessions. Deactivate it instead of deleting.",
        )

    db.delete(table)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/users", response_model=list[UserRead])
def list_users(db: Session = Depends(get_db)) -> list[User]:
    return list(db.scalars(select(User).order_by(User.role, User.name)))


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserWrite, db: Session = Depends(get_db)) -> User:
    if payload.role not in {"admin", "kitchen", "service"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported role")
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User email already exists")

    user = User(
        name=payload.name,
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=payload.is_active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/users/{user_id}", response_model=UserRead)
def update_user(user_id: int, payload: UserUpdate, db: Session = Depends(get_db)) -> User:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if payload.role not in {"admin", "kitchen", "service"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported role")

    existing = db.scalar(select(User).where(User.email == payload.email, User.id != user_id))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User email already exists")
    if user.role == "admin" and (payload.role != "admin" or not payload.is_active):
        active_admin_count = (
            db.scalar(
                select(func.count())
                .select_from(User)
                .where(User.role == "admin", User.is_active.is_(True), User.id != user_id)
            )
            or 0
        )
        if active_admin_count == 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="At least one active admin user is required",
            )

    user.name = payload.name
    user.email = payload.email
    user.role = payload.role
    user.is_active = payload.is_active
    if payload.password:
        user.password_hash = hash_password(payload.password)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Response:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You cannot delete your own user account")
    if user.role == "admin" and user.is_active:
        active_admin_count = (
            db.scalar(
                select(func.count())
                .select_from(User)
                .where(User.role == "admin", User.is_active.is_(True), User.id != user_id)
            )
            or 0
        )
        if active_admin_count == 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="At least one active admin user is required",
            )

    db.delete(user)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/sessions", response_model=list[SessionSummary])
def list_sessions(db: Session = Depends(get_db)) -> list[SessionSummary]:
    sessions = db.scalars(
        select(DiningSession)
        .options(
            selectinload(DiningSession.table),
            selectinload(DiningSession.orders).selectinload(Order.items),
            selectinload(DiningSession.payments),
        )
        .order_by(DiningSession.opened_at.desc())
    )
    return [build_session_summary(session) for session in sessions]


@router.get("/sessions/{session_id}", response_model=SessionSummary)
def get_admin_session(session_id: int, db: Session = Depends(get_db)) -> SessionSummary:
    return build_session_summary(load_session_or_404(session_id, db))


@router.post("/sessions/{session_id}/payments", response_model=SessionSummary)
async def record_payment(session_id: int, payload: PaymentCreate, db: Session = Depends(get_db)) -> SessionSummary:
    return await record_session_payment(db, session_id, payload.amount, payload.method, payload.provider_reference)


@router.get("/reports/summary", response_model=SalesSummary)
def sales_summary(db: Session = Depends(get_db)) -> SalesSummary:
    open_sessions = db.scalar(select(func.count()).select_from(DiningSession).where(DiningSession.status == "active")) or 0
    completed_sessions = (
        db.scalar(select(func.count()).select_from(DiningSession).where(DiningSession.status == "completed")) or 0
    )
    order_count = db.scalar(select(func.count()).select_from(Order)) or 0
    gross_sales = db.scalar(select(func.coalesce(func.sum(Order.total_amount), 0))) or 0
    paid_total = db.scalar(select(func.coalesce(func.sum(Payment.amount), 0)).where(Payment.status == "recorded")) or 0
    bill_requested_count = (
        db.scalar(select(func.count()).select_from(DiningSession).where(DiningSession.payment_state == "bill_requested")) or 0
    )
    return SalesSummary(
        open_sessions=open_sessions,
        completed_sessions=completed_sessions,
        order_count=order_count,
        gross_sales=gross_sales,
        paid_total=paid_total,
        bill_requested_count=bill_requested_count,
    )


@router.get("/reports/item-sales", response_model=list[ItemSalesRow])
def item_sales(db: Session = Depends(get_db)) -> list[ItemSalesRow]:
    rows = db.execute(
        select(
            OrderItem.menu_item_id,
            OrderItem.name_snapshot,
            func.coalesce(func.sum(OrderItem.quantity), 0),
            func.coalesce(func.sum(OrderItem.unit_price * OrderItem.quantity), 0),
        )
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.status != "cancelled")
        .group_by(OrderItem.menu_item_id, OrderItem.name_snapshot)
        .order_by(func.sum(OrderItem.quantity).desc())
    )
    return [
        ItemSalesRow(menu_item_id=row[0], item_name=row[1], quantity=row[2], gross_sales=row[3])
        for row in rows
    ]


@router.get("/reports/item-sales.csv")
def item_sales_csv(db: Session = Depends(get_db)) -> Response:
    rows = item_sales(db)
    lines = ["menu_item_id,item_name,quantity,gross_sales"]
    for row in rows:
        safe_name = row.item_name.replace('"', '""')
        lines.append(f'{row.menu_item_id},"{safe_name}",{row.quantity},{row.gross_sales}')
    return Response("\n".join(lines), media_type="text/csv")


def load_modifier_group_or_404(group_id: int, db: Session) -> MenuModifierGroup:
    group = db.scalar(
        select(MenuModifierGroup)
        .where(MenuModifierGroup.id == group_id)
        .options(selectinload(MenuModifierGroup.options))
    )
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Modifier group not found")
    return group
