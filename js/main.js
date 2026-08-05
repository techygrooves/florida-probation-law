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

    /* The error text lives in a live region, so it is announced as it appears.
       That covers the moment of failure but not afterwards: a field reached
       later — by Tab, or from the error summary — describes itself from
       aria-describedby, so the message has to be referenced there too. Any
       existing hint id is kept; the error is appended and removed around it. */
    function describedBy(field, errorId, present) {
      var ids = (field.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .filter(function (id) {
          return id && id !== errorId;
        });
      if (present) ids.push(errorId);
      if (ids.length) field.setAttribute("aria-describedby", ids.join(" "));
      else field.removeAttribute("aria-describedby");
    }

    function clearError(field) {
      field.removeAttribute("aria-invalid");
      var note = document.getElementById(field.id + "-error");
      if (note) {
        note.textContent = "";
        describedBy(field, note.id, false);
      }
    }

    function showError(field, message) {
      field.setAttribute("aria-invalid", "true");
      var note = document.getElementById(field.id + "-error");
      if (note) {
        note.textContent = message;
        describedBy(field, note.id, true);
      }
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
      // named _gotcha, which the form service filters on. Neither of these is
      // a substitute for server-side filtering.
      var elapsed = form.querySelector("[data-elapsed]");
      if (elapsed) elapsed.value = String(Date.now() - startedAt);

      // The post-submit redirect is built at build time as the production URL,
      // which is right on the live domain and wrong anywhere else — a test
      // submission from a preview deploy would bounce the visitor to a domain
      // that may not resolve. Point it at the origin actually being browsed.
      // With this script absent the build-time production URL stands, which is
      // the correct fallback.
      var redirect = form.querySelector("[data-redirect-path]");
      if (redirect) {
        var path = redirect.getAttribute("data-redirect-path");
        var base = redirect.getAttribute("data-redirect-base") || "";
        redirect.value = window.location.origin + base + path;
      }

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

  /* ======================================================================
     Analytics events

     Page views are handled by the GA4 tag in the head; this adds the things
     the tag cannot see on its own — which button was pressed, from where, and
     whether a form submission actually went through.

     Two rules govern everything below.

     First, nothing here is required for the site to work. `track` returns
     immediately when gtag is missing, so a blocked tag, an ad blocker, a
     cleared measurement ID or a slow network all degrade to silence rather
     than to a broken page.

     Second, and more important on an attorney intake form: no event carries
     anything a visitor typed. Field *names* are sent — knowing that people
     stumble on "county of sentencing" is useful — but never field values, and
     never a name, phone number, email address or case detail. Sending
     personal information to Analytics breaches Google's terms, and here it
     would also put prospective-client information somewhere it has no
     business being.
     ====================================================================== */

  function track(name, params) {
    if (typeof window.gtag !== "function") return;
    try {
      window.gtag("event", name, params || {});
    } catch (error) {
      /* Analytics must never break a page. */
    }
  }

  /** Where on the page a control lives, so the same CTA can be compared by position. */
  function placementOf(el) {
    if (el.closest(".call-bar")) return "sticky_call_bar";
    if (el.closest(".mobile-nav")) return "mobile_nav";
    if (el.closest(".site-header")) return "header";
    if (el.closest(".site-footer")) return "footer";
    if (el.closest(".section-navy")) return "cta_band";
    return "page_body";
  }

  var label = function (el) {
    return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100);
  };

  /* ---- clicks -------------------------------------------------------------
   * Delegated from the document, so controls inside generated regions — the
   * header phone link, the sticky call bar, the shared CTA — are covered
   * without each one carrying its own hook.
   * ---------------------------------------------------------------------- */

  // Routes that represent an intent to make contact rather than to read on.
  var CONVERSION_PATHS = [
    "/contact/",
    "/probation-eligibility-assessment/",
    "/early-termination-of-probation/eligibility/",
  ];

  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest("a[href]");
    if (!link) return;

    var href = link.getAttribute("href") || "";

    // The "Call 24/7" header link, the sticky mobile call bar, and every other
    // number on the site. On mobile this is the highest-value action there is.
    if (href.indexOf("tel:") === 0) {
      track("phone_click", {
        link_placement: placementOf(link),
        link_text: label(link),
        page_path: window.location.pathname,
      });
      return;
    }

    if (href.indexOf("mailto:") === 0) {
      track("email_click", {
        link_placement: placementOf(link),
        page_path: window.location.pathname,
      });
      return;
    }

    // "Request a Free Consultation" and the other contact CTAs, wherever they
    // appear. Matched on destination rather than on button text, so a reworded
    // button keeps reporting against the same event.
    var isConversion = CONVERSION_PATHS.some(function (path) {
      return href === path || href.slice(-path.length) === path;
    });
    if (isConversion && link.className.indexOf("btn") !== -1) {
      track("cta_click", {
        link_placement: placementOf(link),
        link_text: label(link),
        link_url: href,
        page_path: window.location.pathname,
      });
    }
  });

  /* ---- FAQ engagement ------------------------------------------------------
   * Which questions people actually open is the most useful thing this site
   * can learn about what visitors do not understand — it says what to write
   * next. The question text is site copy, not anything a visitor typed.
   * ---------------------------------------------------------------------- */

  Array.prototype.forEach.call(document.querySelectorAll("details.faq-item"), function (item) {
    item.addEventListener("toggle", function () {
      if (!item.open) return;
      var question = item.querySelector("summary");
      track("faq_open", {
        faq_question: question ? label(question).slice(0, 100) : "",
        page_path: window.location.pathname,
      });
    });
  });

  /* ---- forms ---------------------------------------------------------------
   * Three signals, and the gap between them is the point: how many people
   * begin a form, how many are turned back by validation and where, and how
   * many actually submit. A drop between the first and the last is a problem
   * with the form, not with demand.
   * ---------------------------------------------------------------------- */

  Array.prototype.forEach.call(document.querySelectorAll("[data-validate]"), function (form) {
    var formName = form.getAttribute("data-form-name") || "form";
    var started = false;

    form.addEventListener(
      "focusin",
      function () {
        if (started) return;
        started = true;
        track("form_start", { form_name: formName, page_path: window.location.pathname });
      },
      true
    );

    /* Runs after the validation handler registered above, so defaultPrevented
       is already settled and tells us which of the two outcomes happened. */
    form.addEventListener("submit", function (event) {
      var invalid = form.querySelectorAll('[aria-invalid="true"]');

      if (event.defaultPrevented) {
        track("form_error", {
          form_name: formName,
          error_count: invalid.length,
          // The field's name attribute, never its value.
          first_error_field: invalid.length ? invalid[0].name || "" : "",
          page_path: window.location.pathname,
        });
        return;
      }

      // GA4's recommended event for an enquiry, so it reports as a conversion
      // without custom configuration. Sent as the browser leaves for the form
      // endpoint; gtag uses sendBeacon, which survives the navigation.
      track("generate_lead", {
        form_name: formName,
        page_path: window.location.pathname,
      });
    });
  });
})();
