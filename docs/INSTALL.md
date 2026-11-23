# Installing EPC Contracts & Billing

The system has two parts:

| Part | Where it runs | What it holds |
|---|---|---|
| **Server** | One VPS (Ubuntu 22.04 or 24.04) | The database, uploaded documents, the application and the web interface |
| **Desktop app** (`EPC-Contracts-Setup-0.1.0.exe`) | Each Windows PC at HQ and site offices | Nothing but the server address and the user's sign-in |

Every user, at HQ or on site, works on the same live data on the server. The desktop app is a dedicated window onto that server: it opens straight into the system, has its own Start-menu and desktop icon, and does not need a browser. People who prefer a browser, or are on a phone or Mac, can open the server's address directly; it is the same system.

A single shared server (rather than a database on each PC) is deliberate: measurements, approvals and material stock must be one record across sites, and approval limits and the audit trail only mean something if nobody can edit a local copy.

---

## 1. Server (VPS)

### What you need

- A VPS with Ubuntu 22.04 or 24.04, at least **2 vCPU, 4 GB RAM, 40 GB disk** (more disk if you will upload many drawings and bills). Any provider works (e.g. a Mumbai or Hyderabad region for lower latency in India).
- Root (sudo) access over SSH.
- Recommended: a domain or sub-domain such as `erp.yourcompany.in`, with a DNS **A record** pointing to the VPS's IP. This gives you HTTPS. Without a domain the system works over plain HTTP on the IP address, which is acceptable only for a trial.

### Install

Copy the release file to the server and run the installer:

```bash
scp epc-erp-0.1.0-<rev>.tar.gz root@YOUR_VPS_IP:/root/
ssh root@YOUR_VPS_IP

tar xzf epc-erp-0.1.0-*.tar.gz
cd epc-erp-0.1.0-*
sudo ./deploy/vps/install.sh \
  --domain erp.yourcompany.in \
  --email it@yourcompany.in \
  --admin-email you@yourcompany.in \
  --company "Your Company Pvt Ltd"
```

All options are optional; anything left out is asked for or given a safe default:

| Option | Meaning |
|---|---|
| `--domain` | Your domain. Sets up nginx for it and requests a free Let's Encrypt HTTPS certificate. Leave out to use the IP over HTTP. |
| `--email` | Email for certificate expiry notices. |
| `--admin-email` | Sign-in email of the first super administrator. |
| `--admin-password` | Leave out and a strong password is generated and shown once at the end. |
| `--company`, `--company-code` | Name and short code of your company (code defaults to `HQ`). |

It takes about 5 to 10 minutes and does the following:

1. Installs PostgreSQL (version 14 on Ubuntu 22.04, 16 on 24.04), Node.js 22, nginx, the firewall and cron.
2. Creates a `epc` system user and the database with a random password.
3. Writes the configuration with generated secrets to `/etc/epc-erp/env` (readable only by root and the service).
4. Copies the application to `/opt/epc-erp`, installs dependencies, builds the web interface and applies database migrations.
5. Creates your company and the first super administrator.
6. Registers the `epc-erp` service (starts on boot, restarts if it stops), behind nginx.
7. Requests the HTTPS certificate (if `--domain` was given) and redirects HTTP to HTTPS.
8. Opens only SSH, HTTP and HTTPS in the firewall.
9. Schedules a daily backup at 02:30 (server time) of the database and uploaded files, keeping 14 days.

At the end it prints the address to open and the administrator's sign-in. Sign in, change the password, then create users and roles under **Users & roles**.

Running the installer again is safe: it keeps the existing database, secrets, files and users.

### Day-to-day

| Task | Command |
|---|---|
| Service status | `systemctl status epc-erp` |
| Live logs | `journalctl -u epc-erp -f` |
| Restart | `systemctl restart epc-erp` |
| Back up now | `epc-erp-backup` (files go to `/var/lib/epc-erp/backups`) |
| Update to a new release | extract the new release, then `sudo epc-erp-update /root/epc-erp-<new-version>` (takes a backup first, then migrates and restarts) |

