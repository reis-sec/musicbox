"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const mysql = require("mysql2/promise");
const multer = require("multer");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const MUSIC_DIR = path.join(ROOT, "storage", "music");
const COOKIE_NAME = "musicbox.sid";
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_AUDIO_BYTES = 30 * 1024 * 1024;
const PASSWORD_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
let pool;
let lastSessionCleanup = 0;

function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();
fs.mkdirSync(MUSIC_DIR, { recursive: true });

const scrypt = (password, salt, length, options) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, length, options, (error, key) => error ? reject(error) : resolve(key));
});

async function makePasswordHash(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64, PASSWORD_OPTIONS);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

async function verifyPassword(password, encoded) {
  if (typeof encoded !== "string") return false;
  const [algorithm, saltHex, hashHex] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, "hex");
    const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length, PASSWORD_OPTIONS);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function readCookie(req) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name !== COOKIE_NAME) continue;
    try { return decodeURIComponent(valueParts.join("=")); } catch { return ""; }
  }
  return "";
}

function setSessionCookie(req, res, token, clear = false) {
  const attributes = [
    `${COOKIE_NAME}=${clear ? "" : encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${clear ? 0 : Math.floor(SESSION_TTL_MS / 1000)}`
  ];
  if (req.secure) attributes.push("Secure");
  res.append("Set-Cookie", attributes.join("; "));
}

async function createSession(username = null) {
  const token = crypto.randomBytes(32).toString("base64url");
  const csrfToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await pool.execute(
    "INSERT INTO sessions (token_hash, username, csrf_token, expires_at) VALUES (?, ?, ?, ?)",
    [tokenHash, username, csrfToken, expiresAt]
  );
  return {
    token,
    tokenHash,
    token_hash: tokenHash,
    username,
    csrfToken,
    csrf_token: csrfToken,
    expiresAt
  };
}

async function sessionMiddleware(req, res, next) {
  try {
    const now = Date.now();
    if (now - lastSessionCleanup > 15 * 60 * 1000) {
      await pool.execute("DELETE FROM sessions WHERE expires_at <= ?", [now]);
      lastSessionCleanup = now;
    }

    const presentedToken = readCookie(req);
    const tokenHash = presentedToken
      ? crypto.createHash("sha256").update(presentedToken).digest("hex")
      : "";
    let row = null;
    if (tokenHash) {
      const [rows] = await pool.execute(
        "SELECT token_hash, username, csrf_token, expires_at FROM sessions WHERE token_hash = ? LIMIT 1",
        [tokenHash]
      );
      row = rows[0] || null;
    }

    if (row && Number(row.expires_at) <= now) {
      await pool.execute("DELETE FROM sessions WHERE token_hash = ?", [row.token_hash]);
      row = null;
    }

    if (!row) {
      row = await createSession();
      setSessionCookie(req, res, row.token);
    } else {
      row.expires_at = now + SESSION_TTL_MS;
      await pool.execute("UPDATE sessions SET expires_at = ? WHERE token_hash = ?", [row.expires_at, row.token_hash]);
    }

    req.musicSession = row;
    next();
  } catch (error) {
    next(error);
  }
}

function requireCsrf(req, res, next) {
  if (!safeEqual(req.get("x-csrf-token"), req.musicSession?.csrf_token)) {
    return res.status(403).json({ error: "Sessão expirada. Atualize a página e tente novamente." });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.musicSession?.username) return res.status(401).json({ error: "Entre na sua conta para continuar." });
  next();
}

