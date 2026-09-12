from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    name: str


class LoginRequest(BaseModel):
    email: str
    password: str


class UserRead(BaseModel):
    id: int
    name: str
    email: str
    role: str
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


class UserWrite(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=120)
    role: str = "service"
    is_active: bool = True


class UserUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=255)
    password: str | None = Field(default=None, min_length=8, max_length=120)
    role: str = "service"
    is_active: bool = True


class ModifierOptionRead(BaseModel):
    id: int
    group_id: int
    name: str
    price_delta: Decimal
    is_active: bool
    display_order: int

    model_config = ConfigDict(from_attributes=True)


class ModifierGroupRead(BaseModel):
    id: int
    menu_item_id: int
    name: str
    min_select: int
    max_select: int
    is_required: bool
    display_order: int
    is_active: bool
    options: list[ModifierOptionRead] = []

    model_config = ConfigDict(from_attributes=True)


class MenuItemRead(BaseModel):
    id: int
    category_id: int
    name: str
    description: str
    price: Decimal
    image_url: str | None
    is_available: bool
    is_active: bool
    display_order: int
    stock_quantity: int | None = None
    modifier_groups: list[ModifierGroupRead] = []

    model_config = ConfigDict(from_attributes=True)


class MenuItemWrite(BaseModel):
    category_id: int
    name: str = Field(min_length=2, max_length=160)
    description: str = ""
    price: Decimal = Field(gt=0)
    image_url: str | None = None
    is_available: bool = True
    is_active: bool = True
    display_order: int = 0
    stock_quantity: int | None = Field(default=None, ge=0)


class ModifierOptionWrite(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    price_delta: Decimal = Decimal("0.00")
    is_active: bool = True
    display_order: int = 0


class ModifierGroupWrite(BaseModel):
    menu_item_id: int
    name: str = Field(min_length=1, max_length=120)
    min_select: int = Field(ge=0, default=0)
    max_select: int = Field(ge=1, default=1)
    is_required: bool = False
    display_order: int = 0
    is_active: bool = True
    options: list[ModifierOptionWrite] = []


class CategoryRead(BaseModel):
    id: int
    name: str
    display_order: int
    is_active: bool
    items: list[MenuItemRead] = []

    model_config = ConfigDict(from_attributes=True)


class CategoryWrite(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    display_order: int = 0
    is_active: bool = True


class TableRead(BaseModel):
    id: int
    label: str
    qr_token: str
    location: str
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


class TableWrite(BaseModel):
    label: str = Field(min_length=2, max_length=80)
    qr_token: str = Field(min_length=4, max_length=120)
    location: str = "Restaurant"
    is_active: bool = True


class QRSessionResponse(BaseModel):
    session_id: int
    table: TableRead
    status: str
    payment_state: str


class CartItemIn(BaseModel):
    menu_item_id: int
    quantity: int = Field(ge=1, le=50)
    note: str = ""
    modifier_option_ids: list[int] = []


class OrderCreate(BaseModel):
    items: list[CartItemIn] = Field(min_length=1)
    customer_note: str = ""


class OrderItemRead(BaseModel):
    id: int
    menu_item_id: int
    name_snapshot: str
    unit_price: Decimal
    quantity: int
    note: str
    modifiers: list["OrderItemModifierRead"] = []

    model_config = ConfigDict(from_attributes=True)


class OrderItemModifierRead(BaseModel):
    id: int
    modifier_option_id: int | None
    group_name_snapshot: str
    option_name_snapshot: str
    price_delta: Decimal

    model_config = ConfigDict(from_attributes=True)


class OrderRead(BaseModel):
    id: int
    session_id: int
    reference: str
    status: str
    customer_note: str
    total_amount: Decimal
    created_at: datetime
    updated_at: datetime
    items: list[OrderItemRead]

    model_config = ConfigDict(from_attributes=True)


class StaffOrderRead(OrderRead):
    table_id: int
    table_label: str
    session_payment_state: str


class OrderStatusUpdate(BaseModel):
    status: str
    note: str = ""


class SessionSummary(BaseModel):
    id: int
    table: TableRead
    status: str
    payment_state: str
    opened_at: datetime
    closed_at: datetime | None
    orders: list[OrderRead]
    total_amount: Decimal

    model_config = ConfigDict(from_attributes=True)


class PaymentCreate(BaseModel):
    amount: Decimal = Field(gt=0)
    method: str = "cash"
    provider_reference: str | None = None


class SalesSummary(BaseModel):
    open_sessions: int
    completed_sessions: int
    order_count: int
    gross_sales: Decimal
    paid_total: Decimal
    bill_requested_count: int


class ItemSalesRow(BaseModel):
    menu_item_id: int
    item_name: str
    quantity: int
    gross_sales: Decimal


class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys


class RazorpayOrderRead(BaseModel):
    order_id: str
    amount: int
    currency: str
    key_id: str


class RazorpayVerify(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class NotificationRead(BaseModel):
    id: int
    title: str
    body: str
    url: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PushUnsubscribeIn(BaseModel):
    endpoint: str
