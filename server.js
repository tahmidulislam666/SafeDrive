const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PUBLIC_UPLOAD_DIR = path.join(UPLOAD_DIR, 'public');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TOKEN_SECRET_FILE = path.join(DATA_DIR, 'token-secret');
const PUBLIC_FILES_FILE = path.join(DATA_DIR, 'public-files.json');
const MAX_FILES_PER_UPLOAD = 10;
const STORAGE_QUOTA = 5 * 1024 * 1024 * 1024;
const TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]', { mode: 0o600 });
if (!fs.existsSync(TOKEN_SECRET_FILE)) fs.writeFileSync(TOKEN_SECRET_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
if (!fs.existsSync(PUBLIC_FILES_FILE)) fs.writeFileSync(PUBLIC_FILES_FILE, '[]', { mode: 0o600 });
const TOKEN_SECRET = fs.readFileSync(TOKEN_SECRET_FILE, 'utf8').trim();
const loginAttempts = new Map();

function readUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), { mode: 0o600 });
}

function readPublicFiles() {
  return JSON.parse(fs.readFileSync(PUBLIC_FILES_FILE, 'utf8'));
}

function writePublicFiles(files) {
  fs.writeFileSync(PUBLIC_FILES_FILE, JSON.stringify(files, null, 2), { mode: 0o600 });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, user) {
  const candidate = Buffer.from(hashPassword(password, user.salt).hash, 'hex');
  const stored = Buffer.from(user.passwordHash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function signToken(user) {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({ sub: user.id, username: user.username, exp: Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS }));
  const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function verifyToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(`${parts[0]}.${parts[1]}`).digest();
  const received = Buffer.from(parts[2], 'base64url');
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Authentication required' });
  const user = readUsers().find(item => item.id === payload.sub && item.username === payload.username);
  if (!user) return res.status(401).json({ error: 'Account no longer exists' });
  req.user = user;
  next();
}

function optionalAuth(req, res, next) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  const payload = token && verifyToken(token);
  if (payload) req.user = readUsers().find(item => item.id === payload.sub && item.username === payload.username);
  next();
}

function getUserUploadDir(userId) {
  const dir = path.join(UPLOAD_DIR, userId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getStorageUsage(userId) {
  const dir = getUserUploadDir(userId);
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
    if (!entry.isFile()) return total;
    try {
      return total + fs.statSync(path.join(dir, entry.name)).size;
    } catch {
      return total;
    }
  }, 0) + readPublicFiles().filter(file => file.ownerId === userId).reduce((total, file) => total + file.size, 0);
}

function isSafeFileName(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9._-]+$/.test(name);
}

function getLoginKey(req, username) {
  return `${req.ip}:${username.toLowerCase()}`;
}

function checkLoginAttempts(req, username) {
  const key = getLoginKey(req, username);
  const attempt = loginAttempts.get(key);
  if (!attempt || Date.now() - attempt.firstAttempt > LOGIN_WINDOW_MS) return null;
  if (attempt.count >= LOGIN_MAX_ATTEMPTS) return Math.ceil((LOGIN_WINDOW_MS - (Date.now() - attempt.firstAttempt)) / 1000);
  return null;
}

function recordFailedLogin(req, username) {
  const key = getLoginKey(req, username);
  const attempt = loginAttempts.get(key);
  if (!attempt || Date.now() - attempt.firstAttempt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAttempt: Date.now() });
  } else {
    attempt.count += 1;
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, getUserUploadDir(req.user.id)),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${crypto.randomUUID()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
});
const upload = multer({ storage, limits: { files: MAX_FILES_PER_UPLOAD } });
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.post('/auth/register', (req, res) => {
  const username = typeof req.body.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–32 letters, numbers, dots, dashes, or underscores' });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Password must be 8–128 characters' });
  const users = readUsers();
  if (users.some(user => user.username === username)) return res.status(409).json({ error: 'Username is already taken' });
  const passwordData = hashPassword(password);
  const user = { id: crypto.randomUUID(), username, passwordHash: passwordData.hash, salt: passwordData.salt, createdAt: Date.now() };
  users.push(user);
  writeUsers(users);
  res.status(201).json({ token: signToken(user), user: { username: user.username } });
});

