"use strict";

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const net = require("net");

const root = path.resolve(__dirname, "..");
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(baseUrl + pathname, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch (error) {
    data = { raw: text };
  }
  if (!response.ok || data.ok === false) {
    throw new Error(pathname + " failed: " + text);
  }
  return { response, data };
}

function cookieFrom(response) {
  const setCookie = response.headers.get("set-cookie");
  return setCookie ? setCookie.split(";")[0] : "";
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function startLocalServer() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "kf-ui-audit-"));
  const tempDb = path.join(temp, "db.json");
  const tempUploads = path.join(temp, "uploads");
  const port = await getFreePort();
  await fs.copyFile(path.join(root, "data", "db.json"), tempDb);
  await fs.mkdir(tempUploads, { recursive: true });
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DB_FILE: tempDb,
      UPLOAD_DIR: tempUploads,
      OTP_CHANNEL: "email",
      EMAIL_PROVIDER: "demo",
      SMS_PROVIDER: "demo",
      SHOW_DEMO_OTP: "true"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  const baseUrl = "http://127.0.0.1:" + port;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const health = await fetch(baseUrl + "/api/health");
      if (health.ok) {
        return {
          baseUrl,
          async cleanup() {
            child.kill();
            await fs.rm(temp, { recursive: true, force: true });
          },
          output: () => output
        };
      }
    } catch (error) {
      await delay(200);
    }
  }
  child.kill();
  await fs.rm(temp, { recursive: true, force: true });
  throw new Error("Local UI audit server did not start. " + output);
}

function defaultOptions(product) {
  const options = {};
  (product.options || []).forEach((group) => {
    if (group.choices && group.choices.length) {
      options[group.name] = group.choices[0].label;
    }
  });
  return options;
}

function optionKey(value) {
  return JSON.stringify(value || {});
}

function optionSetsForProduct(product) {
  const base = defaultOptions(product);
  const seen = new Set([optionKey(base)]);
  const sets = [{ label: "default options", options: base }];
  (product.options || []).forEach((group) => {
    (group.choices || []).forEach((choice) => {
      const options = { ...base, [group.name]: choice.label };
      const key = optionKey(options);
      if (!seen.has(key)) {
        seen.add(key);
        sets.push({ label: group.name + " = " + choice.label, options });
      }
    });
  });
  return sets;
}

function normalizeOptionValue(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\bprinting?\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function optionValueMatches(selectedValue, ruleValue) {
  const selected = normalizeOptionValue(selectedValue);
  const expected = normalizeOptionValue(ruleValue);
  return Boolean(selected && expected && (selected === expected || selected.includes(expected) || expected.includes(selected)));
}

function defaultUploadLabels(max) {
  return Array.from({ length: Math.max(1, Number(max) || 1) }, (_, index) => "Photo " + (index + 1));
}

function photoRequirement(product, selectedOptions = {}) {
  const config = product && product.photoRequirements && typeof product.photoRequirements === "object" ? product.photoRequirements : {};
  let requirement = {
    min: Number(config.min) || 1,
    max: Number(config.max) || Math.max(1, Number(config.min) || 1),
    labels: Array.isArray(config.labels) && config.labels.length ? [...config.labels] : defaultUploadLabels(config.max || config.min || 1)
  };
  (config.rules || []).forEach((rule) => {
    const when = rule.when || {};
    if (when.option && optionValueMatches(selectedOptions[when.option], when.value)) {
      requirement = {
        min: Number(rule.min) || requirement.min,
        max: Number(rule.max) || requirement.max,
        labels: Array.isArray(rule.labels) && rule.labels.length ? [...rule.labels] : requirement.labels
      };
    }
  });
  if (requirement.max < requirement.min) {
    requirement.max = requirement.min;
  }
  if (requirement.labels.length < requirement.max) {
    requirement.labels = requirement.labels.concat(defaultUploadLabels(requirement.max).slice(requirement.labels.length));
  }
  return requirement;
}

function customFieldsForProduct(product) {
  const values = {};
  (product.customFields || []).forEach((field, index) => {
    values[field.label || field.id || "Field " + (index + 1)] = "UI audit value " + (index + 1);
  });
  return values;
}

async function createCustomer(baseUrl) {
  const suffix = String(Date.now()).slice(-9);
  const phone = "8" + suffix;
  const password = "UiAudit@" + suffix;
  const email = "uiaudit+" + suffix + "@example.com";
  const name = "UI Audit Customer " + suffix;
  const otpRequest = await request(baseUrl, "/api/auth/request-otp", {
    method: "POST",
    body: JSON.stringify({ name, phone, email, password })
  });
  const verified = await request(baseUrl, "/api/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({
      challengeId: otpRequest.data.challengeId,
      otp: otpRequest.data.demoOtp
    })
  });
  const cookie = cookieFrom(verified.response);
  return {
    cookie,
    customer: {
      name,
      phone,
      email,
      address: "UI Audit Address, Karimnagar"
    }
  };
}

