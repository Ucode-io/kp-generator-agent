import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { validateAppPrototypeSpec } from "./kp_app_prototype_planner.mjs";

export const APP_PROTOTYPE_QA_VERSION = "app-prototype-qa-v2";

export async function runAppPrototypeQa({ spec, htmlPath, outputPath = null } = {}) {
  const findings = [];
  let contractQa = null;
  try {
    contractQa = await validateAppPrototypeSpec(spec);
  } catch (error) {
    contractQa = error.qa || { status: "FAIL", findings: [{ code: error.code || "APP_PROTOTYPE_SPEC_INVALID", severity: "BLOCKER", message: error.message }] };
    findings.push(...contractQa.findings);
  }

  const html = await fs.readFile(htmlPath, "utf8");
  const browser = await launchChromium({ headless: true });
  const consoleErrors = [];
  const pageErrors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1365, height: 768 }, deviceScaleFactor: 1 });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(String(error.message || error)));
    await page.setContent(html, { waitUntil: "load" });
    await page.waitForTimeout(100);

    const dom = await page.evaluate(() => {
      const screens = [...document.querySelectorAll("[data-screen]")];
      const navLinks = [...document.querySelectorAll("[data-screen-link]")];
      const active = document.querySelector(".screen.is-active");
      const phone = document.querySelector(".phone");
      const app = document.querySelector(".mobile-app");
      const bodyOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const phoneRect = phone?.getBoundingClientRect();
      const appRect = app?.getBoundingClientRect();
      const bottomNav = [...document.querySelectorAll(".bottom-nav a")];
      const primaryButton = document.querySelector(".ui-button.primary");
      const primaryStyle = primaryButton ? getComputedStyle(primaryButton) : null;
      const actionRow = document.querySelector(".action-row");
      const actionStyle = actionRow ? getComputedStyle(actionRow) : null;
      function structuralSignature(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return "";
        const tag = node.tagName.toLowerCase();
        const cls = [...node.classList].filter((name) => !/^is-active$|^active$|^selected$|^on$|^done$|^pending$|^warning$/.test(name)).sort().join(".");
        const attrs = ["role", "type", "data-layout"].map((attr) => node.getAttribute(attr) ? `${attr}=${node.getAttribute(attr)}` : "").filter(Boolean).join(",");
        const children = [...node.children].map((child) => structuralSignature(child)).join("");
        return `<${tag}${cls ? "." + cls : ""}${attrs ? "[" + attrs + "]" : ""}>${children}</${tag}>`;
      }
      const screenContentSignatures = screens.map((screen) => {
        const content = screen.querySelector(".screen-scroll")?.cloneNode(true);
        content?.querySelector(".action-row")?.remove();
        return String(content?.textContent || "").replace(/\s+/g, " ").trim();
      });
      const structuralSignatures = screens.map((screen) => structuralSignature(screen.querySelector(".screen-scroll")));
      const structuralCounts = structuralSignatures.reduce((map, signature) => map.set(signature, (map.get(signature) || 0) + 1), new Map());
      const genericTexts = ["Название", "Статус", "Далее", "Description", "Status", "Next"];
      return {
        screenCount: screens.length,
        navLinkCount: navLinks.length,
        activeId: active?.dataset.screen || "",
        title: document.getElementById("screen-title")?.textContent || "",
        description: document.getElementById("screen-description")?.textContent || "",
        bodyOverflow,
        phoneRect: phoneRect ? { width: phoneRect.width, height: phoneRect.height, top: phoneRect.top, bottom: phoneRect.bottom } : null,
        appRect: appRect ? { width: appRect.width, height: appRect.height } : null,
        bottomNavCount: bottomNav.length,
        bottomNavSvgCount: bottomNav.filter((node) => node.querySelector("svg")).length,
        primaryButtonHeight: Number.parseFloat(primaryStyle?.height || "0"),
        primaryButtonRadius: primaryStyle?.borderRadius || "",
        primaryButtonBackground: primaryStyle?.backgroundImage || "",
        actionPosition: actionStyle?.position || "",
        targetIds: [...document.querySelectorAll("[data-action-target]")].map((node) => node.dataset.actionTarget).filter(Boolean),
        localPaths: /(?:file:\/\/|\/Users\/|\/home\/|\/tmp\/|[A-Z]:\\)/.test(document.documentElement.outerHTML),
        uniqueScreenContentCount: new Set(screenContentSignatures).size,
        uniqueStructuralCount: new Set(structuralSignatures).size,
        maxStructuralTemplateUse: Math.max(0, ...structuralCounts.values()),
        readonlyFieldCount: [...document.querySelectorAll(".screen form input[readonly],.screen form textarea[readonly],.screen form select[readonly]")].length,
        genericPrimaryContentCount: screens.filter((screen) => {
          const rows = [...screen.querySelectorAll(".list-row strong,.entity-row strong,.form-card label")].slice(0, 3).map((node) => node.textContent.trim());
          return rows.length >= 3 && rows.every((text) => genericTexts.includes(text));
        }).length,
        interactiveControlCount: [...document.querySelectorAll("[data-action-id],[data-tab-id],[data-toggle-id],[data-row-action],[data-menu-id],[data-search-clear],[data-demo-state]")].length,
        disabledWithoutReasonCount: [...document.querySelectorAll("button:disabled")].filter((node) => !node.title && !node.getAttribute("aria-describedby")).length,
      };
    });

    if (dom.screenCount !== spec.screens.length) add(findings, "APP_PROTOTYPE_DOM_SCREEN_COUNT_MISMATCH", "BLOCKER", `Expected ${spec.screens.length} screens, rendered ${dom.screenCount}.`);
    const expectedNavLinks = (spec.navigation || []).reduce((sum, group) => sum + (group.screenIds || []).length, 0);
    if (dom.navLinkCount < expectedNavLinks) add(findings, "APP_PROTOTYPE_DOM_NAVIGATION_INCOMPLETE", "BLOCKER", "Sidebar or bottom navigation misses screen links.");
    if (dom.activeId !== spec.screens[0]?.id) add(findings, "APP_PROTOTYPE_DOM_START_SCREEN_INVALID", "BLOCKER", "Start screen is not active after load.");
    if (!dom.title || !dom.description) add(findings, "APP_PROTOTYPE_DOM_HEADER_MISSING", "ERROR", "Selected screen title or description is not rendered.");
    if (dom.bodyOverflow > 2) add(findings, "APP_PROTOTYPE_HORIZONTAL_OVERFLOW", "ERROR", `Document horizontally overflows by ${dom.bodyOverflow}px.`);
    if (!dom.phoneRect || dom.phoneRect.width < 300 || dom.phoneRect.height < 540) add(findings, "APP_PROTOTYPE_PHONE_FRAME_INVALID", "BLOCKER", "Phone frame is missing or too small.");
    if (dom.appRect && dom.phoneRect && dom.appRect.width > dom.phoneRect.width) add(findings, "APP_PROTOTYPE_MOBILE_VIEWPORT_ESCAPED", "BLOCKER", "Mobile viewport exceeds the phone frame.");
    if (dom.bottomNavCount !== 5) add(findings, "APP_PROTOTYPE_BOTTOM_NAV_COUNT_INVALID", "ERROR", `Expected 5 bottom navigation actions, rendered ${dom.bottomNavCount}.`);
    if (dom.bottomNavSvgCount !== dom.bottomNavCount) add(findings, "APP_PROTOTYPE_BOTTOM_NAV_ICONS_INVALID", "ERROR", "Bottom navigation must use a consistent SVG icon set.");
    if (Math.abs(dom.primaryButtonHeight - 52) > 1 || dom.primaryButtonRadius !== "14px") add(findings, "APP_PROTOTYPE_PRIMARY_BUTTON_GEOMETRY_INVALID", "ERROR", `Primary button geometry is ${dom.primaryButtonHeight}px / ${dom.primaryButtonRadius}.`);
    if (!/linear-gradient/i.test(dom.primaryButtonBackground)) add(findings, "APP_PROTOTYPE_PRIMARY_BUTTON_STYLE_INVALID", "ERROR", "Primary button gradient is missing.");
    if (dom.actionPosition === "sticky" || dom.actionPosition === "fixed") add(findings, "APP_PROTOTYPE_ACTION_OVERLAPS_CONTENT", "ERROR", `Action row uses ${dom.actionPosition} positioning.`);
    if (dom.localPaths) add(findings, "APP_PROTOTYPE_LOCAL_PATH_LEAK", "BLOCKER", "HTML contains a local filesystem path.");
    if (dom.readonlyFieldCount > 0) add(findings, "APP_PROTOTYPE_FORM_NOT_EDITABLE", "BLOCKER", `${dom.readonlyFieldCount} form fields are readonly.`);
    if (dom.genericPrimaryContentCount > 0) add(findings, "APP_PROTOTYPE_GENERIC_PRIMARY_CONTENT", "BLOCKER", `${dom.genericPrimaryContentCount} screens render generic primary rows.`);
    if (dom.disabledWithoutReasonCount > 0) add(findings, "APP_PROTOTYPE_DISABLED_CONTROL_WITHOUT_REASON", "ERROR", `${dom.disabledWithoutReasonCount} disabled controls lack an explanation.`);
    if (dom.uniqueScreenContentCount / Math.max(1, dom.screenCount) < 0.8) {
      add(findings, "APP_PROTOTYPE_DOM_SCREEN_CONTENT_REPETITIVE", "BLOCKER", `Only ${dom.uniqueScreenContentCount} of ${dom.screenCount} rendered screens have distinct content.`);
    }
    if (dom.screenCount >= 8 && dom.maxStructuralTemplateUse / Math.max(1, dom.screenCount) > 0.45) {
      add(findings, "APP_PROTOTYPE_STRUCTURAL_REPETITION", "BLOCKER", `One structural template is reused by ${dom.maxStructuralTemplateUse} of ${dom.screenCount} screens.`);
    }
    if (dom.interactiveControlCount < dom.screenCount) add(findings, "APP_PROTOTYPE_INTERACTION_COVERAGE_LOW", "ERROR", "Rendered prototype has fewer interactive controls than screens.");
    const screenSet = new Set((spec.screens || []).map((screen) => screen.id));
    for (const target of dom.targetIds) {
      if (!screenSet.has(target)) add(findings, "APP_PROTOTYPE_ACTION_TARGET_MISSING", "BLOCKER", `Rendered action references missing screen: ${target}`);
    }
    for (const screen of (spec.screens || [])) {
      for (const action of screen.actions || []) {
        for (const target of actionTargets(action)) {
          if (!screenSet.has(target)) add(findings, "APP_PROTOTYPE_ACTION_TARGET_MISSING", "BLOCKER", `Spec action ${screen.id}/${action.id} references missing screen: ${target}`);
        }
      }
    }

    for (const screen of (spec.screens || [])) {
      await page.click(`[data-screen-link="${cssString(screen.id)}"]`);
      const activeId = await page.locator(".screen.is-active").getAttribute("data-screen");
      const title = await page.locator("#screen-title").textContent();
      if (activeId !== screen.id || title !== screen.title) {
        add(findings, "APP_PROTOTYPE_NAVIGATION_FAILED", "BLOCKER", `Navigation failed for screen: ${screen.id}`);
      }
    }

    const noEffect = await crawlInteractions(page, spec);
    for (const row of noEffect) {
      add(findings, "APP_PROTOTYPE_INTERACTION_NO_EFFECT", "BLOCKER", `No observable effect for ${row.screenId}: ${row.label}`);
    }
  } finally {
    await browser.close();
  }

  for (const message of consoleErrors) add(findings, "APP_PROTOTYPE_CONSOLE_ERROR", "ERROR", message);
  for (const message of pageErrors) add(findings, "APP_PROTOTYPE_PAGE_ERROR", "BLOCKER", message);

  const report = {
    schemaVersion: "1.0",
    status: findings.some((finding) => finding.severity === "BLOCKER") ? "FAIL" : findings.length ? "WARN" : "PASS",
    checkedAt: new Date().toISOString(),
    contractStatus: contractQa?.status || "FAIL",
    screenCount: spec.screens?.length || 0,
    htmlPath,
    findings,
  };
  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (report.status === "FAIL") {
    const error = new Error(`APP_PROTOTYPE_DOM_QA_FAILED: ${findings.map((finding) => finding.message).join("; ")}`);
    error.code = "APP_PROTOTYPE_DOM_QA_FAILED";
    error.report = report;
    throw error;
  }
  return report;
}

