/**
 * FloridaProbationLaw.com — navigation behaviour.
 *
 * Progressive enhancement only. Without this file every page still works:
 * the mobile submenus are native <details>, every section link resolves, and
 * the footer plus /sitemap/ reach every route. This script adds the mobile
 * panel toggle and the desktop dropdowns on top of that.
 */
(function () {
  "use strict";

  var menuButton = document.getElementById("menu-button");
  var mobileNav = document.getElementById("mobile-nav");
  var toggles = Array.prototype.slice.call(document.querySelectorAll(".nav-toggle"));

  /* ---- mobile panel ----------------------------------------------------- */

  // Everything outside the header is made inert while the panel is open, so
  // Tab cannot wander into content hidden behind it.
  var backdrop = document.querySelectorAll("main, .site-footer, .call-bar");

  function setMobile(open) {
    if (!menuButton || !mobileNav) return;
    menuButton.setAttribute("aria-expanded", String(open));
    mobileNav.classList.toggle("is-open", open);
    document.body.classList.toggle("nav-open", open);

    if ("inert" in HTMLElement.prototype) {
      Array.prototype.forEach.call(backdrop, function (el) {
        el.inert = open;
      });
    }
  }

  if (menuButton && mobileNav) {
    menuButton.addEventListener("click", function () {
      setMobile(menuButton.getAttribute("aria-expanded") !== "true");
    });
  }

  /* ---- desktop dropdowns ------------------------------------------------ */

  function setMenu(btn, open) {
    var menu = document.getElementById(btn.getAttribute("aria-controls"));
    if (!menu) return;
    btn.setAttribute("aria-expanded", String(open));
    menu.hidden = !open;
  }

  function closeAll(except) {
    toggles.forEach(function (btn) {
      if (btn !== except) setMenu(btn, false);
    });
  }

  function openToggle() {
    for (var i = 0; i < toggles.length; i++) {
      if (toggles[i].getAttribute("aria-expanded") === "true") return toggles[i];
    }
    return null;
  }

  toggles.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var isOpen = btn.getAttribute("aria-expanded") === "true";
      closeAll(btn);
      setMenu(btn, !isOpen);
    });
  });

  // Hover-to-open, but only where there is a real pointer. A touch device
  // reporting hover would otherwise open a menu on the tap that was meant to
  // follow the link.
  var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

  toggles.forEach(function (btn) {
    var item = btn.closest(".nav-item");
    if (!item) return;
    var timer;

    item.addEventListener("mouseenter", function () {
      if (!finePointer.matches) return;
      clearTimeout(timer);
      closeAll(btn);
      setMenu(btn, true);
    });

    item.addEventListener("mouseleave", function () {
      if (!finePointer.matches) return;
      // Small delay so a diagonal move toward the menu does not close it.
      timer = setTimeout(function () {
        if (!item.contains(document.activeElement)) setMenu(btn, false);
      }, 150);
    });
  });

  // Tabbing out of a menu closes it.
  document.addEventListener("focusin", function (event) {
    toggles.forEach(function (btn) {
      var item = btn.closest(".nav-item");
      if (item && !item.contains(event.target)) setMenu(btn, false);
    });
  });

  document.addEventListener("click", function (event) {
    if (!event.target.closest || !event.target.closest(".nav-item")) closeAll();
  });

  /* ---- escape ----------------------------------------------------------- */

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;

    var open = openToggle();
    if (open) {
      setMenu(open, false);
      open.focus();
      return;
    }

    if (menuButton && menuButton.getAttribute("aria-expanded") === "true") {
      setMobile(false);
      menuButton.focus();
    }
  });

  /* ---- breakpoint reset -------------------------------------------------- */

  var desktop = window.matchMedia("(min-width: 1024px)");
  var onBreakpoint = function (event) {
    if (event.matches) setMobile(false);
    else closeAll();
  };

  if (desktop.addEventListener) desktop.addEventListener("change", onBreakpoint);
  else if (desktop.addListener) desktop.addListener(onBreakpoint);

  /* ======================================================================
     Form validation
     Enhancement over native validation, not a replacement for it: the form
     still works with this file absent, and every rule here must also be
     enforced server-side once an endpoint exists. Client-side checks stop
     honest mistakes; they stop nothing else.
     ====================================================================== */

  Array.prototype.forEach.call(document.querySelectorAll("[data-validate]"), function (form) {
    var summary = form.querySelector(".form-errors");
    var summaryList = summary && summary.querySelector("ul");
    var startedAt = Date.now();

    function fieldLabel(field) {
      var label = form.querySelector('label[for="' + field.id + '"]');
      if (!label) return field.name || "This field";
      return label.textContent.replace(/\*/g, "").replace(/\(optional\)/i, "").trim();
    }

    function messageFor(field) {
      if (field.validity.valueMissing) {
        return field.type === "checkbox"
          ? fieldLabel(field) + " — please confirm to continue"
          : fieldLabel(field) + " is required";
      }
      if (field.validity.typeMismatch && field.type === "email") {
        return "Enter an email address in the form name@example.com";
      }
      if (field.validity.tooShort) {
        return fieldLabel(field) + " is too short";
      }
      return fieldLabel(field) + " is not valid";
    }

    function clearError(field) {
      field.removeAttribute("aria-invalid");
      var note = document.getElementById(field.id + "-error");
      if (note) note.textContent = "";
    }

    function showError(field, message) {
      field.setAttribute("aria-invalid", "true");
      var note = document.getElementById(field.id + "-error");
      if (note) note.textContent = message;
    }

    // Clear a field's error as soon as it becomes valid, so the form stops
    // shouting at someone who has already fixed the problem.
    form.addEventListener(
      "input",
      function (event) {
        var field = event.target;
        if (field.checkValidity && field.checkValidity()) clearError(field);
      },
      true
    );

    form.addEventListener("submit", function (event) {
      var fields = Array.prototype.slice.call(
        form.querySelectorAll("input, select, textarea")
      );
      var failed = [];

      fields.forEach(function (field) {
        if (field.type === "hidden" || field.disabled || !field.willValidate) return;
        if (field.checkValidity()) {
          clearError(field);
        } else {
          var message = messageFor(field);
          showError(field, message);
          failed.push({ field: field, message: message });
        }
      });

      // Validation feedback comes first, unconditionally. An earlier version
      // ran the spam checks before this and returned, which meant anyone who
      // filled the form quickly — or used autofill — pressed submit and saw
      // nothing happen at all.
      if (failed.length) {
        event.preventDefault();
      }

      // Spam preparation. A bot that POSTs directly never runs this file, so
      // blocking client-side on elapsed time only ever penalises fast humans.
      // The time is recorded for the server to weigh instead; the honeypot is
      // also re-checked server-side. Neither replaces server-side filtering.
      var elapsed = form.querySelector("[data-elapsed]");
      if (elapsed) elapsed.value = String(Date.now() - startedAt);

      var honeypot = form.querySelector("[data-honeypot]");
      if (honeypot && honeypot.value) {
        event.preventDefault();
        return;
      }

      if (!failed.length) return;

      if (summary && summaryList) {
        summaryList.innerHTML = "";
        failed.forEach(function (item) {
          var li = document.createElement("li");
          var link = document.createElement("a");
          link.href = "#" + item.field.id;
          link.textContent = item.message;
          link.addEventListener("click", function (e) {
            e.preventDefault();
            item.field.focus();
          });
          li.appendChild(link);
          summaryList.appendChild(li);
        });
        summary.hidden = false;
        summary.setAttribute("tabindex", "-1");
        summary.focus();
      } else {
        failed[0].field.focus();
      }
    });
  });
})();
