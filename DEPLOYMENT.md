# Karimnagar Frames Deployment Guide

This project is a deployable Node.js app with a built-in frontend, backend API, JSON database, and upload storage.

## Local Run

```bash
npm install
npm start
```

Open:

```text
http://127.0.0.1:8080
```

Test:

```bash
npm test
```

## Important Accounts

Owner and sample customer credentials are intentionally masked in public documentation:

```text
Owner ID: ********
Owner Password: ********
Customer Mobile: ********
Customer Password: ********
```

Change these passwords before taking real orders.

## Free Or Low-Cost Deployment

### Option 1: Render

Best simple option for beginners.

1. Create a GitHub repository and upload this full project folder.
2. Go to Render and create a new Web Service.
3. Connect the GitHub repository.
4. Use these settings:
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment variable: `HOST=0.0.0.0`
   - Environment variable: `DATA_FILE=/var/data/db.json`
   - Environment variable: `UPLOAD_DIR=/var/data/uploads`
5. Add a Render disk:
   - Disk name: `karimnagar-frames-data`
   - Mount path: `/var/data`
   - Size: `1 GB`
6. Deploy.

For demo use, the default JSON database can work. For real orders, persistent storage is required:

```text
DATA_FILE=/var/data/db.json
UPLOAD_DIR=/var/data/uploads
```

Without a Render disk or another persistent database/storage provider, orders and uploaded photos can be lost when the service restarts or redeploys. The included `render.yaml` is already configured for `/var/data`; make sure the disk is created in Render.

## OTP SMS

Customer accounts are created by mobile number, password, and OTP verification.

The app supports Textbelt's free SMS API by default:

```text
SMS_PROVIDER=textbelt
TEXTBELT_KEY=textbelt
```

Textbelt's free key is only suitable for testing because it has a very small free quota. If the free SMS quota is unavailable, the app shows a demo OTP so testing does not get blocked.

For production, replace `TEXTBELT_KEY` with a paid SMS key or connect another SMS provider in `server.js`.

### Option 2: Railway

Good low-cost option for a Node app.

1. Push this project to GitHub.
2. Create a Railway project from the GitHub repo.
3. Railway should detect Node automatically.
4. Set Start Command to `npm start` if needed.
5. Add environment variable `HOST=0.0.0.0`.

Use a persistent volume or external database for real production orders.

### Option 3: Cheap VPS

Best for keeping JSON files and uploads safely on disk.

1. Buy a small VPS.
2. Install Node.js 20 or newer.
3. Upload the project folder.
4. Run:

```bash
npm install
npm start
```

5. Use a process manager such as PM2 and connect a domain with Nginx.

## Production Notes

- The current payment flow saves the customer-selected payment method and lets the owner mark payment as paid from the dashboard.
- Ordering and cart APIs require login. Guest checkout is blocked.
- Product photo uploads are stored under `UPLOAD_DIR`, and order records save the uploaded image URLs.
- Product catalog and multi-photo rules are configured in `data/catalog.json`. Private users, sessions, carts, orders, and contacts stay in the runtime database file.
- The included generated SVG product images are placeholders for products where original product photos were missing. Replace files in `public/assets/products/placeholders/` with real product photos whenever available.
- A real card/UPI gateway such as Razorpay requires merchant credentials and should be added only after you create that account.
- Keep `data/db.json` private because it contains users, sessions, orders, and password hashes.
- Back up `data/db.json` and the `uploads` folder regularly.
