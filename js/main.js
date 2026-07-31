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
})();