const loginAttempts = new Map();
function limitLoginAttempts(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  let entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= now) entry = { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (entry.count >= 10) {
    return res.status(429).json({ error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." });
  }
  entry.count += 1;
  loginAttempts.set(key, entry);
  if (loginAttempts.size > 1000) {
    for (const [storedKey, storedEntry] of loginAttempts) {
      if (storedEntry.resetAt <= now) loginAttempts.delete(storedKey);
    }
  }
  next();
}

const allowedAudio = new Map([
  [".mp3", new Set(["audio/mpeg", "audio/mp3"])],
  [".m4a", new Set(["audio/mp4", "audio/x-m4a", "audio/m4a"])],
  [".wav", new Set(["audio/wav", "audio/x-wav", "audio/wave"])],
  [".ogg", new Set(["audio/ogg", "application/ogg"])],
  [".flac", new Set(["audio/flac", "audio/x-flac"])],
  [".aac", new Set(["audio/aac", "audio/x-aac"])],
  [".webm", new Set(["audio/webm"])]
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, MUSIC_DIR),
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      callback(null, `${crypto.randomUUID()}${extension}`);
    }
  }),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 2, parts: 3, fieldSize: 1200 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const mimeTypes = allowedAudio.get(extension);
    if (!mimeTypes || !mimeTypes.has(file.mimetype)) {
      return callback(new Error("Formato não aceito. Envie MP3, M4A, WAV, OGG, FLAC, AAC ou WEBM."));
    }
    callback(null, true);
  }
});

