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

Owner dashboard:

```text
ID: karimnagarframes
Password: karimnagar@123
```

Sample customer:

```text
Mobile: 9876543210
Password: Customer@12345
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
5. Deploy.

For demo use, the default JSON database can work. For real orders, add persistent storage and set:

```text
DB_FILE=/var/data/db.json
UPLOAD_DIR=/var/data/uploads
```

Without persistent storage, orders/uploads can be lost when the service restarts or redeploys.

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
- A real card/UPI gateway such as Razorpay requires merchant credentials and should be added only after you create that account.
- Keep `data/db.json` private because it contains users, sessions, orders, and password hashes.
- Back up `data/db.json` and the `uploads` folder regularly.
