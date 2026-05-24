"use strict";

const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DEFAULT_DATA_FILE = path.join(ROOT, "data", "db.json");
const DATA_FILE = process.env.DB_FILE || path.join(ROOT, "data", "db.json");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, "uploads");
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const PAYMENT_METHODS = ["Pay on Delivery", "UPI after Preview", "Pay at Store"];
const PAYMENT_STATUSES = ["Pending", "Awaiting Confirmation", "Paid", "Failed", "Refunded", "Cancelled"];
const OTP_TTL_MS = 1000 * 60 * 10;
const OTP_MAX_ATTEMPTS = 5;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return prefix + "_" + crypto.randomBytes(9).toString("hex");
}

function orderId(db) {
  const next = 1001 + (db.orders || []).length;
  return (db.settings.orderPrefix || "KF") + "-" + next;
}

function securityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join("; "),
    ...extra
  };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, securityHeaders(headers));
  res.end(body);
}

function json(res, status, payload) {
  send(res, status, JSON.stringify(payload), {
    "Content-Type": "application/json; charset=utf-8"
  });
}

function error(res, status, message, details) {
  json(res, status, {
    ok: false,
    error: {
      message,
      details: details || null
    }
  });
}

async function ensureDataFile() {
  try {
    await fsp.access(DATA_FILE);
  } catch (error) {
    await fsp.mkdir(path.dirname(DATA_FILE), { recursive: true });
    const seed = await fsp.readFile(DEFAULT_DATA_FILE, "utf8");
    await fsp.writeFile(DATA_FILE, seed);
  }
}

async function readDb() {
  await ensureDataFile();
  const text = await fsp.readFile(DATA_FILE, "utf8");
  return JSON.parse(text);
}

async function writeDb(db) {
  db.meta = db.meta || {};
  db.meta.updatedAt = now();
  const tmp = DATA_FILE + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(db, null, 2));
  await fsp.rename(tmp, DATA_FILE);
}

function publicUser(user) {
  if (!user) {
    return null;
  }
  const { passwordHash, ...safe } = user;
  return safe;
}

function createSession(db, user) {
  const token = crypto.randomBytes(32).toString("hex");
  db.sessions = db.sessions || [];
  db.sessions.push({
    token,
    userId: user.id,
    createdAt: now(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
  });
  return token;
}

function parseCookies(header) {
  const cookies = {};
  if (!header) {
    return cookies;
  }
  header.split(";").forEach((part) => {
    const index = part.indexOf("=");
    if (index === -1) {
      return;
    }
    const key = part.slice(0, index).trim();
    const value = decodeURIComponent(part.slice(index + 1).trim());
    cookies[key] = value;
  });
  return cookies;
}

function setSessionCookie(res, token) {
  const cookie = [
    "kf_session=" + encodeURIComponent(token),
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=" + Math.floor(SESSION_TTL_MS / 1000)
  ].join("; ");
  res.setHeader("Set-Cookie", cookie);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "kf_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return salt + ":" + hash;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) {
    return false;
  }
  const test = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256");
  const known = Buffer.from(hash, "hex");
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

function cleanSessions(db) {
  const time = Date.now();
  db.sessions = (db.sessions || []).filter((session) => new Date(session.expiresAt).getTime() > time);
  db.otpChallenges = (db.otpChallenges || []).filter((challenge) => new Date(challenge.expiresAt).getTime() > time);
}

function currentUser(req, db) {
  cleanSessions(db);
  const token = parseCookies(req.headers.cookie).kf_session;
  if (!token) {
    return null;
  }
  const session = (db.sessions || []).find((item) => item.token === token);
  if (!session) {
    return null;
  }
  return db.users.find((user) => user.id === session.userId) || null;
}

function requireUser(req, res, db) {
  const user = currentUser(req, db);
  if (!user) {
    error(res, 401, "Please log in to continue.");
    return null;
  }
  return user;
}

function requireAdmin(req, res, db) {
  const user = requireUser(req, res, db);
  if (!user) {
    return null;
  }
  if (user.role !== "admin") {
    error(res, 403, "Admin access is required.");
    return null;
  }
  return user;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (bodyError) {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => !String(body[field] || "").trim());
  if (missing.length) {
    return "Missing required fields: " + missing.join(", ");
  }
  return null;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validPhone(phone) {
  return /^[0-9+\s-]{8,15}$/.test(String(phone || ""));
}

function phoneKey(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return digits.slice(1);
  }
  return digits;
}

function smsPhone(phone) {
  const raw = String(phone || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) {
    return "+" + digits;
  }
  if (digits.length === 10) {
    return "+91" + digits;
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    return "+" + digits;
  }
  return "+" + digits;
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

async function sendOtpSms(phone, otp) {
  const provider = String(process.env.SMS_PROVIDER || "textbelt").toLowerCase();
  const message = "Your Karimnagar Frames OTP is " + otp + ". It expires in 10 minutes.";
  if (provider === "demo") {
    return { sent: false, provider: "demo", reason: "Demo OTP mode" };
  }
  if (provider === "textbelt") {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch("https://textbelt.com/text", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          phone: smsPhone(phone),
          message,
          key: process.env.TEXTBELT_KEY || "textbelt"
        }),
        signal: controller.signal
      });
      const result = await response.json().catch(() => ({}));
      return {
        sent: Boolean(result.success),
        provider: "textbelt",
        reason: result.error || result.quotaRemaining === 0 ? "Free SMS quota may be finished." : ""
      };
    } catch (smsError) {
      return { sent: false, provider: "textbelt", reason: "SMS service unavailable." };
    } finally {
      clearTimeout(timeout);
    }
  }
  return { sent: false, provider, reason: "Unknown SMS provider." };
}