async function loginOwner(baseUrl) {
  const ownerId = process.env.LIVE_AUDIT_OWNER_ID || process.env.OWNER_ID || "karimnagarframes";
  const ownerPassword = process.env.LIVE_AUDIT_OWNER_PASSWORD || process.env.OWNER_PASSWORD;
  if (!ownerPassword) {
    return "";
  }
  const login = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      identifier: ownerId,
      password: ownerPassword
    })
  });
  return cookieFrom(login.response);
}

async function cancelOrders(baseUrl, ownerCookie, orderIds) {
  if (!ownerCookie) {
    return 0;
  }
  let count = 0;
  for (const orderId of orderIds) {
    await request(baseUrl, "/api/orders/" + encodeURIComponent(orderId) + "/status", {
      method: "PATCH",
      headers: { Cookie: ownerCookie },
      body: JSON.stringify({ status: "Cancelled" })
    });
    count += 1;
  }
  return count;
}

async function setCart(baseUrl, customerCookie, product, options) {
  await request(baseUrl, "/api/cart", {
    method: "PUT",
    headers: { Cookie: customerCookie },
    body: JSON.stringify({
      items: [{
        productId: product.id,
        quantity: 1,
        options,
        customFields: customFieldsForProduct(product)
      }]
    })
  });
}

async function addBrowserCookie(context, baseUrl, cookie) {
  const [name, value] = cookie.split("=");
  const url = new URL(baseUrl);
  await context.addCookies([{
    name,
    value,
    domain: url.hostname,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: url.protocol === "https:"
  }]);
}

