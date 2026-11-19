-- Execute como administrador do MySQL no computador que hospeda o banco.
-- Troque SENHA_FORTE_ESCOLHIDA e use a mesma senha em DB_PASSWORD no .env.
-- Para duas VMs, substitua 127.0.0.1 pelo IP da WEB01 nos dois comandos.
CREATE DATABASE IF NOT EXISTS musicbox
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'musicbox_app'@'127.0.0.1'
  IDENTIFIED BY 'SENHA_FORTE_ESCOLHIDA';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX
  ON musicbox.* TO 'musicbox_app'@'127.0.0.1';