function productPrice(product, selectedOptions = {}) {
  let total = Number(product.basePrice) || 0;
  (product.options || []).forEach((group) => {
    const selected = selectedOptions[group.name];
    const choice = (group.choices || []).find((item) => item.label === selected);
    if (choice) {
      total += Number(choice.price) || 0;
    }
  });
  return total;
}

function paymentFromInput(input, total) {
  const payment = input && typeof input === "object" ? input : {};
  const method = PAYMENT_METHODS.includes(payment.method) ? payment.method : PAYMENT_METHODS[0];
  const status = method === "Pay on Delivery" ? "Pending" : "Awaiting Confirmation";
  return {
    method,
    status,
    reference: String(payment.reference || "").trim().slice(0, 120),
    amount: total,
    updatedAt: now()
  };
}

function paymentForOrder(order) {
  const payment = order.payment && typeof order.payment === "object" ? order.payment : {};
  const method = PAYMENT_METHODS.includes(payment.method) ? payment.method : PAYMENT_METHODS[0];
  const status = PAYMENT_STATUSES.includes(payment.status) ? payment.status : (method === "Pay on Delivery" ? "Pending" : "Awaiting Confirmation");
  return {
    method,
    status,
    reference: String(payment.reference || "").trim().slice(0, 120),
    amount: Number(payment.amount) || Number(order.total) || 0,
    updatedAt: payment.updatedAt || order.updatedAt || order.createdAt || now()
  };
}

async function saveUpload(upload) {
  if (!upload || !upload.dataUrl) {
    return null;
  }
  const match = String(upload.dataUrl).match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
  if (!match) {
    throw new Error("Only PNG, JPG, JPEG, and WEBP image uploads are allowed.");
  }
  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) {
    throw new Error("Upload image must be smaller than 4 MB.");
  }
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  const filename = "order-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex") + "." + ext;
  await fsp.writeFile(path.join(UPLOAD_DIR, filename), bytes);
  return {
    filename,
    originalName: String(upload.name || filename).slice(0, 120),
    url: "/uploads/" + filename,
    size: bytes.length,
    type: "image/" + ext
  };
}

