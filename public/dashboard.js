"use strict";

const DashboardApp = (() => {
  const state = {
    user: null,
    orders: [],
    settings: null,
    contacts: []
  };

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const money = (value) => "Rs. " + (Number(value) || 0).toLocaleString("en-IN");
  const dashboardScope = document.body.dataset.dashboardScope || "auto";

  function dashboardPath(user) {
    return user && user.role === "admin" ? "/owner-dashboard.html" : "/customer-dashboard.html";
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });
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

  function renderAdminVisibility() {
    const isAdmin = state.user && state.user.role === "admin";
    qsa("[data-admin-only]").forEach((node) => {
      node.hidden = !isAdmin;
    });
  }

  function renderProfile() {
    const title = qs("[data-dashboard-title]");
    if (title) {
      title.textContent = "Hello, " + state.user.name;
    }
    const form = qs("[data-profile-form]");
    if (!form) {
      return;
    }
    form.elements.name.value = state.user.name || "";
    form.elements.phone.value = state.user.phone || "";
    form.elements.address.value = state.user.address || "";
  }

  function renderStats(stats) {
    const root = qs("[data-stats]");
    if (!root) {
      return;
    }
    const cards = [
      ["Orders", stats.orders],
      [state.user.role === "admin" ? "Revenue" : "Order Value", money(stats.revenue)],
      ["Active", stats.pending],
      [state.user.role === "admin" ? "Messages" : "Available Products", state.user.role === "admin" ? stats.contacts : stats.products]
    ];
    root.innerHTML = cards.map(([label, value]) => `
      <article class="stat-card">
        <span>${label}</span>
        <strong>${value}</strong>
      </article>
    `).join("");
  }

  function orderItemsText(order) {
    return order.items.map((item) => item.name + " x " + item.quantity).join(", ");
  }

  function orderPayment(order) {
    const payment = order.payment || {};
    const method = payment.method || "Pay on Delivery";
    const status = payment.status || (method === "Pay on Delivery" ? "Pending" : "Awaiting Confirmation");
    return {
      method,
      status,
      reference: payment.reference || ""
    };
  }

  function renderOrders() {
    const table = qs("[data-orders-table]");
    if (!table) {
      return;
    }
    if (!state.orders.length) {
      table.innerHTML = "<tr><td colspan=\"7\">No orders yet.</td></tr>";
      return;
    }
    const statuses = ["New", "Preview", "Approved", "Printing", "Ready", "Delivered", "Cancelled"];
    const paymentStatuses = ["Pending", "Awaiting Confirmation", "Paid", "Failed", "Refunded", "Cancelled"];
    const isAdmin = state.user.role === "admin";
    table.innerHTML = state.orders.map((order) => `
      <tr>
        <td><strong>${order.id}</strong><br><small>${new Date(order.createdAt).toLocaleString()}</small></td>
        <td>${order.customer.name}<br><small>${order.customer.phone}</small></td>
        <td>${orderItemsText(order)}</td>
        <td>${money(order.total)}</td>
        <td>
          <strong>${orderPayment(order).method}</strong><br>
          ${isAdmin ? `
            <select class="status-select payment-select" data-payment="${order.id}">
              ${paymentStatuses.map((status) => `<option value="${status}" ${status === orderPayment(order).status ? "selected" : ""}>${status}</option>`).join("")}
            </select>
          ` : `<small>${orderPayment(order).status}</small>`}
          ${orderPayment(order).reference ? `<small>Ref: ${orderPayment(order).reference}</small>` : ""}
        </td>
        <td>
          ${isAdmin ? `
            <select class="status-select" data-status="${order.id}">
              ${statuses.map((status) => `<option value="${status}" ${status === order.status ? "selected" : ""}>${status}</option>`).join("")}
            </select>
          ` : `<strong>${order.status}</strong>`}
        </td>
        <td>
          ${order.whatsappUrl ? `<a class="btn btn-outline" href="${order.whatsappUrl}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
          ${order.upload ? `<a class="btn btn-outline" href="${order.upload.url}" target="_blank" rel="noopener">Image</a>` : ""}
        </td>
      </tr>
    `).join("");

    qsa("[data-status]").forEach((select) => {
      select.addEventListener("change", async () => {
        try {
          const result = await api("/api/orders/" + select.dataset.status + "/status", {
            method: "PATCH",
            body: JSON.stringify({ status: select.value })
          });
          const index = state.orders.findIndex((order) => order.id === result.order.id);
          if (index >= 0) {
            state.orders[index] = result.order;
          }
          toast("Order status updated.");
        } catch (error) {
          toast(error.message, "error");
          await loadOrders();
        }
      });
    });

    qsa("[data-payment]").forEach((select) => {
      select.addEventListener("change", async () => {
        try {
          const result = await api("/api/orders/" + select.dataset.payment + "/payment", {
            method: "PATCH",
            body: JSON.stringify({ status: select.value })
          });
          const index = state.orders.findIndex((order) => order.id === result.order.id);
          if (index >= 0) {
            state.orders[index] = result.order;
          }
          toast("Payment status updated.");
        } catch (error) {
          toast(error.message, "error");
          await loadOrders();
        }
      });
    });
  }

  function renderSettings() {
    const root = qs("[data-settings-list]");
    if (!root || !state.settings) {
      return;
    }
    const settings = state.settings;
    const rows = [
      ["Store", settings.storeName],
      ["Location", settings.location],
      ["WhatsApp", settings.whatsappPhone],
      ["Support numbers", (settings.supportPhones || []).join(", ")],
      ["Shipping", settings.shippingWindow],
      ["Returns", settings.returnWindow],
      ["Business hours", settings.businessHours]
    ];
    root.innerHTML = rows.map(([label, value]) => `
      <article class="settings-item">
        <strong>${label}</strong>
        <span>${value}</span>
      </article>
    `).join("");
  }

  function renderMessages() {
    const root = qs("[data-messages]");
    if (!root) {
      return;
    }
    if (!state.contacts.length) {
      root.innerHTML = "<p>No contact messages yet.</p>";
      return;
    }
    root.innerHTML = state.contacts.map((entry) => `
      <article class="message-item">
        <strong>${entry.name} - ${entry.phone}</strong>
        <span>${entry.email || "No email"}</span>
        <p>${entry.message}</p>
      </article>
    `).join("");
  }

  async function loadOrders() {
    const result = await api("/api/orders");
    state.orders = result.orders;
    renderOrders();
  }

  function setupRefresh() {
    const button = qs("[data-refresh-orders]");
    if (!button) {
      return;
    }
    button.addEventListener("click", async () => {
      try {
        await loadOrders();
        toast("Orders refreshed.");
      } catch (error) {
        toast(error.message, "error");
      }
    });
  }

  function setupProfile() {
    const form = qs("[data-profile-form]");
    if (!form) {
      return;
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const payload = Object.fromEntries(new FormData(form).entries());
        const result = await api("/api/users/me", {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        state.user = result.user;
        renderProfile();
        toast("Profile saved.");
      } catch (error) {
        toast(error.message, "error");
      }
    });
  }

  function setupTheme() {
    const saved = localStorage.getItem("kf_theme");
    if (saved) {
      document.body.dataset.theme = saved;
    }
    const button = qs("[data-theme-toggle]");
    if (!button) {
      return;
    }
    button.addEventListener("click", () => {
      const next = document.body.dataset.theme === "dark" ? "light" : "dark";
      document.body.dataset.theme = next;
      localStorage.setItem("kf_theme", next);
    });
  }

  function setupLogout() {
    const button = qs("[data-logout]");
    if (!button) {
      return;
    }
    button.addEventListener("click", async () => {
      try {
        await api("/api/auth/logout", { method: "POST", body: "{}" });
      } catch (error) {
        return;
      }
      window.location.href = "/auth.html";
    });
  }

  async function init() {
    setupTheme();
    setupLogout();
    setupProfile();
    setupRefresh();
    try {
      const me = await api("/api/auth/me");
      if (!me.user) {
        window.location.href = "/auth.html";
        return;
      }
      state.user = me.user;
      const target = dashboardPath(state.user);
      if (dashboardScope === "auto") {
        window.location.replace(target);
        return;
      }
      if (dashboardScope === "owner" && state.user.role !== "admin") {
        window.location.replace("/customer-dashboard.html");
        return;
      }
      if (dashboardScope === "customer" && state.user.role === "admin") {
        window.location.replace("/owner-dashboard.html");
        return;
      }
      renderAdminVisibility();
      renderProfile();
      const [stats, settings] = await Promise.all([
        api("/api/dashboard/stats"),
        api("/api/settings")
      ]);
      state.settings = settings.settings;
      renderStats(stats.stats);
      renderSettings();
      await loadOrders();
      if (state.user.role === "admin") {
        const contacts = await api("/api/contact");
        state.contacts = contacts.contacts;
        renderMessages();
      }
    } catch (error) {
      toast(error.message, "error");
      window.setTimeout(() => {
        window.location.href = "/auth.html";
      }, 800);
    }
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", DashboardApp.init);
