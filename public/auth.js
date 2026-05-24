"use strict";

const AuthApp = (() => {
  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

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

  function showTab(name) {
    qsa("[data-auth-tab]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.authTab === name);
    });
    qs("[data-login-form]").hidden = name !== "login";
    qs("[data-register-form]").hidden = name !== "register";
  }

  function formValues(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function dashboardPath(user) {
    return user && user.role === "admin" ? "/owner-dashboard.html" : "/customer-dashboard.html";
  }

  function setupTabs() {
    qsa("[data-auth-tab]").forEach((button) => {
      button.addEventListener("click", () => showTab(button.dataset.authTab));
    });
  }

  function setupForms() {
    const login = qs("[data-login-form]");
    const register = qs("[data-register-form]");
    login.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const result = await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify(formValues(login))
        });
        toast("Login successful.");
        window.location.href = dashboardPath(result.user);
      } catch (error) {
        toast(error.message, "error");
      }
    });

    register.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const result = await api("/api/auth/register", {
          method: "POST",
          body: JSON.stringify(formValues(register))
        });
        toast("Account created.");
        window.location.href = dashboardPath(result.user);
      } catch (error) {
        toast(error.message, "error");
      }
    });
  }

  async function redirectIfLoggedIn() {
    try {
      const result = await api("/api/auth/me");
      if (result.user) {
        window.location.href = dashboardPath(result.user);
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  async function init() {
    setupTabs();
    setupForms();
    await redirectIfLoggedIn();
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", AuthApp.init);
