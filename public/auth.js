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
    const forgotForm = qs("[data-forgot-form]");
    if (forgotForm) {
      forgotForm.hidden = name !== "forgot";
    }
    const otpForm = qs("[data-otp-form]");
    if (otpForm) {
      otpForm.hidden = true;
    }
    const resetForm = qs("[data-reset-form]");
    if (resetForm) {
      resetForm.hidden = true;
    }
  }

  function formValues(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function dashboardPath(user) {
    return user && user.role === "admin" ? "/owner-dashboard.html" : "/customer-dashboard.html";
  }

  function returnToPath(user) {
    const params = new URLSearchParams(window.location.search);
    const returnTo = params.get("returnTo");
    if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") && user && user.role !== "admin") {
      return returnTo;
    }
    return dashboardPath(user);
  }

  function setupTabs() {
    qsa("[data-auth-tab]").forEach((button) => {
      button.addEventListener("click", () => showTab(button.dataset.authTab));
    });
  }

  function setupForms() {
    const login = qs("[data-login-form]");
    const register = qs("[data-register-form]");
    const otpForm = qs("[data-otp-form]");
    const forgotForm = qs("[data-forgot-form]");
    const resetForm = qs("[data-reset-form]");
    const otpHelp = qs("[data-otp-help]");
    const resetHelp = qs("[data-reset-help]");
    login.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const result = await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify(formValues(login))
        });
        toast("Login successful.");
        window.location.href = returnToPath(result.user);
      } catch (error) {
        toast(error.message, "error");
      }
    });

    register.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const result = await api("/api/auth/request-otp", {
          method: "POST",
          body: JSON.stringify(formValues(register))
        });
        register.hidden = true;
        otpForm.hidden = false;
        otpForm.elements.challengeId.value = result.challengeId;
        otpForm.elements.otp.value = "";
        otpHelp.textContent = result.message + (result.demoOtp ? " Demo OTP: " + result.demoOtp : "");
        toast(result.otpSent ? "OTP sent to your mobile." : "Use the demo OTP shown.");
        otpForm.elements.otp.focus();
      } catch (error) {
        toast(error.message, "error");
      }
    });

    otpForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const result = await api("/api/auth/verify-otp", {
          method: "POST",
          body: JSON.stringify(formValues(otpForm))
        });
        toast("Mobile verified. Account created.");
        window.location.href = returnToPath(result.user);
      } catch (error) {
        toast(error.message, "error");
      }
    });

    if (forgotForm && resetForm) {
      forgotForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          const payload = formValues(forgotForm);
          const result = await api("/api/auth/request-password-reset", {
            method: "POST",
            body: JSON.stringify(payload)
          });
          forgotForm.hidden = true;
          resetForm.hidden = false;
          resetForm.elements.challengeId.value = result.challengeId;
          resetForm.elements.otp.value = "";
          resetForm.dataset.password = payload.password;
          resetHelp.textContent = result.message + (result.demoOtp ? " Demo OTP: " + result.demoOtp : "");
          toast(result.otpSent ? "OTP sent to your mobile." : "Use the demo OTP shown.");
          resetForm.elements.otp.focus();
        } catch (error) {
          toast(error.message, "error");
        }
      });

      resetForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          const payload = formValues(resetForm);
          payload.password = resetForm.dataset.password || "";
          const result = await api("/api/auth/reset-password", {
            method: "POST",
            body: JSON.stringify(payload)
          });
          toast("Password reset successful.");
          window.location.href = returnToPath(result.user);
        } catch (error) {
          toast(error.message, "error");
        }
      });
    }
  }

  async function redirectIfLoggedIn() {
    try {
      const result = await api("/api/auth/me");
      if (result.user) {
        window.location.href = returnToPath(result.user);
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
