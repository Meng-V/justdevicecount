# Server Deployment Guide

This guide covers deploying JustDeviceCount on a production server using systemd service management.

## Overview

**Server Environment**: Production deployment using systemd service  
**Local Development**: Use PM2 via `start.sh` script  

The server deployment uses systemd to manage the application process, NOT PM2 or dist builds.

---

## Server Information

- **Server Path**: `/opt/justdevicecount`
- **Service User**: `devicecount`
- **Service Name**: `crowd-index`
- **Port**: 3012
- **Process Manager**: systemd (not PM2)

---

## Prerequisites

1. **Server Access**: SSH access to the server
2. **User Account**: Access to the `devicecount` user account
3. **Sudo Access**: Ability to run `sudo service crowd-index restart`

---

## Deployment Workflow

### 1. Update Code from GitHub

Switch to the `devicecount` user and pull the latest code:

```bash
# Switch to devicecount user
sudo su - devicecount

# Navigate to app directory
cd /opt/justdevicecount

# Pull latest changes
git pull
```

### 2. Install Dependencies (if package.json changed)

```bash
npm install --production
```

### 3. Update Database Schema (if schema changed)

```bash
npx prisma generate
npx prisma db push
```

### 4. Restart the Service

Exit the `devicecount` user and restart as yourself or root:

```bash
# Exit devicecount user
exit

# Restart the service
sudo service crowd-index restart
```

### 5. Verify the Service

Check that the service is running:

```bash
sudo service crowd-index status
```

View application logs:

```bash
sudo journalctl -u crowd-index -f
```

---

## Service Management Commands

| Command | Description |
|---------|-------------|
| `sudo service crowd-index start` | Start the service |
| `sudo service crowd-index stop` | Stop the service |
| `sudo service crowd-index restart` | Restart the service |
| `sudo service crowd-index status` | Check service status |
| `sudo journalctl -u crowd-index -f` | View live logs |
| `sudo journalctl -u crowd-index --since "1 hour ago"` | View recent logs |

---

## How It Works

The systemd service runs the application directly via `bin/www`:

1. **Service File**: `/etc/systemd/system/crowd-index.service` (managed by IT)
2. **Startup**: Runs `node bin/www` in the `/opt/justdevicecount` directory
3. **User**: Runs as the `devicecount` user
4. **Auto-restart**: systemd automatically restarts the app if it crashes
5. **Boot**: Configured to start automatically on server boot

---

## Configuration Files

### Required Files on Server

```
/opt/justdevicecount/
├── .env                        # Database connection (DO NOT commit)
├── config/default.json         # CMX API settings (DO NOT commit)
├── security/
│   ├── cert.pem               # SSL certificate
│   └── cert.key               # SSL private key
└── [application code]
```

### Environment Variables (.env)

```bash
DATABASE_URL="postgresql://username:password@localhost:5432/crowd_index"
NODE_ENV=production
```

---

## Troubleshooting

### Service Won't Start

Check the service logs for errors:
```bash
sudo journalctl -u crowd-index -n 50
```

Common issues:
- Missing `.env` file
- Incorrect database credentials
- Missing SSL certificates
- Port 3012 already in use

### Database Connection Errors

Verify database connection:
```bash
# As devicecount user
cd /opt/justdevicecount
npx prisma db pull
```

### Check Application URL

After deployment, verify the app is accessible:
```
https://your-server:3012/crowdindex/
```

### Permission Issues

Ensure files are owned by the `devicecount` user:
```bash
sudo chown -R devicecount:devicecount /opt/justdevicecount
```

---

## Differences from Local Development

| Aspect | Local Development | Server Production |
|--------|------------------|-------------------|
| **Location** | Your local machine | `/opt/justdevicecount` |
| **User** | Your user account | `devicecount` user |
| **Process Manager** | PM2 | systemd service |
| **Start Command** | `./start.sh` | `sudo service crowd-index restart` |
| **Logs** | `pm2 logs` | `sudo journalctl -u crowd-index` |
| **Auto-restart** | PM2 | systemd |
| **Environment** | Development | Production |

---

## Security Notes

1. **Never commit** `.env` or `config/default.json` to Git
2. **SSL Certificates** are required for HTTPS
3. **Database credentials** should be stored securely in `.env`
4. **Service runs as** the `devicecount` user (not root)

---

## Quick Reference Card

```bash
# Deploy workflow (most common)
sudo su - devicecount           # Switch to service user
cd /opt/justdevicecount        # Navigate to app
git pull                       # Update code
exit                          # Exit service user
sudo service crowd-index restart   # Restart app

# Check status
sudo service crowd-index status

# View logs
sudo journalctl -u crowd-index -f
```

---

## Getting Help

- **Service issues**: Contact IT support for systemd service configuration
- **Application issues**: Check GitHub issues or application logs
- **Database issues**: Verify connection in `.env` file

---

**Last Updated**: 2025-10-02  
**Maintained by**: Meng Qu (Web Design Librarian)