async function createTables() {
  await pool.query(`CREATE TABLE IF NOT EXISTS admins (
    username VARCHAR(64) NOT NULL PRIMARY KEY,
    password_hash VARCHAR(255) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await pool.query(`CREATE TABLE IF NOT EXISTS tracks (
    id CHAR(36) NOT NULL PRIMARY KEY,
    title VARCHAR(80) NOT NULL,
    artist VARCHAR(80) NOT NULL,
    storage_name VARCHAR(80) NOT NULL UNIQUE,
    mime_type VARCHAR(100) NOT NULL,
    original_name VARCHAR(180) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY tracks_created_idx (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await pool.query(`CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) NOT NULL PRIMARY KEY,
    username VARCHAR(64) NULL,
    csrf_token CHAR(43) NOT NULL,
    expires_at BIGINT UNSIGNED NOT NULL,
    KEY sessions_expiry_idx (expires_at),
    KEY sessions_username_idx (username)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

async function seedAdmin() {
  const [rows] = await pool.execute("SELECT username FROM admins LIMIT 1");
  if (rows.length) return;
  const username = cleanText(process.env.ADMIN_USERNAME, 64);
  const password = process.env.ADMIN_PASSWORD || "";
  if (!username || password.length < 12 || password.includes("COLOQUE_AQUI")) {
    throw new Error("Configure ADMIN_USERNAME e ADMIN_PASSWORD (mínimo de 12 caracteres) no .env antes de iniciar.");
  }
  const passwordHash = await makePasswordHash(password);
  await pool.execute(
    "INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, UTC_TIMESTAMP(3))",
    [username, passwordHash]
  );
  console.log(`Conta de administrador criada: ${username}`);
}

function getMysqlConfig() {
  const host = process.env.DB_HOST ?? process.env.MYSQL_HOST ?? "127.0.0.1";
  const user = process.env.DB_USER ?? process.env.MYSQL_USER;
  const password = process.env.DB_PASSWORD ?? process.env.MYSQL_PASSWORD;
  const database = process.env.DB_NAME ?? process.env.MYSQL_DATABASE;
  const port = Number(process.env.DB_PORT ?? process.env.MYSQL_PORT ?? "3306");
  if (!host || !user || !password || !database || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Configure DB_HOST, DB_PORT, DB_USER, DB_PASSWORD e DB_NAME no .env.");
  }
  return { host, port, user, password, database };
}

async function start() {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Configure PORT com um número inteiro de 1 a 65535 no .env.");
  }

  const dbConfig = getMysqlConfig();
  pool = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 6,
    queueLimit: 50,
    charset: "utf8mb4",
    timezone: "Z",
    supportBigNumbers: true,
    bigNumberStrings: true,
    enableKeepAlive: true
  });

  try {
    const connection = await pool.getConnection();
    try {
      await connection.ping();
    } finally {
      connection.release();
    }
    await createTables();
    await seedAdmin();
  } catch (error) {
    await pool.end().catch(() => {});
    if (error.message?.startsWith("Configure ")) throw error;
    const code = error.code || error.name;
    throw new Error(`Falha ao iniciar o MySQL em ${dbConfig.host}:${dbConfig.port} (${code}). Confira rede, credenciais e permissões do banco.`);
  }

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    next();
  });
  app.get("/api/health", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok", database: "connected" });
    } catch {
      res.status(503).json({ status: "unavailable", database: "disconnected" });
    }
  });

  app.use(express.static(PUBLIC_DIR, { index: false, maxAge: "1h" }));
  app.use(express.json({ limit: "16kb" }));
  app.use(asyncHandler(sessionMiddleware));

  app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
  app.get("/api/csrf", (req, res) => res.json({ csrfToken: req.musicSession.csrf_token }));
  app.get("/api/me", requireAdmin, (req, res) => res.json({ username: req.musicSession.username }));

  app.post("/api/login", requireCsrf, limitLoginAttempts, asyncHandler(async (req, res) => {
    const username = cleanText(req.body?.username, 64);
    const password = typeof req.body?.password === "string" ? req.body.password.slice(0, 256) : "";
    const [adminRows] = await pool.execute("SELECT username, password_hash FROM admins LIMIT 1");
    const admin = adminRows[0];
    if (!admin) return res.status(503).json({ error: "A conta de administrador ainda não foi configurada." });
    const [accountRows] = await pool.execute("SELECT username, password_hash FROM admins WHERE username = ? LIMIT 1", [username]);
    const account = accountRows[0];
    const passwordMatches = await verifyPassword(password, account?.password_hash || admin.password_hash);
    if (!account || !passwordMatches) return res.status(401).json({ error: "Usuário ou senha incorretos." });

    loginAttempts.delete(req.ip || req.socket.remoteAddress || "unknown");
    await pool.execute("DELETE FROM sessions WHERE token_hash = ?", [req.musicSession.token_hash]);
    const freshSession = await createSession(account.username);
    req.musicSession = freshSession;
    setSessionCookie(req, res, freshSession.token);
    res.json({ username: account.username, csrfToken: freshSession.csrfToken });
  }));

  app.post("/api/logout", requireAdmin, requireCsrf, asyncHandler(async (req, res) => {
    await pool.execute("DELETE FROM sessions WHERE token_hash = ?", [req.musicSession.token_hash]);
    setSessionCookie(req, res, "", true);
    res.json({ ok: true });
  }));

  app.get("/api/tracks", requireAdmin, asyncHandler(async (_req, res) => {
    const [tracks] = await pool.execute(`SELECT id, title, artist, mime_type AS mimeType,
      original_name AS originalName,
      DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt
      FROM tracks ORDER BY created_at DESC`);
    res.json({ tracks });
  }));

  app.post("/api/tracks", requireAdmin, requireCsrf, upload.single("audio"), asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Escolha um arquivo de áudio." });
    const title = cleanText(req.body?.title, 80) || path.basename(req.file.originalname, path.extname(req.file.originalname));
    const artist = cleanText(req.body?.artist, 80) || "Artista desconhecido";
    if (!title) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ error: "Informe o nome da música." });
    }
    const track = {
      id: crypto.randomUUID(),
      title,
      artist,
      storageName: req.file.filename,
      mimeType: req.file.mimetype,
      originalName: path.basename(req.file.originalname).slice(0, 180),
      createdAt: new Date().toISOString()
    };
    try {
      await pool.execute(`INSERT INTO tracks
        (id, title, artist, storage_name, mime_type, original_name, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [
        track.id,
        track.title,
        track.artist,
        track.storageName,
        track.mimeType,
        track.originalName,
        new Date(track.createdAt)
      ]);
    } catch (error) {
      fs.rmSync(req.file.path, { force: true });
      throw error;
    }
    res.status(201).json({
      track: {
        id: track.id,
        title: track.title,
        artist: track.artist,
        mimeType: track.mimeType,
        originalName: track.originalName,
        createdAt: track.createdAt
      }
    });
  }));

  app.get("/api/tracks/:id/audio", requireAdmin, asyncHandler(async (req, res) => {
    const [rows] = await pool.execute("SELECT storage_name, mime_type FROM tracks WHERE id = ? LIMIT 1", [req.params.id]);
    const track = rows[0];
    if (!track) return res.status(404).json({ error: "Música não encontrada." });
    const filePath = path.join(MUSIC_DIR, track.storage_name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Arquivo de áudio não encontrado." });
    const stat = fs.statSync(filePath);
    const range = req.headers.range;
    res.setHeader("Content-Type", track.mime_type);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", "inline");
    if (!range) {
      res.setHeader("Content-Length", stat.size);
      return fs.createReadStream(filePath).pipe(res);
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      res.setHeader("Content-Range", `bytes */${stat.size}`);
      return res.status(416).end();
    }
    let start = match[1] ? Number.parseInt(match[1], 10) : Math.max(0, stat.size - Number.parseInt(match[2], 10));
    let end = match[1] ? (match[2] ? Number.parseInt(match[2], 10) : stat.size - 1) : stat.size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= stat.size || end < start) {
      res.setHeader("Content-Range", `bytes */${stat.size}`);
      return res.status(416).end();
    }
    end = Math.min(end, stat.size - 1);
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    res.setHeader("Content-Length", end - start + 1);
    fs.createReadStream(filePath, { start, end }).pipe(res);
  }));

  app.delete("/api/tracks/:id", requireAdmin, requireCsrf, asyncHandler(async (req, res) => {
    const [rows] = await pool.execute("SELECT storage_name FROM tracks WHERE id = ? LIMIT 1", [req.params.id]);
    const track = rows[0];
    if (!track) return res.status(404).json({ error: "Música não encontrada." });
    await pool.execute("DELETE FROM tracks WHERE id = ?", [req.params.id]);
    fs.rmSync(path.join(MUSIC_DIR, track.storage_name), { force: true });
    res.json({ ok: true });
  }));

  app.post("/api/password", requireAdmin, requireCsrf, asyncHandler(async (req, res) => {
    const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    const [rows] = await pool.execute("SELECT username, password_hash FROM admins WHERE username = ? LIMIT 1", [req.musicSession.username]);
    const admin = rows[0];
    if (!admin || !(await verifyPassword(currentPassword, admin.password_hash))) {
      return res.status(401).json({ error: "A senha atual está incorreta." });
    }
    if (newPassword.length < 12 || newPassword.length > 256) {
      return res.status(400).json({ error: "A nova senha precisa ter entre 12 e 256 caracteres." });
    }
    const passwordHash = await makePasswordHash(newPassword);
    await pool.execute("UPDATE admins SET password_hash = ? WHERE username = ?", [passwordHash, admin.username]);
    await pool.execute("DELETE FROM sessions WHERE username = ?", [admin.username]);
    const freshSession = await createSession(admin.username);
    req.musicSession = freshSession;
    setSessionCookie(req, res, freshSession.token);
    res.json({ ok: true, csrfToken: freshSession.csrfToken });
  }));

  app.use("/api", (_req, res) => res.status(404).json({ error: "Rota não encontrada." }));
  app.use((error, _req, res, _next) => {
    console.error("Request error:", error.code || error.name || "Error");
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "O arquivo ultrapassa o limite de 30 MB." });
    }
    if (error instanceof multer.MulterError) return res.status(400).json({ error: "Não foi possível processar o envio do arquivo." });
    if (error.message?.startsWith("Formato não aceito.")) return res.status(400).json({ error: error.message });
    res.status(500).json({ error: "O servidor encontrou um erro. Tente novamente." });
  });

  const server = app.listen(port, host);
  server.once("listening", () => {
    const address = server.address();
    const urlHost = address.family === "IPv6" ? `[${address.address}]` : address.address;
    console.log(`MusicBox escutando em http://${urlHost}:${address.port}`);
  });
  server.on("error", async (error) => {
    console.error(`Não foi possível abrir o servidor HTTP em ${host}:${port} (${error.code || error.name}).`);
    await pool.end().catch(() => {});
    process.exitCode = 1;
  });
  const shutdown = () => server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