async function launchChromium(options = {}) {
  const configuredPath = String(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "").trim();
  if (configuredPath) return chromium.launch({ ...options, executablePath: configuredPath });
  try {
    return await chromium.launch(options);
  } catch (originalError) {
    const candidates = process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
      : process.platform === "linux"
        ? ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
        : [];
    for (const executablePath of candidates) {
      if (await fs.access(executablePath).then(() => true, () => false)) return chromium.launch({ ...options, executablePath });
    }
    throw originalError;
  }
}

function add(findings, code, severity, message) {
  findings.push({ code, severity, message });
}

function cssString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function actionTargets(action = {}) {
  return [
    action.targetScreenId,
    ...(action.outcomes || []).map((outcome) => outcome.targetScreenId),
  ].filter(Boolean);
}

async function crawlInteractions(page, spec) {
  const failures = [];
  const selector = [
    "[data-action-id]:not(:disabled)",
    "[data-tab-id]:not(:disabled)",
    "[data-toggle-id]:not(:disabled)",
    "[data-row-action]:not(:disabled)",
    "[data-menu-id]:not(:disabled)",
    "[data-search-clear]:not(:disabled)",
    "[data-demo-state]:not(:disabled)",
  ].map((part) => `.screen.is-active ${part}`).join(",");
  for (const screen of spec.screens || []) {
    await page.click(`[data-screen-link="${cssString(screen.id)}"]`);
    await page.waitForTimeout(20);
    const count = await page.locator(selector).count();
    for (let index = 0; index < count; index += 1) {
      await page.click(`[data-screen-link="${cssString(screen.id)}"]`);
      await page.waitForTimeout(20);
      const control = page.locator(selector).nth(index);
      if (!(await control.count())) continue;
      const label = await control.evaluate((node) => node.getAttribute("aria-label") || node.textContent.trim().replace(/\s+/g, " ").slice(0, 80));
      const before = await observableState(page);
      try {
        await control.click({ timeout: 1500 });
      } catch {
        failures.push({ screenId: screen.id, label: label || `control ${index + 1}` });
        continue;
      }
      await page.waitForTimeout(60);
      const after = await observableState(page);
      if (before === after) failures.push({ screenId: screen.id, label: label || `control ${index + 1}` });
      await page.keyboard.press("Escape").catch(() => {});
    }
  }
  return failures;
}

