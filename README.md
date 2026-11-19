# MusicBox

## Rodar em um único computador Windows

Neste modo, o site e o MySQL rodam no computador da escola. Abra o navegador nesse mesmo computador para acessar o MusicBox.

### 1. Baixar e extrair o projeto

1. Abra o repositório no GitHub e clique em **Code → Download ZIP**. [MusicBox no GitHub](https://github.com/reis-sec/musicbox)
2. No Explorador de Arquivos, clique com o botão direito no ZIP e escolha **Extrair Tudo**.
3. Abra a pasta extraída que contém `package.json`, `server.js` e `mysql-setup.sql`. Para abrir o PowerShell nessa pasta, digite `powershell` na barra de endereços do Explorador e pressione Enter.

### 2. Instalar o Node.js e preparar o MySQL

1. Instale o Node.js 24 LTS para Windows. Depois da instalação, abra um novo PowerShell na pasta do projeto e confira os comandos abaixo. [Download do Node.js](https://nodejs.org/en/download)

   ```powershell
   node --version
   npm.cmd --version
   ```

2. Instale o **MySQL Community Server 8.4** pelo instalador MSI e abra o **MySQL Configurator**. Configure o servidor como serviço do Windows, selecione a porta TCP `3306` e defina a senha do usuário `root`. Para rodar no mesmo computador, deixe desmarcada a opção de abrir a porta do MySQL no firewall. Se a escola já tiver um MySQL instalado e rodando, use o serviço existente e confirme a porta e quem pode executar comandos administrativos. A instalação pode exigir a conta de administrador do Windows. [Guia de instalação do MySQL no Windows](https://dev.mysql.com/doc/refman/8.4/en/windows-installation.html)

3. Confira se a porta do MySQL está respondendo. Se o MySQL instalado usar outra porta, substitua `3306` neste comando e em `DB_PORT` no passo 4.

   ```powershell
   Test-NetConnection 127.0.0.1 -Port 3306
   ```

   O resultado esperado é `TcpTestSucceeded : True`.

### 3. Criar o banco e o usuário da aplicação

1. Abra [mysql-setup.sql](mysql-setup.sql) no Bloco de Notas. Substitua `SENHA_FORTE_ESCOLHIDA` por uma senha nova para `musicbox_app`. Mantenha `127.0.0.1` nos dois comandos para o modo local. Salve o arquivo.
2. No menu Iniciar do Windows, abra **MySQL 8.4 Command Line Client** e digite a senha do `root` quando solicitada. No prompt `mysql>`, cole os comandos SQL do arquivo e pressione Enter. Se preferir usar o Workbench, conecte-se ao MySQL local como administrador, abra o arquivo SQL e execute o script inteiro. O banco `musicbox` será criado e o aplicativo criará as tabelas na primeira inicialização.

### 4. Configurar o arquivo .env

No PowerShell aberto na pasta do projeto, execute:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

Use os valores abaixo como referência. Em `DB_PASSWORD`, coloque a senha escolhida para `musicbox_app` no passo 3. Em `ADMIN_PASSWORD`, coloque outra senha, de pelo menos 12 caracteres, para entrar no site. Salve e feche o Bloco de Notas.

```dotenv
HOST=127.0.0.1
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=musicbox
DB_USER=musicbox_app
DB_PASSWORD=
ADMIN_USERNAME=admin
ADMIN_PASSWORD=
```

O site usa `ADMIN_USERNAME` e `ADMIN_PASSWORD` para criar o primeiro administrador do banco. Se o banco já tiver um administrador, entre com a conta que já existe. Mantenha o `.env` no computador da instalação.

### 5. Iniciar e abrir o MusicBox

Na pasta do projeto, instale as dependências uma vez e inicie o servidor:

```powershell
npm.cmd ci
npm.cmd start
```

1. Deixe o PowerShell aberto enquanto usa o site.
2. Abra [http://127.0.0.1:3000](http://127.0.0.1:3000) no navegador. Entre com o usuário e a senha de administrador do site.
3. Para conferir o banco, abra [http://127.0.0.1:3000/api/health](http://127.0.0.1:3000/api/health). O resultado esperado é `{"status":"ok","database":"connected"}`.
4. Para parar o servidor, pressione **Ctrl+C**. Para abrir o MusicBox em outro dia, confirme que o MySQL está rodando, abra o PowerShell na pasta do projeto e execute `npm.cmd start`.

### Se aparecer um erro

| Mensagem | O que conferir |
| --- | --- |
| `npm.cmd` não é reconhecido | Reabra o PowerShell depois de instalar o Node.js. |
| O npm não encontra `package.json` | Abra o PowerShell na pasta extraída que contém o arquivo. |
| `ECONNREFUSED` | Confira se o serviço MySQL está rodando e se `DB_PORT` corresponde à porta do serviço. |
| `ER_ACCESS_DENIED_ERROR` | Confira `DB_USER` e `DB_PASSWORD` no `.env` e a conta `musicbox_app` criada no MySQL. |
| `ER_BAD_DB_ERROR` | Execute o script SQL do passo 3 e confira `DB_NAME=musicbox`. |
| `EADDRINUSE` | Altere `PORT` no `.env` para uma porta livre, como `3001`, e use a mesma porta no navegador. |

O ZIP contém os arquivos para iniciar uma instalação. Para levar um catálogo que já existe, importe um backup do banco `musicbox` e copie os arquivos de áudio de `storage/music/` antes de iniciar o site.

## Rodar em duas VMs

O navegador acessa a **WEB01**, que roda o MusicBox em Node.js e Express. A WEB01 consulta o **MySQL da DB01** pela rede privada. O MySQL guarda a conta do administrador, as sessões e o catálogo. Os áudios enviados ficam na WEB01 em `storage/music/`, com limite de 30 MB por arquivo. Os links de **Mais para ouvir** abrem o YouTube.

```text
Navegador → WEB01 (MusicBox) → DB01 (MySQL na porta 3306)
                └─ storage/music/
```

O guia usa `192.168.1.10` para a WEB01 e `192.168.1.20` para a DB01. Substitua pelos IPs privados reais. Coloque as duas VMs em uma rede que permita comunicação entre elas e reserve endereços fixos. Para acessar o site diretamente, o computador com o navegador também precisa alcançar a WEB01.

### 1. Preparar a DB01

1. Instale o **MySQL Server** e confirme que o serviço está iniciado. No Windows Server, localize o serviço e o arquivo `my.ini` configurado para ele pelo PowerShell:

   ```powershell
   Get-CimInstance Win32_Service |
     Where-Object { $_.PathName -match 'mysqld\.exe' } |
     Select-Object Name, State, PathName
   ```

2. Na seção `[mysqld]` do `my.ini`, configure a escuta no IP privado da DB01 e no endereço de loopback para administração local. Este exemplo usa MySQL 8.4. Reinicie o serviço pelo nome retornado acima. Em Ubuntu, a configuração normalmente fica em `/etc/mysql/mysql.conf.d/mysqld.cnf` e o reinício é feito com `sudo systemctl restart mysql`.

   ```ini
   [mysqld]
   bind-address = 127.0.0.1,192.168.1.20
   port = 3306
   ```

3. Na DB01, abra uma conexão administrativa local no Workbench ou no cliente `mysql`. Edite e execute [mysql-setup.sql](mysql-setup.sql). Troque `127.0.0.1` nos dois comandos pelo IP da **WEB01** e escolha uma senha forte para `musicbox_app`. Se essa conta já existir para o mesmo IP e você quiser definir outra senha, use `ALTER USER` no lugar de `CREATE USER`. O MusicBox cria as tabelas ao iniciar e por isso a conta tem permissão `CREATE` no schema `musicbox`.
4. No PowerShell **como administrador da DB01**, permita tráfego para 3306 vindo da WEB01. Substitua os IPs no comando e confira se já existe alguma regra de entrada mais ampla para a mesma porta ou para o serviço MySQL. Em Ubuntu com UFW ativo, o equivalente é `sudo ufw allow from 192.168.1.10 to 192.168.1.20 port 3306 proto tcp`.

   ```powershell
   New-NetFirewallRule -DisplayName "MusicBox MySQL da WEB01" -Direction Inbound -Action Allow -Protocol TCP -LocalAddress 192.168.1.20 -LocalPort 3306 -RemoteAddress 192.168.1.10
   ```

Referências do [MySQL sobre bind-address](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_bind_address) e da [Microsoft sobre regras de firewall](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule).

### 2. Migrar os dados existentes, se houver

Pare a instância antiga do MusicBox antes de fazer a cópia final. No servidor antigo, exporte o schema `musicbox` com **Data Export** do Workbench ou com `mysqldump`. Importe o arquivo na DB01 antes de iniciar o novo MusicBox. Para manter as faixas já cadastradas, copie também toda a pasta `storage/music/` para a WEB01, preservando os nomes dos arquivos.

Com o cliente MySQL no PATH, este exemplo de exportação funciona no PowerShell e evita a conversão de encoding do redirecionamento do PowerShell. Execute na máquina que roda o banco antigo e ajuste o usuário e o host conforme necessário:

```powershell
mysqldump --host=127.0.0.1 --user=root --password --single-transaction --no-tablespaces --result-file=musicbox.sql musicbox
```

Na DB01, importe com **Data Import** do Workbench escolhendo o schema `musicbox`. Também é possível abrir o cliente `mysql` com `mysql --user=root --password musicbox` e executar `SOURCE C:/caminho/musicbox.sql` no prompt do MySQL. Os registros de uma instalação antiga em SQLite exigem uma migração separada. [Manual do mysqldump](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html)

### 3. Preparar a WEB01

1. Instale [Node.js 24 LTS](https://nodejs.org/en/about/previous-releases). Transfira a pasta do projeto para a WEB01. Instale as dependências na própria VM com `npm.cmd ci` no Windows ou `npm ci` no Linux. Configure o `.env` na WEB01 a partir de [.env.example](.env.example). Em um `.env` antigo, os nomes `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER` e `MYSQL_PASSWORD` continuam aceitos. Se uma chave `DB_*` também estiver definida, ela tem prioridade sobre a equivalente antiga.

   ```dotenv
   HOST=192.168.1.10
   PORT=3000
   DB_HOST=192.168.1.20
   DB_PORT=3306
   DB_NAME=musicbox
   DB_USER=musicbox_app
   DB_PASSWORD=SENHA_DEFINIDA_NO_MYSQL
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=DEFINA_UMA_SENHA_DO_SITE
   ```

   `HOST` é o endereço onde o site escuta na WEB01. `DB_HOST` é o endereço da DB01. `ADMIN_USERNAME` e `ADMIN_PASSWORD` só são usados para criar o primeiro administrador de um banco vazio. Escolha uma senha do site com pelo menos 12 caracteres. Guarde o `.env` na WEB01 e mantenha-o fora do Git.

2. Teste a conexão TCP a partir da WEB01. No Windows, confirme que `TcpTestSucceeded` aparece como `True`. Em Linux, use `nc -vz -w 3 192.168.1.20 3306`. Se falhar, confirme os IPs, a porta, o endereço de escuta do MySQL e o firewall. [Documentação do Test-NetConnection](https://learn.microsoft.com/en-us/powershell/module/nettcpip/test-netconnection)

   ```powershell
   Test-NetConnection 192.168.1.20 -Port 3306
   ```

3. Inicie com `npm.cmd start` no Windows ou `npm start` no Linux. Para acesso direto em uma rede de laboratório, permita a porta TCP 3000 no firewall da WEB01 para o computador ou a sub-rede que vai acessar o site. Abra `http://192.168.1.10:3000` no navegador. Em `http://192.168.1.10:3000/api/health`, o resultado esperado é `{"status":"ok","database":"connected"}`.

Se a porta 3306 responder mas a inicialização falhar, `ER_ACCESS_DENIED_ERROR` indica que vale conferir o IP autorizado no usuário MySQL e a senha em `DB_PASSWORD`. `ER_BAD_DB_ERROR` indica que o schema configurado em `DB_NAME` precisa existir na DB01.

### Acesso pelo proxy da WEB01

Para usar a mesma disposição da distribuidora, configure `HOST=127.0.0.1` na WEB01 e encaminhe o tráfego do Nginx para `http://127.0.0.1:3000`. No bloco `location /`, configure `proxy_set_header Host $host;` e `proxy_set_header X-Forwarded-Proto $scheme;`. Defina `client_max_body_size 32m;` no bloco `server` para acomodar os uploads de 30 MB e os campos adicionais do formulário. Libere somente a porta do proxy no firewall da WEB01. Para publicar fora da rede de laboratório, use HTTPS. [Limite de envio no Nginx](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size)

Para usar o ngrok na própria WEB01, mantenha `HOST=127.0.0.1` e execute `ngrok http 3000` em outro terminal.
