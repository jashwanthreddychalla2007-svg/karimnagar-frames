"use strict";

const ConfirmationApp = (() => {
  const qs = (selector, root = document) => root.querySelector(selector);
  const money = (value) => "Rs. " + (Number(value) || 0).toLocaleString("en-IN");

  async function api(path) {
    const response = await fetch(path, { credentials: "include" });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error((data.error && data.error.message) || "Something went wrong.");
    }
    return data;
  }

  function toast(message, type = "success") {
    const stack = qs("[data-toast-stack]");
    if (!stack) {
      return;
    }
    const item = document.createElement("div");
    item.className = "toast " + type;
    item.textContent = message;
    stack.appendChild(item);
    window.setTimeout(() => item.remove(), 3400);
  }

  function uploads(order) {
    if (Array.isArray(order.uploads) && order.uploads.length) {
      return order.uploads;
    }
    return order.upload ? [order.upload] : [];
  }

  function render(order) {
    const root = qs("[data-confirmation]");
    root.innerHTML = `
      <p class="eyebrow">Order placed</p>
      <h1>${order.id}</h1>
      <p>Your order is saved in your account. You can track it anytime from your dashboard.</p>
      <div class="checkout-summary">
        ${order.items.map((item) => `<p><strong>${item.name}</strong> x ${item.quantity} = ${money(item.unitPrice * item.quantity)}</p>`).join("")}
        <strong>Total: ${money(order.total)}</strong>
      </div>
      <div class="order-photos confirmation-photos">
        ${uploads(order).map((upload, index) => `
          <a href="${upload.url}" target="_blank" rel="noopener">
            <img src="${upload.url}" alt="${upload.label || "Order photo " + (index + 1)}" />
            <span>${upload.label || "Photo " + (index + 1)}</span>
          </a>
        `).join("")}
      </div>
      <div class="hero-actions">
        <a class="btn" href="${order.whatsappUrl}" target="_blank" rel="noopener">Send on WhatsApp</a>
        <a class="btn btn-outline" href="/customer-dashboard.html#orders">My Orders</a>
        <a class="btn btn-soft" href="/">Back to Store</a>
      </div>
    `;
  }

  async function init() {
    const id = new URLSearchParams(window.location.search).get("order");
    if (!id) {
      window.location.href = "/";
      return;
    }
    try {
      const result = await api("/api/orders/" + encodeURIComponent(id));
      render(result.order);
    } catch (error) {
      toast(error.message, "error");
      window.setTimeout(() => {
        window.location.href = "/auth.html?returnTo=" + encodeURIComponent(window.location.pathname + window.location.search);
      }, 900);
    }
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", ConfirmationApp.init);