async function placeOrderInUi(page, baseUrl, customer, product, optionSet, photoFile) {
  if (page._auditMessages) {
    page._auditMessages.length = 0;
  }
  const requirement = photoRequirement(product, optionSet.options);
  await page.goto(baseUrl + "/?cart=open&uiAudit=" + Date.now(), { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Checkout" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("Your name").fill(customer.name);
  await dialog.getByPlaceholder("Phone number").fill(customer.phone);
  await dialog.getByPlaceholder("Email optional").fill(customer.email);
  await dialog.getByPlaceholder("Delivery address").fill(customer.address);
  const uploadInputs = dialog.locator("[data-upload-slot]");
  const inputCount = await uploadInputs.count();
  if (inputCount < requirement.min) {
    throw new Error(product.name + " rendered " + inputCount + " upload inputs, expected at least " + requirement.min + ".");
  }
  for (let index = 0; index < requirement.min; index += 1) {
    await uploadInputs.nth(index).setInputFiles(photoFile);
  }
  await page.waitForFunction((min) => document.querySelectorAll(".upload-preview img").length >= min, requirement.min, { timeout: 20000 });
  await dialog.getByRole("button", { name: "Place Order" }).click();
  const deadline = Date.now() + 30000;
  while (!/wa\.me|whatsapp|confirmation/i.test(page.url()) && Date.now() < deadline) {
    if ((page._auditMessages || []).some((message) => message.includes("https://wa.me/"))) {
      break;
    }
    await page.waitForTimeout(250);
  }
  const whatsappRequest = (page._auditMessages || []).find((message) => message.includes("https://wa.me/"));
  if (!/wa\.me|whatsapp|confirmation/i.test(page.url()) && !whatsappRequest) {
    const debug = await page.evaluate(async () => ({
      url: window.location.href,
      bodyText: document.body.innerText.slice(0, 2000),
      toasts: Array.from(document.querySelectorAll("[data-toast-stack] .toast")).map((item) => item.textContent),
      submitText: document.querySelector("[data-place-order]")?.textContent || "",
      submitDisabled: Boolean(document.querySelector("[data-place-order]")?.disabled),
      uploadCount: document.querySelectorAll(".upload-preview img").length,
      formValid: document.querySelector("[data-checkout-form]")?.checkValidity(),
      formExists: Boolean(document.querySelector("[data-checkout-form]")),
      checkoutOpen: Boolean(document.querySelector("[data-checkout-modal]")?.open),
      appLoaded: Boolean(window.StoreApp),
      scripts: Array.from(document.scripts).map((script) => script.src),
      placeButtonHtml: document.querySelector("[data-place-order]")?.outerHTML || "",
      appHasPlaceListener: await fetch("/app.js?v=20260526-orderfix").then((response) => response.text()).then((text) => text.includes("placeOrderButton.addEventListener")).catch(() => false),
      checkoutDebug: window.KFCheckoutDebug || null
    }));
    debug.messages = (page._auditMessages || []).slice(-20);
    throw new Error(product.name + " did not redirect after Place Order. Debug: " + JSON.stringify(debug));
  }
  const redirectedUrl = whatsappRequest ? whatsappRequest.replace(/^.*?(https:\/\/wa\.me\/.*?)(?:\s+net::.*)?$/, "$1") : page.url();
  if (!/wa\.me|whatsapp/i.test(redirectedUrl)) {
    throw new Error(product.name + " did not redirect to WhatsApp after placing order. URL: " + redirectedUrl);
  }
  return redirectedUrl;
}

async function audit(baseUrl, mode) {
  const products = (await request(baseUrl, "/api/products")).data.products || [];
  const account = await createCustomer(baseUrl);
  const ownerCookie = await loginOwner(baseUrl);
  const maxFlows = Number(process.env.UI_AUDIT_MAX_FLOWS || 0);
  const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath
  });
  const context = await browser.newContext();
  await addBrowserCookie(context, baseUrl, account.cookie);
  const page = await context.newPage();
  const pageMessages = [];
  page.on("console", (message) => pageMessages.push(message.type() + ": " + message.text()));
  page.on("pageerror", (error) => pageMessages.push("pageerror: " + error.message));
  page.on("requestfailed", (request) => pageMessages.push("requestfailed: " + request.url() + " " + (request.failure() && request.failure().errorText)));
  page.on("response", async (response) => {
    if (response.url().includes("/api/orders")) {
      let body = "";
      try {
        body = (await response.text()).slice(0, 500);
      } catch (error) {
        body = "unreadable response";
      }
      pageMessages.push("response: " + response.status() + " " + response.url() + " " + body);
    }
  });
  page._auditMessages = pageMessages;
  const artifactsDir = path.join(root, "artifacts");
  await fs.mkdir(artifactsDir, { recursive: true });
  const photoFile = path.join(artifactsDir, "ui-audit-photo.png");
  await fs.writeFile(photoFile, ONE_PIXEL_PNG);
  const results = [];
  const orderIds = [];
  let ordersCancelled = 0;
  try {
    outer: for (const product of products) {
      for (const optionSet of optionSetsForProduct(product)) {
        if (maxFlows && results.length >= maxFlows) {
          break outer;
        }
        await setCart(baseUrl, account.cookie, product, optionSet.options);
        const redirectedUrl = await placeOrderInUi(page, baseUrl, account.customer, product, optionSet, photoFile);
        const customerOrders = await request(baseUrl, "/api/orders", {
          headers: { Cookie: account.cookie }
        });
        const latest = (customerOrders.data.orders || [])[0];
        if (!latest || !latest.items.some((item) => item.productId === product.id)) {
          throw new Error(product.name + " UI order was not saved in customer orders.");
        }
        orderIds.push(latest.id);
        results.push({
          productId: product.id,
          productName: product.name,
          optionSet: optionSet.label,
          orderId: latest.id,
          whatsapp: redirectedUrl
        });
        console.log("UI OK " + product.name + " - " + optionSet.label + " -> " + latest.id);
      }
    }
  } finally {
    await browser.close();
    ordersCancelled = await cancelOrders(baseUrl, ownerCookie, orderIds);
  }
  const report = {
    ok: true,
    mode,
    baseUrl,
    customer: account.customer,
    flowsTested: results.length,
    ordersCancelled,
    results,
    finishedAt: new Date().toISOString()
  };
  const reportFile = path.join(artifactsDir, "ui-checkout-audit-" + mode + ".json");
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log("Report saved to " + reportFile);
}

async function main() {
  let cleanup = async () => {};
  let baseUrl = process.env.UI_AUDIT_BASE_URL || "";
  let mode = baseUrl ? "live" : "local";
  let serverOutput = "";
  if (!baseUrl) {
    const local = await startLocalServer();
    baseUrl = local.baseUrl;
    cleanup = local.cleanup;
    serverOutput = local.output;
  }
  try {
    await audit(baseUrl.replace(/\/$/, ""), mode);
  } catch (error) {
    if (serverOutput) {
      console.error(serverOutput());
    }
    throw error;
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
