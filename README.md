# Karimnagar Frames

A complete custom gifts storefront for frames, printed cups, pillows, and gift combos.

## Features

- Responsive premium homepage
- Product catalog with search and filters
- Product detail pages with customization options
- Login-protected server-side cart and checkout
- Product-wise photo upload requirements with multiple labeled image slots
- Payment method selection
- Mobile number + password login
- OTP account creation with free Textbelt SMS support and demo fallback
- WhatsApp order redirect to the configured owner number
- Owner dashboard for all orders, messages, statuses, and payment updates
- Customer dashboard for personal order tracking
- JSON database and upload storage, with Render persistent disk configuration for production
- Local generated product artwork for products missing original photos
- Safe catalog file in `data/catalog.json` so product settings can deploy without exposing private order data

## Run

```bash
npm install
npm start
```

Open `http://127.0.0.1:8080`.

## Test

```bash
npm test
```

## Login

Owner and sample customer credentials are intentionally not shown in this public file. Use the private credentials shared by the owner.

Deployment details are in `DEPLOYMENT.md`.