function buildWhatsAppText(order, settings) {
  const lines = [];
  lines.push("Karimnagar Frames order " + order.id);
  lines.push("");
  lines.push("Customer: " + order.customer.name);
  lines.push("Phone: " + order.customer.phone);
  if (order.customer.email) {
    lines.push("Email: " + order.customer.email);
  }
  lines.push("");
  order.items.forEach((item) => {
    lines.push("- " + item.name + " x " + item.quantity + " = Rs. " + item.unitPrice * item.quantity);
  });
  lines.push("");
  lines.push("Total: Rs. " + order.total);
  const payment = paymentForOrder(order);
  lines.push("Payment: " + payment.method + " (" + payment.status + ")");
  if (payment.reference) {
    lines.push("Payment ref: " + payment.reference);
  }
  if (order.notes) {
    lines.push("Notes: " + order.notes);
  }
  if (order.upload && order.upload.url) {
    const baseUrl = String(settings.publicUrl || "").replace(/\/$/, "");
    lines.push("Customer photo: " + (baseUrl ? baseUrl + order.upload.url : order.upload.url));
  }
  lines.push("");
  lines.push("Please confirm preview and delivery details.");
  const phone = String(settings.whatsappPhone || settings.primaryPhone || "").replace(/[^\d]/g, "");
  return "https://wa.me/" + phone + "?text=" + encodeURIComponent(lines.join("\n"));
}

function whatsAppCustomerPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) {
    return "91" + digits;
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return "91" + digits.slice(1);
  }
  return digits;
}

function orderPhotoUrl(order, settings) {
  if (!order.upload || !order.upload.url) {
    return "";
  }
  const baseUrl = String(settings.publicUrl || "").replace(/\/$/, "");
  return baseUrl ? baseUrl + order.upload.url : order.upload.url;
}

function buildCustomerWhatsAppText(order, settings) {
  const lines = [];
  const payment = paymentForOrder(order);
  lines.push("Hello " + order.customer.name + ", Karimnagar Frames here.");
  lines.push("Order: " + order.id);
  lines.push("Status: " + order.status);
  lines.push("Payment: " + payment.method + " (" + payment.status + ")");
  lines.push("Total: Rs. " + order.total);
  lines.push("");
  lines.push("Items:");
  order.items.forEach((item) => {
    lines.push("- " + item.name + " x " + item.quantity);
  });
  const photoUrl = orderPhotoUrl(order, settings);
  if (photoUrl) {
    lines.push("");
    lines.push("Uploaded photo: " + photoUrl);
  }
  lines.push("");
  lines.push("Please reply here for preview, payment, or delivery updates.");
  return "https://wa.me/" + whatsAppCustomerPhone(order.customer.phone) + "?text=" + encodeURIComponent(lines.join("\n"));
}

function orderForResponse(order, settings) {
  return {
    ...order,
    payment: paymentForOrder(order),
    whatsappUrl: buildWhatsAppText(order, settings),
    customerWhatsappUrl: buildCustomerWhatsAppText(order, settings)
  };
}

