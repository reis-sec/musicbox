-- Execute no MySQL Workbench como administrador.
-- Troque SENHA_FORTE_ESCOLHIDA e use a mesma senha em MYSQL_PASSWORD no .env.
CREATE DATABASE musicbox
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'musicbox_app'@'127.0.0.1'
  IDENTIFIED BY 'SENHA_FORTE_ESCOLHIDA';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX
  ON musicbox.* TO 'musicbox_app'@'127.0.0.1';
