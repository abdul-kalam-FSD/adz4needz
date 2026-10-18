-- Lead management. Requires MySQL 8.0+. Timestamps are UTC.

-- Lead statuses are DATA, not code: the PDF does not list them. The proposed starter list is in
-- migration 004 and can be changed with plain SQL once the TL confirms the real list.
-- closes_follow_up = 1 means leads in that status are not counted as overdue/upcoming follow-ups.
CREATE TABLE lead_statuses (
  id               SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name             VARCHAR(60) NOT NULL,
  sort_order       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  closes_follow_up TINYINT(1) NOT NULL DEFAULT 0,
  is_active        TINYINT(1) NOT NULL DEFAULT 1,
  created_at       DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lead_statuses_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE leads (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id              BIGINT UNSIGNED NOT NULL,        -- the responsible BDE (owner)
  candidate_name       VARCHAR(120) NOT NULL,
  phone                VARCHAR(20)  NULL,
  phone_key            VARCHAR(15)  NULL,               -- digits only (last 10 if >= 10); used only to flag possible duplicates
  email                VARCHAR(254) NULL,
  email_key            VARCHAR(254) NULL,               -- lower-case email; used only to flag possible duplicates
  course_or_internship VARCHAR(150) NOT NULL,           -- free text until TL decides on a fixed list
  lead_status_id       SMALLINT UNSIGNED NOT NULL,
  follow_up_date       DATE NULL,
  next_action          VARCHAR(500) NULL,
  created_at           DATETIME NOT NULL,
  updated_at           DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_leads_user_followup (user_id, follow_up_date),
  KEY idx_leads_followup (follow_up_date),
  KEY idx_leads_status (lead_status_id),
  KEY idx_leads_phone_key (phone_key),
  KEY idx_leads_email_key (email_key),
  CONSTRAINT fk_leads_user   FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_leads_status FOREIGN KEY (lead_status_id) REFERENCES lead_statuses (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- No UNIQUE key on phone/email on purpose: possible duplicates are warned about and need an explicit
-- confirmation, they are never blocked or merged automatically.