app.post('/auth/login', (req, res) => {
  const username = typeof req.body.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const retryAfter = checkLoginAttempts(req, username);
  if (retryAfter) return res.status(429).json({ error: `Too many attempts. Try again in ${retryAfter} seconds.` });
  const user = readUsers().find(item => item.username === username);
  if (!user || !verifyPassword(password, user)) {
    recordFailedLogin(req, username);
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  loginAttempts.delete(getLoginKey(req, username));
  res.json({ token: signToken(user), user: { username: user.username } });
});

app.post('/upload', requireAuth, upload.array('files', MAX_FILES_PER_UPLOAD), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files' });
  const isPublic = req.body.isPublic === 'true';
  if (getStorageUsage(req.user.id) > STORAGE_QUOTA) {
    await Promise.all(req.files.map(file => fs.promises.unlink(file.path).catch(() => {})));
    return res.status(413).json({ error: 'Storage quota exceeded' });
  }
  const time = Date.now();
  if (isPublic) {
    const publicFiles = readPublicFiles();
    req.files.forEach(file => {
      fs.renameSync(file.path, path.join(PUBLIC_UPLOAD_DIR, file.filename));
      publicFiles.push({ filename: file.filename, originalname: file.originalname, mimetype: file.mimetype, size: file.size, time, ownerId: req.user.id });
    });
    writePublicFiles(publicFiles);
  }
  const files = req.files.map(file => ({ originalname: file.originalname, filename: file.filename, mimetype: file.mimetype, size: file.size, time, isPublic, canDelete: true, url: `${isPublic ? '/public-files' : '/files'}/${encodeURIComponent(file.filename)}/download`, deleteUrl: `${isPublic ? '/public-files' : '/files'}/${encodeURIComponent(file.filename)}` }));
  res.json({ files, storage: { usedBytes: getStorageUsage(req.user.id), quotaBytes: STORAGE_QUOTA } });
});

app.get('/storage', requireAuth, (req, res) => {
  res.json({ usedBytes: getStorageUsage(req.user.id), quotaBytes: STORAGE_QUOTA, maxFilesPerUpload: MAX_FILES_PER_UPLOAD });
});

app.get('/files', requireAuth, (req, res) => {
  const dir = getUserUploadDir(req.user.id);
  const files = fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isFile()).flatMap(entry => {
    try {
      const stat = fs.statSync(path.join(dir, entry.name));
      const ext = path.extname(entry.name).toLowerCase();
      let mimetype = 'application/octet-stream';
      if (/\.(png|jpg|jpeg|gif|webp)$/.test(ext)) mimetype = `image/${ext.slice(1)}`;
      if (ext === '.txt') mimetype = 'text/plain';
      const originalname = entry.name.split('_').slice(2).join('_') || entry.name;
      return [{ filename: entry.name, originalname, mimetype, size: stat.size, time: stat.mtimeMs, isPublic: false, canDelete: true, url: `/files/${encodeURIComponent(entry.name)}/download`, deleteUrl: `/files/${encodeURIComponent(entry.name)}` }];
    } catch {
      return [];
    }
  });
  res.json(files);
});

app.get('/public-files', optionalAuth, (req, res) => {
  const files = readPublicFiles().flatMap(file => {
    try {
      const stat = fs.statSync(path.join(PUBLIC_UPLOAD_DIR, file.filename));
      const { ownerId, ...publicFile } = file;
      return [{ ...publicFile, size: stat.size, isPublic: true, canDelete: req.user?.id === ownerId, url: `/public-files/${encodeURIComponent(file.filename)}/download`, deleteUrl: `/public-files/${encodeURIComponent(file.filename)}` }];
    } catch {
      return [];
    }
  });
  res.json(files);
});

app.get('/public-files/:name/download', (req, res) => {
  if (!isSafeFileName(req.params.name) || !readPublicFiles().some(file => file.filename === req.params.name)) return res.status(404).json({ error: 'File not found' });
  res.download(path.join(PUBLIC_UPLOAD_DIR, req.params.name), req.params.name, err => {
    if (err && !res.headersSent) res.status(err.code === 'ENOENT' ? 404 : 500).json({ error: 'Download failed' });
  });
});

app.get('/files/:name/download', requireAuth, (req, res) => {
  if (!isSafeFileName(req.params.name)) return res.status(400).json({ error: 'Invalid file name' });
  const filePath = path.join(getUserUploadDir(req.user.id), req.params.name);
  res.download(filePath, req.params.name, err => {
    if (err && !res.headersSent) res.status(err.code === 'ENOENT' ? 404 : 500).json({ error: 'Download failed' });
  });
});

app.delete('/files/:name', requireAuth, (req, res) => {
  if (!isSafeFileName(req.params.name)) return res.status(400).json({ error: 'Invalid file name' });
  fs.unlink(path.join(getUserUploadDir(req.user.id), req.params.name), err => {
    if (err) return res.status(err.code === 'ENOENT' ? 404 : 500).json({ error: 'Delete failed' });
    res.json({ ok: true });
  });
});

app.delete('/public-files/:name', requireAuth, (req, res) => {
  if (!isSafeFileName(req.params.name)) return res.status(400).json({ error: 'Invalid file name' });
  const files = readPublicFiles();
  const file = files.find(item => item.filename === req.params.name);
  if (!file) return res.status(404).json({ error: 'File not found' });
  if (file.ownerId !== req.user.id) return res.status(403).json({ error: 'You can only delete your own public files' });
  fs.unlink(path.join(PUBLIC_UPLOAD_DIR, file.filename), err => {
    if (err && err.code !== 'ENOENT') return res.status(500).json({ error: 'Delete failed' });
    writePublicFiles(files.filter(item => item.filename !== file.filename));
    res.json({ ok: true });
  });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_COUNT') return res.status(413).json({ error: `Upload up to ${MAX_FILES_PER_UPLOAD} files at a time` });
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SafeDrive listening on ${PORT}`));
