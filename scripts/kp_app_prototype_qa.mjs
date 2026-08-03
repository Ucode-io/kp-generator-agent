import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { validateAppPrototypeSpec } from "./kp_app_prototype_planner.mjs";

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
      const screenContentSignatures = screens.map((screen) => {
        const content = screen.querySelector(".screen-scroll")?.cloneNode(true);
        content?.querySelector(".action-row")?.remove();
        return String(content?.textContent || "").replace(/\s+/g, " ").trim();
      });
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
        targetIds: [...document.querySelectorAll("[data-action-target]")].map((node) => node.dataset.actionTarget),
        localPaths: /(?:file:\/\/|\/Users\/|\/home\/|\/tmp\/|[A-Z]:\\)/.test(document.documentElement.outerHTML),
        uniqueScreenContentCount: new Set(screenContentSignatures).size,
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
    if (dom.uniqueScreenContentCount / Math.max(1, dom.screenCount) < 0.8) {
      add(findings, "APP_PROTOTYPE_DOM_SCREEN_CONTENT_REPETITIVE", "BLOCKER", `Only ${dom.uniqueScreenContentCount} of ${dom.screenCount} rendered screens have distinct content.`);
    }
    const screenSet = new Set((spec.screens || []).map((screen) => screen.id));
    for (const target of dom.targetIds) {
      if (!screenSet.has(target)) add(findings, "APP_PROTOTYPE_ACTION_TARGET_MISSING", "BLOCKER", `Rendered action references missing screen: ${target}`);
    }

    for (const screen of (spec.screens || [])) {
      await page.click(`[data-screen-link="${cssString(screen.id)}"]`);
      const activeId = await page.locator(".screen.is-active").getAttribute("data-screen");
      const title = await page.locator("#screen-title").textContent();
      if (activeId !== screen.id || title !== screen.title) {
        add(findings, "APP_PROTOTYPE_NAVIGATION_FAILED", "BLOCKER", `Navigation failed for screen: ${screen.id}`);
      }
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
