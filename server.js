const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9.\-\_]/g, '_'))
});

const upload = multer({ storage });
const app = express();

app.use(express.static(__dirname)); // serve index.html and assets
app.use('/uploads', express.static(UPLOAD_DIR));

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const info = {
    originalname: req.file.originalname,
    filename: req.file.filename,
    mimetype: req.file.mimetype,
    size: req.file.size,
    time: Date.now(),
    url: '/uploads/' + req.file.filename
  };
  res.json(info);
});

app.get('/files', (req, res) => {
  fs.readdir(UPLOAD_DIR, (err, files) => {
    if (err) return res.status(500).json([]);
    const out = files.map(f => {
      const stat = fs.statSync(path.join(UPLOAD_DIR, f));
      // try to guess mimetype from extension
      const ext = path.extname(f).toLowerCase();
      let mimetype = 'application/octet-stream';
      if (ext.match(/\.(png|jpg|jpeg|gif|webp)$/)) mimetype = 'image/' + ext.replace('.', '');
      if (ext === '.txt') mimetype = 'text/plain';
      return { filename: f, originalname: f.split('_').slice(1).join('_') || f, mimetype, size: stat.size, time: stat.mtimeMs, url: '/uploads/' + f };
    });
    res.json(out);
  });
});

app.delete('/files/:name', (req, res) => {
  const name = req.params.name;
  const filePath = path.join(UPLOAD_DIR, name);
  fs.unlink(filePath, (err) => {
    if (err) return res.status(500).json({ error: 'Delete failed' });
    res.json({ ok: true });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server listening on', PORT));
