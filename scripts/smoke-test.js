"use strict";

const { spawn } = require("child_process");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");

const root = path.resolve(__dirname, "..");
const port = 8099;
const base = "http://127.0.0.1:" + port;

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base + "/api/health");
      if (response.ok) {
        return;
      }
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error("Server did not start in time.");
}

async function request(pathname, options = {}) {
  const response = await fetch(base + pathname, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
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

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "kf-smoke-"));
  const tempDb = path.join(temp, "db.json");
  const tempUploads = path.join(temp, "uploads");
  await fs.copyFile(path.join(root, "data", "db.json"), tempDb);
  await fs.mkdir(tempUploads, { recursive: true });

  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DB_FILE: tempDb,
      UPLOAD_DIR: tempUploads,
      SMS_PROVIDER: "demo"
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

  try {
    await waitForServer();
    await request("/api/products");
    await request("/");
    await request("/product.html?id=cup-photo-printing");
    await request("/owner-dashboard.html");
    await request("/customer-dashboard.html");
    await request("/api/products/cup-photo-printing");
    const login = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        identifier: "karimnagarframes",
        password: "karimnagar@123"
      })
    });
    const cookie = login.response.headers.get("set-cookie").split(";")[0];
    const otpRequest = await request("/api/auth/request-otp", {
      method: "POST",
      body: JSON.stringify({
        name: "OTP Customer",
        phone: "9123456780",
        email: "otp@example.com",
        password: "Customer@12345"
      })
    });
    if (!otpRequest.data.challengeId || !otpRequest.data.demoOtp) {
      throw new Error("OTP request did not return a demo OTP in test mode.");
    }
    const otpVerify = await request("/api/auth/verify-otp", {
      method: "POST",
      body: JSON.stringify({
        challengeId: otpRequest.data.challengeId,
        otp: otpRequest.data.demoOtp
      })
    });
    if (!otpVerify.data.user.phoneVerified || otpVerify.data.user.phone !== "9123456780") {
      throw new Error("OTP registration did not create a verified phone account.");
    }
    await request("/api/dashboard/stats", {
      headers: { Cookie: cookie }
    });
    await request("/api/contact", {
      method: "POST",
      body: JSON.stringify({
        name: "Smoke Test",
        phone: "9876543210",
        email: "smoke@example.com",
        message: "Testing contact form."
      })
    });
    const checkout = await request("/api/orders", {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({
        customer: {
          name: "Smoke Test",
          phone: "9876543210",
          email: "smoke@example.com",
          address: "Karimnagar"
        },
        notes: "Automated smoke test order.",
        items: [
          {
            productId: "cup-photo-printing",
            quantity: 1,
            options: {
              "Cup style": "White Glossy",
              "Print layout": "One side print"
            }
          }
        ],
        payment: {
          method: "UPI after Preview",
          reference: "SMOKE-UPI-1"
        }
      })
    });
    if (checkout.data.order.payment.status !== "Awaiting Confirmation") {
      throw new Error("Checkout payment status was not saved correctly.");
    }
    await request("/api/orders/" + checkout.data.order.id + "/payment", {
      method: "PATCH",
      headers: { Cookie: cookie },
      body: JSON.stringify({ status: "Paid" })
    });
    const ownerOrders = await request("/api/orders", {
      headers: { Cookie: cookie }
    });
    if (!ownerOrders.data.orders.some((order) => order.customer.phone === "9876543210")) {
      throw new Error("Owner dashboard order API did not include the new checkout order.");
    }
    if (!ownerOrders.data.orders.some((order) => String(order.whatsappUrl || "").includes("9032428063"))) {
      throw new Error("WhatsApp order URL does not use the owner phone number.");
    }
    if (!ownerOrders.data.orders.some((order) => order.id === checkout.data.order.id && order.payment.status === "Paid")) {
      throw new Error("Owner dashboard order API did not include the updated payment status.");
    }
    const customers = await request("/api/customers", {
      headers: { Cookie: cookie }
    });
    if (!customers.data.customers.some((customer) => customer.phone === "9123456780")) {
      throw new Error("Owner customers API did not include the OTP-created account.");
    }
    if (!customers.data.customers.some((customer) => customer.orderCount >= 1 || customer.phone === "9123456780")) {
      throw new Error("Owner customers API did not include customer order summaries.");
    }
    console.log("Smoke tests passed.");
  } finally {
    child.kill();
    await fs.rm(temp, { recursive: true, force: true });
  }

  if (child.exitCode && child.exitCode !== 0) {
    throw new Error(output);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