**Copy backups off the server.** The daily backup protects against mistakes, not against losing the VPS. Use your provider's snapshot feature as well, or copy `/var/lib/epc-erp/backups` elsewhere regularly (for example with `rsync` or `rclone` to cloud storage).

Restore from a backup:

```bash
source /etc/epc-erp/env
systemctl stop epc-erp
pg_restore --clean --if-exists -d "$DATABASE_URL" /var/lib/epc-erp/backups/db-YYYYMMDD-HHMMSS.dump
tar -C /var/lib/epc-erp/storage -xzf /var/lib/epc-erp/backups/files-YYYYMMDD-HHMMSS.tar.gz
systemctl start epc-erp
```

### Where things are

| Path | Contents |
|---|---|
| `/opt/epc-erp` | Application code |
| `/etc/epc-erp/env` | Configuration and secrets (database password, sign-in signing key) |
| `/var/lib/epc-erp/storage` | Uploaded documents (BOQs, bills, drawings) |
| `/var/lib/epc-erp/backups` | Daily backups |
| `/etc/nginx/sites-available/epc-erp` | Web server configuration |

---

## 2. Desktop app (Windows)

1. Copy `EPC-Contracts-Setup-0.1.0.exe` to the PC (shared drive, email or USB) and double-click it.
2. **Windows SmartScreen will warn** "Windows protected your PC" because the installer is not yet code-signed. Click **More info**, then **Run anyway**. (See "Code signing" below to remove this.)
3. Follow the installer. It installs for the current user only, so no administrator rights are needed, and adds desktop and Start-menu shortcuts.
4. On first launch, enter the server address (e.g. `erp.yourcompany.in`; for a server without HTTPS type `http://` followed by the IP). The app checks that the address is really your server before saving it.
5. Sign in with the account your administrator created.

The app remembers the server, the sign-in and the window size. **File → Change server…** changes the address. If the server cannot be reached, the app shows a clear message with **Try again**.

Requirements: Windows 10 or 11, 64-bit. Uninstall from **Settings → Apps** like any program.

### Pre-setting your server address (optional)

So that staff never see the setup screen, build the installer with your address baked in (on any Linux machine or WSL with Node.js 22):

```bash
cd desktop
npm ci
SERVER_URL=https://erp.yourcompany.in ./build-win.sh
# → desktop/dist/EPC-Contracts-Setup-0.1.0.exe
```

### Code signing (recommended before rolling out widely)

Unsigned installers trigger SmartScreen and some antivirus products. To sign, buy a code-signing certificate (an OV or EV certificate from a CA such as Sectigo, DigiCert or an Indian reseller; EV removes the SmartScreen warning immediately), then sign the built file on Windows:

```powershell
signtool sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 /a "EPC-Contracts-Setup-0.1.0.exe"
```

### Other computers

Mac, Linux, tablets and phones: open the server address in a browser. A Linux desktop build is available with `npm run dist:linux` in `desktop/`.

---

## 3. What was and was not verified

Verified in the build environment (Ubuntu 24.04 container):

- The VPS installer, run end to end against a fresh database: dependencies, build, migrations, first administrator, and the configuration file. Run a second and third time to confirm it keeps the data and does not reset the administrator's password.
- The application started the way the service starts it (as the `epc` user, with `/etc/epc-erp/env`), served the web interface, and a full sign-in worked in a browser.
- The backup script produced a database dump and a files archive.
- The desktop app on Linux under a virtual display: first-run setup, rejection of a wrong or unreachable address, sign-in, relaunch straight into the system, the server-down screen, and that server pages cannot reach the desktop bridge.
- The Windows installer was built and its contents, icon and version details checked.

Not verified here (no systemd, public IP or Windows in the build environment):

- The systemd service, nginx, Let's Encrypt, the firewall and cron steps on a real VPS. They use standard Ubuntu commands, but do a trial install on a fresh VPS before going live.
- Running the `.exe` on Windows itself.
- `update.sh` (it repeats the tested install steps plus stop/start of the service).
- The Docker files in the repository (an alternative route; untested).
