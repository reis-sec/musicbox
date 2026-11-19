# MusicBox com MySQL

Player web de música com login de administrador, biblioteca e envio de arquivos. O servidor usa Node.js, Express e MySQL; a interface usa HTML, CSS e JavaScript.

Os cinco endereços enviados aparecem na seção **Mais para ouvir** como links para os vídeos originais do YouTube. O MusicBox abre esses vídeos no YouTube; não baixa nem armazena o áudio.

## Requisitos

- Node.js 20 ou superior
- MySQL Server iniciado na máquina
- Terminal aberto na pasta `expomusic`

## 1. Criar o banco e o usuário MySQL

No MySQL Workbench, conectado como administrador, execute os comandos abaixo. Troque `SENHA_FORTE_ESCOLHIDA` por uma senha criada por você e guarde-a para preencher o `.env`.

```sql
CREATE DATABASE musicbox
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'musicbox_app'@'127.0.0.1'
  IDENTIFIED BY 'SENHA_FORTE_ESCOLHIDA';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX
  ON musicbox.* TO 'musicbox_app'@'127.0.0.1';
```

O app cria as tabelas quando inicia. O usuário `musicbox_app` tem permissões apenas no banco `musicbox`.

## 2. Configurar e iniciar

Se ainda não existir um arquivo `.env`, copie `.env.example` para `.env`. Se já existir, edite o arquivo existente sem apagar `ADMIN_USERNAME` e `ADMIN_PASSWORD`. Preencha `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD` e `MYSQL_DATABASE`; a senha MySQL deve ser a mesma escolhida no passo anterior. A senha do administrador do site é separada e precisa ter pelo menos 12 caracteres.

PowerShell:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
npm install
npm start
```

Abra `http://127.0.0.1:3000`. A conta do site é separada da conta MySQL. O site guarda somente o hash da senha do administrador.

## 3. Publicar com ngrok

Com o servidor rodando, abra outro terminal na mesma máquina e execute:

```powershell
ngrok http 3000
```

Use o endereço HTTPS exibido pelo ngrok. O túnel torna o site acessível pela internet; use senha forte e envie apenas músicas que você tenha autorização para compartilhar.

## Arquivos e dados

- `.env`: credenciais locais; não compartilhe nem envie ao Git.
- `storage/music/`: arquivos de áudio enviados, até 30 MB cada.
- Banco MySQL `musicbox`: conta do administrador, sessões e catálogo.
- Para alterar a senha do site, entre como administrador e use **Alterar senha**.

Este código cria um banco MySQL novo. Os registros que porventura estejam no banco SQLite da versão anterior não são importados automaticamente. Os arquivos de áudio existentes em `storage/music/` são mantidos; para listá-los, envie-os pelo site depois de iniciar a nova versão.
