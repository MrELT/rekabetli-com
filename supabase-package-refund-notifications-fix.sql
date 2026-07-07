-- Paket iade bildirim tipleri: notifications_type_check eksik tipler
-- supabase-package-purchase-notifications.sql sonrasında bir kez çalıştırın.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
ADD CONSTRAINT notifications_type_check
CHECK (
  type IN (
    'comment',
    'like',
    'community_join_request',
    'community_join_rejected',
    'community_post',
    'mentor_package_request',
    'mentor_student_message',
    'mentor_mentor_reply',
    'mentor_meeting_proposal',
    'mentor_meeting_confirmed',
    'mentor_meeting_postpone',
    'mentor_meeting_postpone_accepted',
    'mentor_meeting_refund_requested',
    'mentor_meeting_reminder_1d',
    'mentor_meeting_reminder_30m',
    'mentor_vitrin_active',
    'answer_reply',
    'mentor_package_purchased',
    'mentor_package_sale',
    'mentor_package_refund_requested',
    'mentor_package_refunded'
  )
) NOT VALID;
