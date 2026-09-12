from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_staff
from app.api.guest import load_session_or_404
from app.core.config import get_settings
from app.db.models import Notification, PushSubscription, User
from app.db.session import get_db
from app.schemas import NotificationRead, PushSubscriptionIn, PushUnsubscribeIn

router = APIRouter(prefix="/push", tags=["push"])
NOTIFICATION_PAGE_SIZE = 50


@router.get("/public-key")
def get_public_key() -> dict:
    return {"public_key": get_settings().vapid_public_key}


def upsert_subscription(db: Session, target_type: str, target_key: str, payload: PushSubscriptionIn) -> None:
    existing = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == payload.endpoint))
    if existing:
        existing.target_type = target_type
        existing.target_key = target_key
        existing.p256dh = payload.keys.p256dh
        existing.auth = payload.keys.auth
    else:
        db.add(
            PushSubscription(
                target_type=target_type,
                target_key=target_key,
                endpoint=payload.endpoint,
                p256dh=payload.keys.p256dh,
                auth=payload.keys.auth,
            )
        )
    db.commit()


@router.post("/subscribe/session/{session_id}", status_code=204)
def subscribe_session(session_id: int, payload: PushSubscriptionIn, db: Session = Depends(get_db)) -> None:
    load_session_or_404(session_id, db)
    upsert_subscription(db, "session", str(session_id), payload)


@router.post("/subscribe/staff", status_code=204)
def subscribe_staff(
    payload: PushSubscriptionIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_staff),
) -> None:
    upsert_subscription(db, "role", user.role, payload)


@router.delete("/subscribe", status_code=204)
def unsubscribe(payload: PushUnsubscribeIn, db: Session = Depends(get_db)) -> None:
    existing = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == payload.endpoint))
    if existing:
        db.delete(existing)
        db.commit()


def list_notifications(db: Session, target_type: str, target_key: str) -> list[Notification]:
    return list(
        db.scalars(
            select(Notification)
            .where(Notification.target_type == target_type, Notification.target_key == target_key)
            .order_by(Notification.created_at.desc())
            .limit(NOTIFICATION_PAGE_SIZE)
        )
    )


@router.get("/notifications/session/{session_id}", response_model=list[NotificationRead])
def get_session_notifications(session_id: int, db: Session = Depends(get_db)) -> list[Notification]:
    load_session_or_404(session_id, db)
    return list_notifications(db, "session", str(session_id))


@router.get("/notifications/staff", response_model=list[NotificationRead])
def get_staff_notifications(db: Session = Depends(get_db), user: User = Depends(require_staff)) -> list[Notification]:
    return list_notifications(db, "role", user.role)
