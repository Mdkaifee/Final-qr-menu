from sqlalchemy import text

from app.db.session import engine


def apply_startup_migrations() -> None:
    """Small dev-safe migrations for this scaffold until Alembic is enabled."""
    statements = [
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(120)",
        "CREATE INDEX IF NOT EXISTS ix_orders_idempotency_key ON orders (idempotency_key)",
        "ALTER TABLE order_items DROP CONSTRAINT IF EXISTS uq_order_item_note",
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_session_order_idempotency
        ON orders (session_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL
        """,
        "ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS stock_quantity INTEGER",
        """
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id SERIAL PRIMARY KEY,
            target_type VARCHAR(20) NOT NULL,
            target_key VARCHAR(120) NOT NULL,
            endpoint TEXT NOT NULL,
            p256dh VARCHAR(255) NOT NULL,
            auth VARCHAR(255) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_push_subscription_endpoint UNIQUE (endpoint)
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_push_subscriptions_target_key ON push_subscriptions (target_key)",
        """
        CREATE TABLE IF NOT EXISTS notifications (
            id SERIAL PRIMARY KEY,
            target_type VARCHAR(20) NOT NULL,
            target_key VARCHAR(120) NOT NULL,
            title VARCHAR(200) NOT NULL,
            body TEXT NOT NULL DEFAULT '',
            url VARCHAR(300) NOT NULL DEFAULT '/',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_notifications_target_key ON notifications (target_key)",
        "CREATE INDEX IF NOT EXISTS ix_notifications_created_at ON notifications (created_at)",
    ]

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
