-- Recent second-factor verification for sensitive administrator operations.
-- NULL means the session has not completed a fresh step-up. Login MFA counts
-- as a step-up because the session is created only after the challenge passes.

ALTER TABLE admin_sessions ADD COLUMN step_up_at TEXT;