async function observableState(page) {
  return page.evaluate(() => JSON.stringify({
    active: document.querySelector(".screen.is-active")?.dataset.screen || "",
    hash: location.hash,
    overlayHidden: document.querySelector("[data-overlay-root]")?.hidden ?? true,
    overlayText: document.querySelector("[data-overlay-root]")?.textContent.trim().replace(/\s+/g, " ").slice(0, 140) || "",
    toastHidden: document.querySelector("[data-demo-toast]")?.hidden ?? true,
    toastText: document.querySelector("[data-demo-toast]")?.textContent || "",
    tabs: [...document.querySelectorAll(".screen.is-active [data-tab-id]")].map((node) => [node.dataset.tabId, node.getAttribute("aria-selected"), node.className]),
    tabPanel: document.querySelector(".screen.is-active [data-tab-panel]")?.textContent || "",
    toggles: [...document.querySelectorAll(".screen.is-active [data-toggle-id]")].map((node) => [node.dataset.toggleId, node.getAttribute("aria-pressed"), node.className]),
    selected: [...document.querySelectorAll(".screen.is-active [data-select-id]")].map((node) => [node.dataset.selectId, node.className, node.getAttribute("aria-pressed")]),
    inputs: [...document.querySelectorAll(".screen.is-active input,.screen.is-active textarea,.screen.is-active select")].map((node) => [node.name, node.value, node.getAttribute("aria-invalid")]),
    hiddenRows: [...document.querySelectorAll(".screen.is-active [data-row-action]")].map((node) => node.hidden),
    validation: [...document.querySelectorAll(".screen.is-active [data-field-error]")].map((node) => node.textContent),
    events: window.__prototypeEvents?.length || 0,
  }));
}