async function handleApi(req, res, pathname, url) {
  const db = await readDb();
  cleanSessions(db);

  if (req.method === "GET" && pathname === "/api/health") {
    json(res, 200, {
      ok: true,
      app: db.meta.name,
      version: db.meta.version,
      time: now()
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/settings") {
    json(res, 200, { ok: true, settings: db.settings });
    return;
  }

  if (req.method === "GET" && pathname === "/api/products") {
    const q = String(url.searchParams.get("q") || "").toLowerCase();
    const category = String(url.searchParams.get("category") || "all");
    let products = db.products || [];
    if (category && category !== "all") {
      products = products.filter((product) => product.category === category);
    }
    if (q) {
      products = products.filter((product) => {
        return [product.name, product.summary, product.description, ...(product.tags || [])].join(" ").toLowerCase().includes(q);
      });
    }
    json(res, 200, { ok: true, products });
    return;
  }

  const productMatch = pathname.match(/^\/api\/products\/([^/]+)$/);
  if (req.method === "GET" && productMatch) {
    const product = (db.products || []).find((item) => item.id === productMatch[1]);
    if (!product) {
      error(res, 404, "Product not found.");
      return;
    }
    json(res, 200, { ok: true, product });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    const body = await readBody(req);
    const identifier = String(body.identifier || body.phone || body.email || "").trim();
    const loginPhoneKey = phoneKey(identifier);
    const loginEmail = normalizeEmail(identifier);
    const loginUsername = identifier.toLowerCase();
    const user = (db.users || []).find((item) => {
      return phoneKey(item.phone) === loginPhoneKey || normalizeEmail(item.email) === loginEmail || String(item.username || "").toLowerCase() === loginUsername;
    });
    if (!user || !verifyPassword(String(body.password || ""), user.passwordHash)) {
      error(res, 401, "Invalid ID, mobile number, or password.");
      return;
    }
    const token = createSession(db, user);
    await writeDb(db);
    setSessionCookie(res, token);
    json(res, 200, { ok: true, user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/request-otp") {
    const body = await readBody(req);
    const missing = requireFields(body, ["name", "phone", "password"]);
    if (missing) {
      error(res, 400, missing);
      return;
    }
    const email = normalizeEmail(body.email);
    if (email && !validEmail(email)) {
      error(res, 400, "Please enter a valid email address.");
      return;
    }
    if (!validPhone(body.phone)) {
      error(res, 400, "Please enter a valid phone number.");
      return;
    }
    const mobileKey = phoneKey(body.phone);
    if (mobileKey.length < 10) {
      error(res, 400, "Please enter a valid mobile number.");
      return;
    }
    if (String(body.password).length < 8) {
      error(res, 400, "Password must be at least 8 characters.");
      return;
    }
    if ((db.users || []).some((user) => phoneKey(user.phone) === mobileKey)) {
      error(res, 409, "An account with this mobile number already exists.");
      return;
    }
    if (email && (db.users || []).some((user) => normalizeEmail(user.email) === email)) {
      error(res, 409, "An account with this email already exists.");
      return;
    }
    const otp = generateOtp();
    const challenge = {
      id: id("otp"),
      purpose: "register",
      name: String(body.name).trim().slice(0, 80),
      email,
      phone: String(body.phone).trim(),
      phoneKey: mobileKey,
      passwordHash: hashPassword(String(body.password)),
      otpHash: hashPassword(otp),
      attempts: 0,
      createdAt: now(),
      expiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString()
    };
    db.otpChallenges = (db.otpChallenges || []).filter((item) => item.phoneKey !== mobileKey);
    db.otpChallenges.push(challenge);
    const sms = await sendOtpSms(challenge.phone, otp);
    await writeDb(db);
    const demoAllowed = !sms.sent || process.env.SHOW_DEMO_OTP === "true";
    json(res, 200, {
      ok: true,
      challengeId: challenge.id,
      otpSent: sms.sent,
      smsProvider: sms.provider,
      message: sms.sent ? "OTP sent to your mobile number." : "Free SMS was not available, so use the demo OTP shown here.",
      demoOtp: demoAllowed ? otp : undefined
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/verify-otp") {
    const body = await readBody(req);
    const challenge = (db.otpChallenges || []).find((item) => item.id === body.challengeId);
    if (!challenge) {
      error(res, 400, "OTP session expired. Please request a new OTP.");
      return;
    }
    if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
      db.otpChallenges = (db.otpChallenges || []).filter((item) => item.id !== challenge.id);
      await writeDb(db);
      error(res, 400, "OTP expired. Please request a new OTP.");
      return;
    }
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      db.otpChallenges = (db.otpChallenges || []).filter((item) => item.id !== challenge.id);
      await writeDb(db);
      error(res, 429, "Too many OTP attempts. Please request a new OTP.");
      return;
    }
    if (!verifyPassword(String(body.otp || ""), challenge.otpHash)) {
      challenge.attempts += 1;
      await writeDb(db);
      error(res, 400, "Invalid OTP.");
      return;
    }
    if ((db.users || []).some((user) => phoneKey(user.phone) === challenge.phoneKey)) {
      db.otpChallenges = (db.otpChallenges || []).filter((item) => item.id !== challenge.id);
      await writeDb(db);
      error(res, 409, "An account with this mobile number already exists.");
      return;
    }
    const user = {
      id: id("usr"),
      name: challenge.name,
      email: challenge.email,
      phone: challenge.phone,
      phoneVerified: true,
      role: "customer",
      passwordHash: challenge.passwordHash,
      createdAt: now(),
      address: ""
    };
    db.users.push(user);
    db.otpChallenges = (db.otpChallenges || []).filter((item) => item.id !== challenge.id);
    const token = createSession(db, user);
    await writeDb(db);
    setSessionCookie(res, token);
    json(res, 201, { ok: true, user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/register") {
    error(res, 400, "Please create an account by verifying your mobile number with OTP.");
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const token = parseCookies(req.headers.cookie).kf_session;
    db.sessions = (db.sessions || []).filter((session) => session.token !== token);
    await writeDb(db);
    clearSessionCookie(res);
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/auth/me") {
    await writeDb(db);
    json(res, 200, { ok: true, user: publicUser(currentUser(req, db)) });
    return;
  }

  if (req.method === "PATCH" && pathname === "/api/users/me") {
    const user = requireUser(req, res, db);
    if (!user) {
      return;
    }
    const body = await readBody(req);
    if (body.name) {
      user.name = String(body.name).trim().slice(0, 80);
    }
    if (body.phone) {
      if (!validPhone(body.phone)) {
        error(res, 400, "Please enter a valid phone number.");
        return;
      }
      user.phone = String(body.phone).trim();
    }
    if (typeof body.address === "string") {
      user.address = body.address.trim().slice(0, 200);
    }
    await writeDb(db);
    json(res, 200, { ok: true, user: publicUser(user) });
    return;
  }

  if (req.method === "GET" && pathname === "/api/orders") {
    const user = requireUser(req, res, db);
    if (!user) {
      return;
    }
    const orders = (user.role === "admin" ? db.orders : db.orders.filter((order) => order.userId === user.id))
      .map((order) => orderForResponse(order, db.settings));
    json(res, 200, { ok: true, orders });
    return;
  }

  if (req.method === "POST" && pathname === "/api/orders") {
    const body = await readBody(req);
    const customer = body.customer || {};
    const missing = requireFields(customer, ["name", "phone"]);
    if (missing) {
      error(res, 400, missing);
      return;
    }
    if (!validPhone(customer.phone)) {
      error(res, 400, "Please enter a valid phone number.");
      return;
    }
    const user = currentUser(req, db);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) {
      error(res, 400, "Your cart is empty.");
      return;
    }
    let total = 0;
    const normalizedItems = [];
    for (const item of items) {
      const product = db.products.find((entry) => entry.id === item.productId);
      if (!product) {
        error(res, 400, "Invalid product in cart.");
        return;
      }
      const quantity = Math.min(50, Math.max(1, Number(item.quantity) || 1));
      const selectedOptions = item.options && typeof item.options === "object" ? item.options : {};
      const unitPrice = productPrice(product, selectedOptions);
      total += unitPrice * quantity;
      normalizedItems.push({
        productId: product.id,
        name: product.name,
        quantity,
        unitPrice,
        options: selectedOptions
      });
    }
    let upload = null;
    try {
      upload = await saveUpload(body.upload);
    } catch (uploadError) {
      error(res, 400, uploadError.message);
      return;
    }
    const order = {
      id: orderId(db),
      userId: user ? user.id : null,
      customer: {
        name: String(customer.name).trim().slice(0, 80),
        email: normalizeEmail(customer.email),
        phone: String(customer.phone).trim(),
        address: String(customer.address || "").trim().slice(0, 200)
      },
      items: normalizedItems,
      notes: String(body.notes || "").trim().slice(0, 800),
      upload,
      total,
      payment: paymentFromInput(body.payment, total),
      status: "New",
      createdAt: now(),
      updatedAt: now()
    };
    order.whatsappUrl = buildWhatsAppText(order, db.settings);
    order.customerWhatsappUrl = buildCustomerWhatsAppText(order, db.settings);
    db.orders.unshift(order);
    await writeDb(db);
    json(res, 201, { ok: true, order });
    return;
  }

  const orderStatusMatch = pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
  if (req.method === "PATCH" && orderStatusMatch) {
    const admin = requireAdmin(req, res, db);
    if (!admin) {
      return;
    }
    const body = await readBody(req);
    const allowed = ["New", "Preview", "Approved", "Printing", "Ready", "Delivered", "Cancelled"];
    if (!allowed.includes(body.status)) {
      error(res, 400, "Invalid order status.");
      return;
    }
    const order = db.orders.find((entry) => entry.id === orderStatusMatch[1]);
    if (!order) {
      error(res, 404, "Order not found.");
      return;
    }
    order.status = body.status;
    order.updatedAt = now();
    order.customerWhatsappUrl = buildCustomerWhatsAppText(order, db.settings);
    await writeDb(db);
    json(res, 200, { ok: true, order: orderForResponse(order, db.settings) });
    return;
  }

  const orderPaymentMatch = pathname.match(/^\/api\/orders\/([^/]+)\/payment$/);
  if (req.method === "PATCH" && orderPaymentMatch) {
    const admin = requireAdmin(req, res, db);
    if (!admin) {
      return;
    }
    const body = await readBody(req);
    if (!PAYMENT_STATUSES.includes(body.status)) {
      error(res, 400, "Invalid payment status.");
      return;
    }
    const order = db.orders.find((entry) => entry.id === orderPaymentMatch[1]);
    if (!order) {
      error(res, 404, "Order not found.");
      return;
    }
    order.payment = paymentForOrder(order);
    order.payment.status = body.status;
    if (typeof body.reference === "string") {
      order.payment.reference = body.reference.trim().slice(0, 120);
    }
    order.payment.updatedAt = now();
    order.updatedAt = now();
    order.whatsappUrl = buildWhatsAppText(order, db.settings);
    order.customerWhatsappUrl = buildCustomerWhatsAppText(order, db.settings);
    await writeDb(db);
    json(res, 200, { ok: true, order: orderForResponse(order, db.settings) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/contact") {
    const body = await readBody(req);
    const missing = requireFields(body, ["name", "phone", "message"]);
    if (missing) {
      error(res, 400, missing);
      return;
    }
    if (!validPhone(body.phone)) {
      error(res, 400, "Please enter a valid phone number.");
      return;
    }
    const entry = {
      id: id("msg"),
      name: String(body.name).trim().slice(0, 80),
      phone: String(body.phone).trim(),
      email: normalizeEmail(body.email),
      message: String(body.message).trim().slice(0, 1000),
      createdAt: now(),
      status: "Unread"
    };
    db.contacts.unshift(entry);
    await writeDb(db);
    json(res, 201, { ok: true, contact: entry });
    return;
  }

  if (req.method === "GET" && pathname === "/api/contact") {
    const admin = requireAdmin(req, res, db);
    if (!admin) {
      return;
    }
    json(res, 200, { ok: true, contacts: db.contacts || [] });
    return;
  }

  if (req.method === "GET" && pathname === "/api/customers") {
    const admin = requireAdmin(req, res, db);
    if (!admin) {
      return;
    }
    const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
    const users = (db.users || []).filter((user) => user.role !== "admin");
    const customers = users.map((user) => {
      const userOrders = (db.orders || []).filter((order) => {
        return order.userId === user.id || phoneKey(order.customer && order.customer.phone) === phoneKey(user.phone);
      }).map((order) => ({ ...order, payment: paymentForOrder(order) }));
      const totalSpent = userOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
      const lastOrder = userOrders[0] || null;
      return {
        id: user.id,
        name: user.name,
        username: user.username || "",
        email: user.email || "",
        phone: user.phone || "",
        phoneVerified: Boolean(user.phoneVerified),
        address: user.address || "",
        createdAt: user.createdAt,
        orderCount: userOrders.length,
        totalSpent,
        lastOrderAt: lastOrder ? lastOrder.createdAt : null,
        orders: userOrders
      };
    }).filter((customer) => {
      if (!q) {
        return true;
      }
      return [customer.name, customer.email, customer.phone, customer.address, customer.id]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    json(res, 200, { ok: true, customers });
    return;
  }

  if (req.method === "GET" && pathname === "/api/dashboard/stats") {
    const user = requireUser(req, res, db);
    if (!user) {
      return;
    }
    const orders = user.role === "admin" ? db.orders : db.orders.filter((order) => order.userId === user.id);
    const revenue = orders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
    const pending = orders.filter((order) => !["Delivered", "Cancelled"].includes(order.status)).length;
    json(res, 200, {
      ok: true,
      stats: {
        orders: orders.length,
        revenue,
        pending,
        products: db.products.length,
        contacts: user.role === "admin" ? (db.contacts || []).length : 0
      }
    });
    return;
  }

  error(res, 404, "API route not found.");
}

async function serveStatic(req, res, pathname) {
  if (["/karim.html", "/cup.html", "/re1.html", "/pillow.html"].includes(pathname)) {
    const target = pathname === "/karim.html" ? "/" : "/?product=" + encodeURIComponent(pathname.replace("/", "").replace(".html", ""));
    send(res, 302, "Redirecting", { Location: target });
    return;
  }

  let requestedPath = pathname === "/" ? "/index.html" : pathname;
  if (requestedPath === "/auth") {
    requestedPath = "/auth.html";
  }
  if (requestedPath === "/dashboard") {
    requestedPath = "/dashboard.html";
  }
  if (requestedPath === "/owner-dashboard") {
    requestedPath = "/owner-dashboard.html";
  }
  if (requestedPath === "/customer-dashboard") {
    requestedPath = "/customer-dashboard.html";
  }
  if (requestedPath === "/product") {
    requestedPath = "/product.html";
  }
  if (requestedPath.startsWith("/uploads/")) {
    const uploadFile = path.resolve(UPLOAD_DIR, "." + requestedPath.replace("/uploads", ""));
    if (!uploadFile.startsWith(UPLOAD_DIR)) {
      error(res, 403, "Forbidden.");
      return;
    }
    await streamFile(res, uploadFile);
    return;
  }

  const file = path.resolve(PUBLIC_DIR, "." + requestedPath);
  if (!file.startsWith(PUBLIC_DIR)) {
    error(res, 403, "Forbidden.");
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    await streamFile(res, file);
    return;
  }
  await streamFile(res, path.join(PUBLIC_DIR, "404.html"), 404);
}

async function streamFile(res, file, status = 200) {
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      error(res, 404, "File not found.");
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const stream = fs.createReadStream(file);
    res.writeHead(status, securityHeaders({
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": [".html", ".css", ".js"].includes(ext) ? "no-store" : "public, max-age=3600"
    }));
    stream.pipe(res);
    stream.on("error", () => error(res, 500, "Unable to read file."));
  } catch (fileError) {
    error(res, status === 404 ? 404 : 500, "File not found.");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname, url);
      return;
    }

    await serveStatic(req, res, pathname);
  } catch (routeError) {
    if (!res.headersSent) {
      error(res, 500, "Unexpected server error.", routeError.message);
    } else {
      res.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  const hostLabel = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
  console.log("Karimnagar Frames running at http://" + hostLabel + ":" + PORT);
});
