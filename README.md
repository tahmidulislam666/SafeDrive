# SafeDrive

SafeDrive is a lightweight personal file-storage app. Users can register, upload
private files, write quick notes, and optionally publish files for anyone to
browse and download.

## Features

- Separate private storage for every user
- 5 GB storage quota per user
- Public uploads, clearly marked and accessible to everyone
- File upload, download, preview, search, sorting, and deletion
- Quick text notes
- Password hashing and token-based authentication

## Run locally

Prerequisite: Node.js 18 or later.

```bash
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## Storage and privacy

- Storage usage is shown only after signing in and is calculated for the
  signed-in account.
- Private files can only be listed, downloaded, or deleted by their owner.
- A file uploaded with **Make uploaded files public** enabled is visible and
  downloadable by anyone. It still counts against the uploader's quota.

Application data is stored locally in `data/`; uploaded files are stored in
`uploads/`. Both directories are excluded from Git.

## Docker

```bash
docker build -t safedrive .
docker run --rm -p 3000:3000 safedrive
```
