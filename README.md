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

Docker is the recommended way to run SafeDrive on Windows when Node.js and npm
are not installed on the host computer.

### Prerequisites

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. Start Docker Desktop and wait for its engine to show as running.
3. Open PowerShell in the project directory:

```powershell
cd D:\SafeDrive
```

Verify that Docker is ready before continuing:

```powershell
docker version
```

### Build the image

Run this after downloading the project and again whenever application source
files change:

```powershell
docker build -t safedrive .
```

### Run with persistent storage

Use the following command for normal use. The two volume mounts preserve user
accounts and uploaded files in the project's `data` and `uploads` folders,
even after the container stops or is replaced.

```powershell
docker run --rm -p 3000:3000 -v "${PWD}\data:/app/data" -v "${PWD}\uploads:/app/uploads" safedrive
```

Open [http://localhost:3000](http://localhost:3000) while the command is
running. Press `Ctrl+C` in the same PowerShell window to stop the app.

`--rm` removes only the stopped container. Your data remains safe because it
is stored in the mounted host folders.

### Run in the background

To run SafeDrive without keeping PowerShell open, give the container a name:

```powershell
docker run -d --name safedrive -p 3000:3000 -v "${PWD}\data:/app/data" -v "${PWD}\uploads:/app/uploads" safedrive
```

Useful commands:

```powershell
docker logs safedrive       # View application logs
docker stop safedrive       # Stop the app
docker start safedrive      # Start it again
docker rm safedrive         # Remove the stopped container
```

### Update the application

After changing SafeDrive source files, replace the running container with a
new image. The volume mounts keep your accounts and uploads intact.

```powershell
docker stop safedrive
docker rm safedrive
docker build -t safedrive .
docker run -d --name safedrive -p 3000:3000 -v "${PWD}\data:/app/data" -v "${PWD}\uploads:/app/uploads" safedrive
```

### Access from another device on the same Wi-Fi

Find the computer's local IPv4 address:

```powershell
ipconfig
```

Then open `http://YOUR-PC-IP:3000` on the other device, for example
`http://192.168.1.25:3000`. Allow Docker Desktop through Windows Firewall if
Windows prompts you. Do not expose port 3000 directly to the public internet:
this app uses HTTP and public uploads are intentionally downloadable by anyone
who can reach the app.

### Troubleshooting

- **Cannot connect to `dockerDesktopLinuxEngine`:** start Docker Desktop and
  wait for the engine to be running. If it will not start, update WSL with
  `wsl --update`, restart Windows, then start Docker Desktop again.
- **Port 3000 is already in use:** stop the process/container using that port,
  or use another host port such as `-p 8080:3000` and open
  `http://localhost:8080`.
- **Changes are not visible:** rebuild the image and recreate the container
  using the update commands above.

### Temporary, non-persistent run

For a short test only, the app can run without volume mounts:

```bash
docker run --rm -p 3000:3000 safedrive
```

Files and accounts created in this mode are removed when the container stops.
docker build -t safedrive .
docker run --rm -p 3000:3000 safedrive
```
