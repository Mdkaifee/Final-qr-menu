from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db.models import MenuCategory, MenuItem, MenuModifierGroup, MenuModifierOption, RestaurantTable, User


def seed_database(db: Session) -> None:
    users = [
        ("Millenium Admin", "admin@millenium.local", "Admin@12345", "admin"),
        ("Kitchen Staff", "kitchen@millenium.local", "Kitchen@12345", "kitchen"),
        ("Service Staff", "service@millenium.local", "Service@12345", "service"),
    ]
    for name, email, password, role in users:
        if db.scalar(select(User).where(User.email == email)):
            continue
        db.add(
            User(
                name=name,
                email=email,
                password_hash=hash_password(password),
                role=role,
            )
        )

    if not db.scalar(select(RestaurantTable).where(RestaurantTable.qr_token == "MAH-TABLE-12")):
        db.add_all(
            [
                RestaurantTable(label="Table 12", qr_token="MAH-TABLE-12", location="Main Restaurant"),
                RestaurantTable(label="Room 704", qr_token="MAH-ROOM-704", location="In-Room Dining"),
                RestaurantTable(label="Lobby Cafe", qr_token="MAH-LOBBY-CAFE", location="Lobby"),
            ]
        )

    if not db.scalar(select(MenuCategory).where(MenuCategory.name == "Breakfast")):
        breakfast = MenuCategory(name="Breakfast", display_order=1)
        mains = MenuCategory(name="Main Course", display_order=2)
        drinks = MenuCategory(name="Beverages", display_order=3)
        desserts = MenuCategory(name="Desserts", display_order=4)

        db.add_all([breakfast, mains, drinks, desserts])
        db.flush()

        db.add_all(
            [
                MenuItem(
                    category_id=breakfast.id,
                    name="Arabic Breakfast Platter",
                    description="Eggs, labneh, olives, foul, warm bread and dates.",
                    price=Decimal("42.00"),
                    display_order=1,
                ),
                MenuItem(
                    category_id=breakfast.id,
                    name="Omelette Station",
                    description="Made-to-order omelette with cheese, herbs and vegetables.",
                    price=Decimal("28.00"),
                    display_order=2,
                ),
                MenuItem(
                    category_id=mains.id,
                    name="Chicken Kabsa",
                    description="Saudi spiced rice with roasted chicken and tomato sauce.",
                    price=Decimal("48.00"),
                    display_order=1,
                ),
                MenuItem(
                    category_id=mains.id,
                    name="Mixed Grill",
                    description="Assorted grilled kebab, kofta and chicken with rice.",
                    price=Decimal("64.00"),
                    display_order=2,
                ),
                MenuItem(
                    category_id=drinks.id,
                    name="Fresh Mint Lemonade",
                    description="Chilled lemon and mint drink.",
                    price=Decimal("16.00"),
                    display_order=1,
                ),
                MenuItem(
                    category_id=desserts.id,
                    name="Date Pancakes",
                    description="Soft pancakes with date syrup and cream.",
                    price=Decimal("24.00"),
                    display_order=1,
                ),
            ]
        )

    ensure_sample_modifiers(db)
    db.commit()


def ensure_sample_modifiers(db: Session) -> None:
    mixed_grill = db.scalar(select(MenuItem).where(MenuItem.name == "Mixed Grill"))
    if mixed_grill and not db.scalar(
        select(MenuModifierGroup).where(MenuModifierGroup.menu_item_id == mixed_grill.id, MenuModifierGroup.name == "Spice level")
    ):
        spice_group = MenuModifierGroup(
            menu_item_id=mixed_grill.id,
            name="Spice level",
            min_select=1,
            max_select=1,
            is_required=True,
            display_order=1,
        )
        db.add(spice_group)
        db.flush()
        db.add_all(
            [
                MenuModifierOption(group_id=spice_group.id, name="Mild", price_delta=Decimal("0.00"), display_order=1),
                MenuModifierOption(group_id=spice_group.id, name="Medium", price_delta=Decimal("0.00"), display_order=2),
                MenuModifierOption(group_id=spice_group.id, name="Spicy", price_delta=Decimal("0.00"), display_order=3),
            ]
        )

    omelette = db.scalar(select(MenuItem).where(MenuItem.name == "Omelette Station"))
    if omelette and not db.scalar(
        select(MenuModifierGroup).where(MenuModifierGroup.menu_item_id == omelette.id, MenuModifierGroup.name == "Add ons")
    ):
        add_on_group = MenuModifierGroup(
            menu_item_id=omelette.id,
            name="Add ons",
            min_select=0,
            max_select=3,
            is_required=False,
            display_order=1,
        )
        db.add(add_on_group)
        db.flush()
        db.add_all(
            [
                MenuModifierOption(group_id=add_on_group.id, name="Cheese", price_delta=Decimal("4.00"), display_order=1),
                MenuModifierOption(group_id=add_on_group.id, name="Mushroom", price_delta=Decimal("3.00"), display_order=2),
                MenuModifierOption(group_id=add_on_group.id, name="Turkey", price_delta=Decimal("6.00"), display_order=3),
            ]
        )
