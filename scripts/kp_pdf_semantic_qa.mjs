export async function inspectRenderedProposalDomV5(page, presentationPlan) {
  await page.waitForFunction(async () => {
    if (window.__KP_RENDER_READY__?.then) return window.__KP_RENDER_READY__;
    return window.__KP_RENDER_READY__ === true;
  }, null, { timeout: 5000 });
  return page.evaluate((plan) => {
    const pages = [...document.querySelectorAll(".kp-page")];
    const findings = [];
    findings.push(...inspectUnsafeMarkup());
    const visibleText = document.body?.innerText || "";
    if (/\/Users\/|telegram:\/\/|file:\/\//i.test(visibleText)) findings.push({ code: "DOM_INTERNAL_IDENTIFIER_VISIBLE", severity: "BLOCKER" });
    findings.push(...inspectInternalRendererLabels(pages));
    const clientLanguage = inspectClientLanguage(visibleText);
    findings.push(...clientLanguage.findings);
    const clientContentPolicy = inspectClientContentPolicy(pages, plan, clientLanguage.metrics);
    findings.push(...clientContentPolicy.findings);
    const uiHardcheck = inspectPageUiContract(pages, plan);
    findings.push(...uiHardcheck.findings);
    findings.push(...inspectTeamCapacityReconciliation(pages));
    const expectedPageCount = Number(plan?.pageCount || plan?.pages?.length || 0);
    if (expectedPageCount && pages.length !== expectedPageCount) findings.push({ code: "DOM_PAGE_COUNT_MISMATCH", severity: "BLOCKER", evidence: { pageCount: pages.length, expectedPageCount } });
    for (const planned of plan.pages || []) {
      const page = pages.find((item) => Number(item.dataset.pageNumber) === planned.pageNumber);
      if (!page) findings.push({ code: "DOM_STRUCTURE_MISSING", severity: "BLOCKER", page: planned.pageNumber });
      const pageText = page?.innerText?.replace(/\s+/g, " ").trim() || "";
      const headingText = page?.querySelector("h1,h2,h3,.page-title,.slide-title")?.innerText?.replace(/\s+/g, " ").trim() || "";
      if (page && pageText.length < 24) findings.push({ code: "DOM_PAGE_TEXT_TOO_LOW", severity: "ERROR", page: planned.pageNumber, evidence: { textLength: pageText.length } });
      if (page && !headingText && !planned.visualizationSpecId) findings.push({ code: "DOM_PAGE_TITLE_MISSING", severity: "ERROR", page: planned.pageNumber });
      if (planned.visualizationSpecId) {
        const viz = page?.querySelector(".viz-canvas");
        if (!viz) findings.push({ code: "DOM_STRUCTURE_MISSING", severity: "BLOCKER", page: planned.pageNumber, visualizationId: planned.visualizationSpecId });
        const nodes = viz ? [...viz.querySelectorAll("[data-node-id]")] : [];
        const edges = viz ? [...viz.querySelectorAll('[data-geometry-role="edge"][data-edge-id]')] : [];
        const bpmnEdgeLabels = viz ? [...viz.querySelectorAll(".viz-bpmn-edge-label[data-edge-id]")] : [];
        const bpmnLaneLabels = viz ? [...viz.querySelectorAll(".viz-bpmn-lane-label")] : [];
        if (viz && nodes.length < 1 && !["pending", "questions"].includes(viz.dataset.vizVariant || "")) findings.push({ code: "VIZ_TOO_FEW_NODES_DOM", severity: "ERROR", page: planned.pageNumber, evidence: { nodeCount: nodes.length } });
        if (viz && !edges.length && ["ownership_boundary", "hub_spoke", "bpmn", "architecture"].includes(viz.dataset.vizKind || "") && !["pending", "questions"].includes(viz.dataset.vizVariant || "")) findings.push({ code: "VIZ_ZERO_EDGE_DOM", severity: "ERROR", page: planned.pageNumber });
        const vizRect = viz?.getBoundingClientRect();
        const isMindMap = viz?.dataset.vizKind === "hub_spoke" && viz.dataset.vizVariant === "left_to_right_tree";
        const isBpmn = viz?.dataset.vizKind === "bpmn" && !["pending", "questions"].includes(viz.dataset.vizVariant || "");
        for (const node of nodes) {
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) findings.push({ code: "VIZ_NODE_EMPTY_RECT", severity: "ERROR", page: planned.pageNumber, elementIds: [node.dataset.nodeId] });
          if (Number(getComputedStyle(node).fontSize.replace("px", "")) < 10) findings.push({ code: "DOM_TEXT_TOO_SMALL", severity: "ERROR", page: planned.pageNumber, elementIds: [node.dataset.nodeId] });
          if (isMindMap || isBpmn) {
            // A dense (single-page, up-to-16-function) mind map deliberately zooms
            // out to an 11px node scale; regular maps keep the 14px minimum.
            const minimumFontSize = isMindMap ? (viz.dataset.vizDensity === "dense" ? 11 : 14) : 12;
            if (Number(getComputedStyle(node).fontSize.replace("px", "")) < minimumFontSize) findings.push({ code: "DOM_TEXT_TOO_SMALL", severity: "ERROR", page: planned.pageNumber, elementIds: [node.dataset.nodeId] });
            if (node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1) findings.push({ code: "VIZ_NODE_TEXT_OVERFLOW", severity: "BLOCKER", page: planned.pageNumber, elementIds: [node.dataset.nodeId] });
            if (vizRect && (rect.left < vizRect.left - 1 || rect.top < vizRect.top - 1 || rect.right > vizRect.right + 1 || rect.bottom > vizRect.bottom + 1)) findings.push({ code: "VIZ_NODE_OUT_OF_BOUNDS", severity: "BLOCKER", page: planned.pageNumber, elementIds: [node.dataset.nodeId] });
          }
        }
        if (isBpmn) {
          for (const label of bpmnLaneLabels) {
            const rect = label.getBoundingClientRect();
            const labelText = label.querySelector("strong") || label;
            const laneId = label.closest(".viz-bpmn-lane")?.dataset.laneId;
            if (Number(getComputedStyle(labelText).fontSize.replace("px", "")) < 11) findings.push({ code: "DOM_TEXT_TOO_SMALL", severity: "ERROR", page: planned.pageNumber, elementIds: [laneId] });
            if (label.scrollWidth > label.clientWidth + 1 || label.scrollHeight > label.clientHeight + 1) findings.push({ code: "VIZ_LANE_LABEL_TEXT_OVERFLOW", severity: "BLOCKER", page: planned.pageNumber, elementIds: [laneId] });
            if (vizRect && (rect.left < vizRect.left - 1 || rect.top < vizRect.top - 1 || rect.right > vizRect.right + 1 || rect.bottom > vizRect.bottom + 1)) findings.push({ code: "VIZ_LANE_LABEL_OUT_OF_BOUNDS", severity: "BLOCKER", page: planned.pageNumber, elementIds: [laneId] });
          }
          for (const label of bpmnEdgeLabels) {
            const rect = label.getBoundingClientRect();
            if (Number(getComputedStyle(label).fontSize.replace("px", "")) < 12) findings.push({ code: "DOM_TEXT_TOO_SMALL", severity: "ERROR", page: planned.pageNumber, elementIds: [label.dataset.edgeId] });
            if (label.scrollWidth > label.clientWidth + 1 || label.scrollHeight > label.clientHeight + 1) findings.push({ code: "VIZ_EDGE_LABEL_TEXT_OVERFLOW", severity: "BLOCKER", page: planned.pageNumber, elementIds: [label.dataset.edgeId] });
            if (vizRect && (rect.left < vizRect.left - 1 || rect.top < vizRect.top - 1 || rect.right > vizRect.right + 1 || rect.bottom > vizRect.bottom + 1)) findings.push({ code: "VIZ_EDGE_LABEL_OUT_OF_BOUNDS", severity: "BLOCKER", page: planned.pageNumber, elementIds: [label.dataset.edgeId] });
          }
        }
        for (let i = 0; i < nodes.length; i += 1) {
          for (let j = i + 1; j < nodes.length; j += 1) {
            const a = nodes[i].getBoundingClientRect();
            const b = nodes[j].getBoundingClientRect();
            if (rectsOverlap(a, b, 2)) findings.push({ code: "VIZ_NODE_OVERLAP", severity: "BLOCKER", page: planned.pageNumber, elementIds: [nodes[i].dataset.nodeId, nodes[j].dataset.nodeId] });
          }
        }
        for (const edge of edges) {
          const pathData = edge.getAttribute("d") || "";
          // Mind-map connectors round their orthogonal corners with short
          // quadratic arcs; every other diagram stays strictly polyline.
          const allowedCommands = isMindMap ? ["M", "L", "Q"] : ["M", "L"];
          const unsupportedCommands = [...pathData.matchAll(/[a-z]/giu)]
            .map((match) => match[0].toUpperCase())
            .filter((command) => !allowedCommands.includes(command));
          if (unsupportedCommands.length) {
            findings.push({ code: "VIZ_EDGE_CURVED_UNSUPPORTED", severity: "BLOCKER", page: planned.pageNumber, elementIds: [edge.dataset.edgeId], evidence: { commands: [...new Set(unsupportedCommands)] } });
          }
          const points = pathPoints(pathData);
          if (points.length < 2 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
            findings.push({ code: "VIZ_EDGE_PATH_INVALID", severity: "BLOCKER", page: planned.pageNumber, elementIds: [edge.dataset.edgeId], evidence: { pointCount: points.length } });
            continue;
          }
          const strokeWidth = parseFloat(getComputedStyle(edge).strokeWidth || edge.getAttribute("stroke-width") || "0") || 0;
          if (strokeWidth < 1.5) {
            findings.push({ code: "VIZ_EDGE_TOO_THIN", severity: "ERROR", page: planned.pageNumber, elementIds: [edge.dataset.edgeId], evidence: { strokeWidth, minimum: 1.5 } });
          }
          const sourceNode = nodes.find((node) => node.dataset.nodeId === edge.dataset.edgeFrom);
          const targetNode = nodes.find((node) => node.dataset.nodeId === edge.dataset.edgeTo);
          if (!sourceNode || !targetNode) {
            findings.push({ code: "VIZ_EDGE_ENDPOINT_NODE_MISSING", severity: "BLOCKER", page: planned.pageNumber, elementIds: [edge.dataset.edgeId, edge.dataset.edgeFrom, edge.dataset.edgeTo].filter(Boolean) });
          } else {
            const vizRect = viz.getBoundingClientRect();
            const localNodeRect = (node) => {
              const rect = node.getBoundingClientRect();
              return { x: rect.left - vizRect.left, y: rect.top - vizRect.top, w: rect.width, h: rect.height };
            };
            const sourceDistance = pointToRectDistance(points[0], localNodeRect(sourceNode));
            const targetDistance = pointToRectDistance(points[points.length - 1], localNodeRect(targetNode));
            if (sourceDistance > 12 || targetDistance > 12) {
              findings.push({ code: "VIZ_EDGE_ENDPOINT_DETACHED", severity: "BLOCKER", page: planned.pageNumber, elementIds: [edge.dataset.edgeId, sourceNode.dataset.nodeId, targetNode.dataset.nodeId], evidence: { sourceDistance: round(sourceDistance), targetDistance: round(targetDistance), tolerance: 12 } });
            }
          }
          for (let index = 0; index < points.length - 1; index += 1) {
            const segment = [points[index], points[index + 1]];
            for (const node of nodes) {
              const nodeId = node.dataset.nodeId;
              if (nodeId === edge.dataset.edgeFrom || nodeId === edge.dataset.edgeTo) continue;
              const pageRect = page.getBoundingClientRect();
              const nr = node.getBoundingClientRect();
              const localRect = { x: nr.left - pageRect.left, y: nr.top - pageRect.top, w: nr.width, h: nr.height };
              const vizRect = viz.getBoundingClientRect();
              const vizLocalRect = { x: nr.left - vizRect.left, y: nr.top - vizRect.top, w: nr.width, h: nr.height };
              if (segmentIntersectsRect(segment, shrinkRect(vizLocalRect, 2))) {
                findings.push({ code: "VIZ_EDGE_THROUGH_NODE", severity: "BLOCKER", page: planned.pageNumber, elementIds: [edge.dataset.edgeId, nodeId] });
              }
            }
          }
        }
      }
    }
    const visualFeatures = measureVisualFeatures(pages);
    return {
      pageCount: pages.length,
      visualizationCount: document.querySelectorAll(".viz-canvas").length,
      nodeCount: document.querySelectorAll("[data-node-id]").length,
      edgeCount: document.querySelectorAll('[data-geometry-role="edge"][data-edge-id]').length,
      whitespaceRatio: visualFeatures.layout.whitespaceRatio,
      occupiedAreaRatio: visualFeatures.density.occupiedAreaRatio,
      medianGutterToPageWidth: visualFeatures.density.medianGutterToPageWidth,
      verticalRhythmToPageHeight: visualFeatures.density.verticalRhythmToPageHeight,
      semanticPlacementSim: visualFeatures.palette.semanticPlacementSim,
      decorationAreaRatio: visualFeatures.tone.decorationAreaRatio,
      typography: visualFeatures.typography,
      geometry: visualFeatures.geometry,
      imagery: visualFeatures.imagery,
      clientLanguage: clientLanguage.metrics,
      clientContentPolicy: clientContentPolicy.metrics,
      uiHardcheck: uiHardcheck.metrics,
      visualFeatures,
      findings,
    };
    function inspectTeamCapacityReconciliation(pageElements) {
      const teamPage = pageElements.find((item) => item.dataset.pageKind === "team");
      const teamRoot = teamPage?.querySelector(".team-capacity-layout");
      if (!teamRoot) return [];
      const output = [];
      const epsilon = 0.0005;
      const nullableInteger = (value) => /^\d+$/.test(String(value || "")) ? Number(value) : null;
      const rows = [...teamRoot.querySelectorAll(".team-capacity-row")].map((element) => {
        const quantityElement = element.querySelector(".team-quantity");
        const durationElement = element.querySelector(".team-duration");
        const rateElement = element.querySelector(".team-rate");
        return {
          element,
          roleIndex: Number(element.dataset.roleIndex),
          peakFte: Number(element.dataset.rolePeakFte),
          fteMonths: Number(element.dataset.roleFteMonths),
          quantity: Number(quantityElement?.dataset.fte),
          activeMonths: Number(durationElement?.dataset.activeMonths),
          rateMinor: nullableInteger(rateElement?.dataset.teamRateMinor),
          amountMinor: nullableInteger(element.dataset.teamAmountMinor),
        };
      });
      for (const row of rows) {
        const computedFteMonths = row.quantity * row.activeMonths;
        const priced = row.rateMinor !== null || row.amountMinor !== null;
        const pricingMismatch = priced && (row.rateMinor === null || row.amountMinor === null
          || Math.abs((row.rateMinor * row.fteMonths) - row.amountMinor) > 2);
        if (![row.peakFte, row.fteMonths, row.quantity, row.activeMonths].every(Number.isFinite)
          || row.quantity < 0 || row.activeMonths < 0 || Math.abs(row.quantity - row.peakFte) > epsilon
          || Math.abs(computedFteMonths - row.fteMonths) > epsilon || pricingMismatch) {
          output.push({
            code: pricingMismatch ? "DOM_TEAM_ROLE_COST_MISMATCH" : "DOM_TEAM_ROLE_CAPACITY_MISMATCH",
            severity: "BLOCKER",
            page: Number(teamPage.dataset.pageNumber),
            evidence: { roleIndex: row.roleIndex, peakFte: row.peakFte, quantity: row.quantity, activeMonths: row.activeMonths, fteMonths: row.fteMonths, computedFteMonths, rateMinor: row.rateMinor, amountMinor: row.amountMinor },
          });
        }
      }
      const expectedTotalMinor = nullableInteger(teamRoot.dataset.teamTotalMinor);
      const renderedTotalMinor = nullableInteger(teamRoot.querySelector(".team-capacity-total")?.dataset.teamTotalMinor);
      const allocatedTotalMinor = rows.reduce((sum, row) => sum + Number(row.amountMinor || 0), 0);
      if (expectedTotalMinor !== renderedTotalMinor || (expectedTotalMinor !== null && allocatedTotalMinor !== expectedTotalMinor)
        || (expectedTotalMinor === null && rows.some((row) => row.rateMinor !== null || row.amountMinor !== null))) {
        output.push({
          code: "DOM_TEAM_COST_TOTAL_MISMATCH",
          severity: "BLOCKER",
          page: Number(teamPage.dataset.pageNumber),
          evidence: { expectedTotalMinor, renderedTotalMinor, allocatedTotalMinor },
        });
      }
      const renderedAggregatePeak = Number(teamRoot.dataset.teamPeakFte);
      const capacityEnvelope = Number(teamRoot.querySelector(".team-capacity-note")?.dataset.teamCapacityEnvelope);
      if (!Number.isFinite(renderedAggregatePeak) || !Number.isFinite(capacityEnvelope)
        || Math.abs(capacityEnvelope - renderedAggregatePeak) > epsilon) {
        output.push({
          code: "DOM_TEAM_AGGREGATE_PEAK_MISMATCH",
          severity: "BLOCKER",
          page: Number(teamPage.dataset.pageNumber),
          evidence: { renderedAggregatePeak, capacityEnvelope },
        });
      }
      const projectPricePage = pageElements.find((item) => item.dataset.pageKind === "project_price");
      const projectRows = [...(projectPricePage?.querySelectorAll(".project-price-row[data-role-index]") || [])];
      const expectsProjectRoleRows = rows.length >= 4 && rows.length <= 8;
      if (projectPricePage && expectsProjectRoleRows && (projectRows.length !== rows.length || projectRows.some((element) => {
        const matching = rows.find((row) => row.roleIndex === Number(element.dataset.roleIndex));
        return !matching
          || Math.abs(Number(element.dataset.rolePeakFte) - matching.peakFte) > epsilon
          || Math.abs(Number(element.dataset.roleFteMonths) - matching.fteMonths) > epsilon;
      }))) {
        output.push({
          code: "DOM_PROJECT_PRICE_TEAM_CAPACITY_MISMATCH",
          severity: "BLOCKER",
          page: Number(projectPricePage.dataset.pageNumber),
          evidence: { teamRoleCount: rows.length, projectPriceRoleCount: projectRows.length },
        });
      }
      return output;
    }
    function inspectPageUiContract(pageElements, currentPlan) {
      const rendererRoot = document.querySelector("main.proposal[data-renderer-version='reference-driven-v5']");
      const metrics = {
        enabled: Boolean(rendererRoot),
        checkedPageCount: 0,
        passedPageCount: 0,
        failedPageCount: 0,
        perPage: [],
      };
      if (!rendererRoot) return { findings: [], metrics };

      const output = [];
      metrics.fontStatus = document.fonts?.status || "unsupported";
      if (document.fonts && document.fonts.status !== "loaded") {
        output.push({ code: "DOM_UI_FONT_NOT_READY", severity: "BLOCKER", message: "Document fonts are not ready at the UI hard-check boundary", evidence: { status: document.fonts.status } });
      }
      metrics.fontResolution = {
        display: fontResolutionForElement([...rendererRoot.querySelectorAll(".page-title,h1,h2")].find(isVisible)),
        body: fontResolutionForElement([...rendererRoot.querySelectorAll("p,.body-copy,.copy")].find(isVisible)),
        metadata: fontResolutionForElement([...rendererRoot.querySelectorAll(".eyebrow,.page-kicker,.meta,.label")].find(isVisible)),
      };
      const fontFallbacks = Object.entries(metrics.fontResolution)
        .filter(([, row]) => row && row.primaryAvailable === false)
        .map(([role, row]) => ({ role, requestedPrimary: row.requestedPrimary, resolvedFamily: row.resolvedFamily, requestedStack: row.requestedStack }));
      if (fontFallbacks.length) {
        output.push({
          code: "DOM_UI_FONT_FALLBACK_USED",
          severity: "WARNING",
          message: "The requested primary font is unavailable; Chromium rendered an explicit fallback from the declared stack",
          evidence: { roles: fontFallbacks },
        });
      }
      const brokenImages = [...rendererRoot.querySelectorAll("img")].filter((image) => image.dataset.kpImageError === "true" || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0);
      if (brokenImages.length) {
        output.push({ code: "DOM_UI_IMAGE_FAILED", severity: "BLOCKER", message: "A visible proposal image failed to load", evidence: { count: brokenImages.length, samples: brokenImages.slice(0, 8).map((image) => ({ alt: image.alt || "", src: String(image.currentSrc || image.src || "").slice(0, 100) })) } });
      }
      const visibleImages = [...rendererRoot.querySelectorAll("img")].filter(isVisible);
      const imagesWithoutAlt = visibleImages.filter((image) => {
        const explicitlyDecorative = image.getAttribute("aria-hidden") === "true"
          || image.dataset.decorative === "true"
          || ["none", "presentation"].includes(String(image.getAttribute("role") || "").toLowerCase());
        return !String(image.getAttribute("alt") || "").trim() && !explicitlyDecorative;
      });
      if (imagesWithoutAlt.length) {
        output.push({ code: "DOM_UI_IMAGE_ALT_MISSING", severity: "ERROR", message: "Every visible content image needs useful alt text or an explicit decorative role", evidence: { count: imagesWithoutAlt.length, samples: imagesWithoutAlt.slice(0, 8).map((image) => ({ src: String(image.currentSrc || image.src || "").slice(0, 100) })) } });
      }
      const lowResolutionImages = visibleImages.map((image) => {
        const rect = image.getBoundingClientRect();
        return { image, rect, ratioX: rect.width > 0 ? image.naturalWidth / rect.width : 0, ratioY: rect.height > 0 ? image.naturalHeight / rect.height : 0 };
      }).filter((row) => row.rect.width > 0 && row.rect.height > 0 && (row.ratioX + .01 < 1 || row.ratioY + .01 < 1));
      if (lowResolutionImages.length) {
        output.push({ code: "DOM_UI_IMAGE_RESOLUTION_LOW", severity: "ERROR", message: "A visible image has fewer intrinsic pixels than its rendered dimensions", evidence: { count: lowResolutionImages.length, minimumRatio: 1, samples: lowResolutionImages.slice(0, 8).map((row) => ({ alt: row.image.alt || "", naturalWidth: row.image.naturalWidth, naturalHeight: row.image.naturalHeight, renderedWidth: round(row.rect.width), renderedHeight: round(row.rect.height), ratioX: round(row.ratioX), ratioY: round(row.ratioY) })) } });
      }
      if (document.querySelectorAll("main.proposal[data-renderer-version='reference-driven-v5']").length !== 1) {
        output.push({ code: "DOM_UI_PROPOSAL_ROOT_INVALID", severity: "BLOCKER", message: "Rendered output requires exactly one proposal root" });
      }
      const plannedPages = Array.isArray(currentPlan?.pages) ? currentPlan.pages : [];
      const directPages = [...rendererRoot.children].filter((element) => element.matches?.("section.kp-page"));
      if (directPages.length !== pageElements.length || rendererRoot.querySelectorAll("section.kp-page").length !== pageElements.length) {
        output.push({
          code: "DOM_UI_PAGE_HIERARCHY_INVALID",
          severity: "BLOCKER",
          message: "Every proposal page must be one direct child of the proposal root",
          evidence: { directPageCount: directPages.length, pageCount: pageElements.length },
        });
      }

      const duplicateKinds = new Map();
      for (const pageElement of pageElements) {
        const pageNumber = Number(pageElement.dataset.pageNumber) || null;
        const planned = plannedPages.find((row) => Number(row.pageNumber) === pageNumber) || {};
        const kind = String(pageElement.dataset.pageKind || planned.kind || planned.pageKind || "");
        const pageFindings = [];
        const add = (code, severity, message, evidence = {}) => pageFindings.push({ code, severity, page: pageNumber, message, evidence });
        metrics.checkedPageCount += 1;

        duplicateKinds.set(kind, (duplicateKinds.get(kind) || 0) + 1);
        if (!pageNumber || pageNumber < 1 || pageNumber > pageElements.length) {
          add("DOM_UI_PAGE_NUMBER_INVALID", "BLOCKER", "Page number is missing or outside the rendered deck", { pageNumber });
        }
        if (!kind || (planned.kind && kind !== planned.kind)) {
          add("DOM_UI_PAGE_KIND_MISMATCH", "BLOCKER", "Rendered page kind does not match the presentation plan", { kind, plannedKind: planned.kind || null });
        }
        if (planned.layoutFamily && pageElement.dataset.layoutFamily !== planned.layoutFamily) {
          add("DOM_UI_LAYOUT_FAMILY_MISMATCH", "BLOCKER", "Rendered layout family does not match the presentation plan", { rendered: pageElement.dataset.layoutFamily || null, planned: planned.layoutFamily });
        }
        const plannedVizId = planned.visualizationSpecId || planned.visualizationId || null;
        const canvases = [...pageElement.querySelectorAll(".viz-canvas")];
        if (plannedVizId) {
          if (canvases.length !== 1 || canvases[0]?.dataset.vizId !== plannedVizId) add("DOM_UI_VISUALIZATION_CONTRACT_INVALID", "BLOCKER", "A planned visualization page requires exactly one matching canvas", { plannedVizId, canvasCount: canvases.length, renderedVizId: canvases[0]?.dataset.vizId || null });
        } else if (canvases.length) {
          add("DOM_UI_VISUALIZATION_CONTRACT_INVALID", "BLOCKER", "A non-visual page must not contain a visualization canvas", { canvasCount: canvases.length });
        }
        for (const [role, elements] of [["node", [...pageElement.querySelectorAll("[data-node-id]")]], ["edge", [...pageElement.querySelectorAll("[data-geometry-role='edge'][data-edge-id]")]]]) {
          const ids = elements.map((element) => role === "node" ? element.dataset.nodeId : element.dataset.edgeId).filter(Boolean);
          if (new Set(ids).size !== ids.length) add("DOM_UI_SEMANTIC_ID_DUPLICATE", "BLOCKER", "Semantic node and edge IDs must be unique within each page", { role, ids });
        }
        const expectedExplicit = Array.isArray(planned.selectionReasons) && planned.selectionReasons.includes("explicitly_requested_in_prompt");
        if (pageElement.dataset.explicitlyRequested !== String(expectedExplicit)) {
          add("DOM_UI_EXPLICIT_REQUEST_STATE_MISMATCH", "ERROR", "Rendered request-state metadata does not match the presentation plan", { rendered: pageElement.dataset.explicitlyRequested || null, expected: String(expectedExplicit) });
        }

        const shellSelectors = {
          header: ":scope > .page-header",
          titleRow: ":scope > .page-title-row",
          title: ":scope > .page-title-row .page-title",
          badge: ":scope > .page-title-row .page-badge",
          body: ":scope > .page-body",
          footer: ":scope > .page-footer",
        };
        const shell = {};
        for (const [role, selector] of Object.entries(shellSelectors)) {
          const matches = [...pageElement.querySelectorAll(selector)];
          if (matches.length !== 1) add("DOM_UI_SHELL_STRUCTURE_INVALID", "BLOCKER", "Every page requires exactly one " + role + " region", { role, selector, count: matches.length });
          shell[role] = matches[0] || null;
        }

        const pageRect = pageElement.getBoundingClientRect();
        if (!near(pageRect.width, 1440, 1) || !near(pageRect.height, 960, 1)) {
          add("DOM_UI_PAGE_GEOMETRY_INVALID", "BLOCKER", "Rendered page must be exactly 1440 × 960 CSS pixels", { width: round(pageRect.width), height: round(pageRect.height) });
        }
        const shellRects = Object.fromEntries(Object.entries(shell).map(([role, element]) => [role, element?.getBoundingClientRect() || null]));
        for (const [role, rect] of Object.entries(shellRects)) {
          if (rect && !rectInside(rect, pageRect, 1)) add("DOM_UI_SHELL_OUT_OF_BOUNDS", "BLOCKER", "A page shell region extends outside the page", { role, rect: compactRect(rect), pageRect: compactRect(pageRect) });
        }
        if (shellRects.header && shellRects.titleRow && shellRects.header.bottom > shellRects.titleRow.top + 1) {
          add("DOM_UI_SHELL_ORDER_INVALID", "BLOCKER", "Header and title regions overlap", { header: compactRect(shellRects.header), titleRow: compactRect(shellRects.titleRow) });
        }
        if (shellRects.titleRow && shellRects.body && shellRects.titleRow.bottom > shellRects.body.top + 1) {
          add("DOM_UI_SHELL_ORDER_INVALID", "BLOCKER", "Title and body regions overlap", { titleRow: compactRect(shellRects.titleRow), body: compactRect(shellRects.body) });
        }
        if (shellRects.body && shellRects.footer && shellRects.body.bottom > shellRects.footer.top + 1) {
          add("DOM_UI_SHELL_ORDER_INVALID", "BLOCKER", "Body and footer regions overlap", { body: compactRect(shellRects.body), footer: compactRect(shellRects.footer) });
        }
        if (shellRects.title && shellRects.badge && rectsOverlap(shellRects.title, shellRects.badge, 2)) {
          add("DOM_UI_TITLE_BADGE_OVERLAP", "BLOCKER", "Page title and badge overlap", { title: compactRect(shellRects.title), badge: compactRect(shellRects.badge) });
        }

        const titleText = normalizedVisibleText(shell.title);
        const badgeText = normalizedVisibleText(shell.badge);
        if (!titleText || !badgeText) add("DOM_UI_SHELL_TEXT_MISSING", "ERROR", "Page title and badge must both contain visible client text", { titleText, badgeText });
        const titleSize = shell.title ? parseFloat(getComputedStyle(shell.title).fontSize) : 0;
        if (titleSize && titleSize < 34) add("DOM_UI_TITLE_TOO_SMALL", "ERROR", "Page title must remain presentation-readable", { fontSize: round(titleSize), minimum: 34 });
        if (shell.title) {
          const titleStyle = getComputedStyle(shell.title);
          const titleLineHeight = parseFloat(titleStyle.lineHeight) || titleSize * 1.2;
          const titleLines = titleLineHeight ? Math.max(1, Math.round(shell.title.getBoundingClientRect().height / titleLineHeight)) : 1;
          const maximumLines = kind === "cover" ? 3 : 2;
          if (titleLines > maximumLines) add("DOM_UI_TITLE_TOO_MANY_LINES", "ERROR", "Page title exceeds its maximum line count", { titleLines, maximumLines });
        }

        const bodyChildren = shell.body ? [...shell.body.children].filter(isVisible) : [];
        if (bodyChildren.length !== 1) {
          add("DOM_UI_CONTENT_ROOT_INVALID", "BLOCKER", "Every page body requires exactly one visible composition root", { count: bodyChildren.length });
        }
        const bodyRect = shellRects.body;
        if (shell.body && (shell.body.scrollWidth > shell.body.clientWidth + 2 || shell.body.scrollHeight > shell.body.clientHeight + 2)) {
          add("DOM_UI_BODY_OVERFLOW", "BLOCKER", "Page body content exceeds its fixed layout bounds", { scrollWidth: shell.body.scrollWidth, clientWidth: shell.body.clientWidth, scrollHeight: shell.body.scrollHeight, clientHeight: shell.body.clientHeight });
        }
        for (const child of bodyChildren) {
          const rect = child.getBoundingClientRect();
          if (bodyRect && !rectInside(rect, bodyRect, 1)) add("DOM_UI_CONTENT_ROOT_OUT_OF_BOUNDS", "BLOCKER", "The page composition root extends outside the body", { className: classLabel(child), rect: compactRect(rect), bodyRect: compactRect(bodyRect) });
          if (child.scrollWidth > child.clientWidth + 2 || child.scrollHeight > child.clientHeight + 2) {
            add("DOM_UI_CONTENT_ROOT_OVERFLOW", "BLOCKER", "The page composition root overflows its allocated body", { className: classLabel(child), scrollWidth: child.scrollWidth, clientWidth: child.clientWidth, scrollHeight: child.scrollHeight, clientHeight: child.clientHeight });
          }
        }

        const kindContract = pageKindUiContract(kind);
        if (!kindContract) {
          add("DOM_UI_PAGE_KIND_UNCHECKED", "BLOCKER", "No UI hard-check contract exists for this page kind", { kind });
        } else if (kindContract.forbidden) {
          add("DOM_DESIGN_PROJECT_PAGE_VISIBLE", "BLOCKER", "Design Project must not appear in a client proposal", { kind });
        } else {
          for (const requirement of kindContract.requirements) {
            const count = pageElement.querySelectorAll(requirement.selector).length;
            const minimum = requirement.min ?? 1;
            const maximum = requirement.max ?? minimum;
            if (count < minimum || count > maximum) add("DOM_UI_PAGE_STRUCTURE_INVALID", "BLOCKER", "Page-specific UI structure does not satisfy its contract", { kind, role: requirement.role, selector: requirement.selector, count, minimum, maximum });
          }
          if (kindContract.oneOf?.length) {
            const matches = kindContract.oneOf.map((selector) => ({ selector, count: pageElement.querySelectorAll(selector).length })).filter((row) => row.count > 0);
            if (matches.length !== 1 || matches[0].count !== 1) add("DOM_UI_PAGE_STRUCTURE_INVALID", "BLOCKER", "Page requires exactly one supported content state", { kind, alternatives: kindContract.oneOf, matches });
          }
          for (const state of kindContract.stateRequirements || []) {
            if (!pageElement.querySelector(state.when)) continue;
            for (const requirement of state.requirements) {
              const count = pageElement.querySelectorAll(requirement.selector).length;
              const minimum = requirement.min ?? 1;
              const maximum = requirement.max ?? minimum;
              if (count < minimum || count > maximum) add("DOM_UI_PAGE_STRUCTURE_INVALID", "BLOCKER", "Active page state does not satisfy its UI contract", { kind, state: state.when, role: requirement.role, selector: requirement.selector, count, minimum, maximum });
            }
          }
        }

        if (kind === "client_dependencies" && pageElement.querySelector(".client-dependencies-table")) {
          const summary = pageElement.querySelector(".client-dependencies-summary");
          const rows = [...pageElement.querySelectorAll(".client-dependency-row[data-readiness-bucket]")];
          const renderedCounts = {
            ready: rows.filter((row) => row.dataset.readinessBucket === "ready").length,
            waiting: rows.filter((row) => row.dataset.readinessBucket === "waiting").length,
            blocked: rows.filter((row) => row.dataset.readinessBucket === "blocked").length,
          };
          const declaredCounts = {
            ready: Number(summary?.dataset.readyCount),
            waiting: Number(summary?.dataset.waitingCount),
            blocked: Number(summary?.dataset.blockedCount),
          };
          const declaredRowCount = Number(summary?.dataset.dependencyRowCount);
          const countersMatch = rows.length > 0
            && declaredRowCount === rows.length
            && Object.keys(renderedCounts).every((key) => declaredCounts[key] === renderedCounts[key])
            && Object.values(declaredCounts).reduce((sum, value) => sum + value, 0) === rows.length;
          if (!countersMatch) add("DOM_CLIENT_DEPENDENCY_COUNTER_MISMATCH", "BLOCKER", "Client-dependency counters must be derived from the rendered readiness rows", { renderedCounts, declaredCounts, declaredRowCount, rowCount: rows.length });
        }
        if (kind === "close") {
          const root = pageElement.querySelector(".decision-layout[data-close-ready]");
          const closeReady = root?.dataset.closeReady === "true";
          const declaredBlockerCount = Number(root?.dataset.closeBlockerCount);
          const blockers = [...pageElement.querySelectorAll(".close-blocker[data-close-blocker='true']")];
          if (!root || !Number.isInteger(declaredBlockerCount) || declaredBlockerCount !== blockers.length || (closeReady && blockers.length > 0) || (!closeReady && blockers.length < 1)) {
            add("DOM_CLOSE_BLOCKER_RECONCILIATION_INVALID", "BLOCKER", "Close readiness and its blocker inventory must reconcile", { closeReady, declaredBlockerCount, renderedBlockerCount: blockers.length });
          }
          const unsafeSigningPromise = /signature[- ]ready|ready\s+for\s+signature|prepar\w*\s+(?:the\s+)?(?:terms\s+)?for\s+signature|готов\w*\s+к\s+подпис|подготов\w*[^.]{0,60}к\s+подпис|imzolashga\s+tayyor|imzo[^.]{0,40}tayyor/iu.test(normalizedVisibleText(pageElement));
          if (!closeReady && unsafeSigningPromise) add("DOM_CLOSE_SIGNING_PROMISE_WITH_OPEN_BLOCKERS", "BLOCKER", "Close page must not promise signature readiness while commercial or client blockers remain open", { declaredBlockerCount });
        }

        const textSamples = visibleOwnTextElements(pageElement);
        if (textSamples.length < 2) add("DOM_UI_TEXT_PAYLOAD_TOO_LOW", "ERROR", "Page UI requires at least two visible text elements", { count: textSamples.length });
        const smallText = [];
        const clippedText = [];
        const outOfBoundsText = [];
        const lowContrastText = [];
        const brokenWords = [];
        for (const element of textSamples) {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const fontSize = parseFloat(style.fontSize) || 0;
          const text = ownVisibleText(element);
          if (fontSize < 8) smallText.push({ element: elementLabel(element), text: text.slice(0, 80), fontSize: round(fontSize) });
          const toleranceY = Math.max(3, fontSize * .18);
          const clipsX = ["hidden", "clip", "auto", "scroll"].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 2;
          const clipsY = ["hidden", "clip", "auto", "scroll"].includes(style.overflowY) && element.scrollHeight > element.clientHeight + toleranceY;
          if (clipsX || clipsY) clippedText.push({ element: elementLabel(element), text: text.slice(0, 80), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight });
          if (bodyRect && shell.body?.contains(element) && !rectInside(rect, bodyRect, 2)) outOfBoundsText.push({ element: elementLabel(element), text: text.slice(0, 80), rect: compactRect(rect) });
          const contrast = textContrastRatio(element);
          const large = fontSize >= 24 || (fontSize >= 18.66 && numericFontWeight(style.fontWeight) >= 700);
          const minimumContrast = large ? 3 : 4.5;
          if (contrast !== null && contrast + .02 < minimumContrast) lowContrastText.push({ element: elementLabel(element), text: text.slice(0, 80), contrast: round(contrast), minimum: minimumContrast });
          for (const word of forcedWordBreaks(element)) brokenWords.push({ element: elementLabel(element), word });
        }
        if (smallText.length) add("DOM_UI_TEXT_TOO_SMALL", "ERROR", "Visible client text falls below the 8 px hard floor", { samples: smallText.slice(0, 12), count: smallText.length });
        if (clippedText.length) add("DOM_UI_TEXT_CLIPPED", "BLOCKER", "Visible client text is clipped by its container", { samples: clippedText.slice(0, 12), count: clippedText.length });
        if (outOfBoundsText.length) add("DOM_UI_TEXT_OUT_OF_BOUNDS", "BLOCKER", "Visible body text extends outside the page body", { samples: outOfBoundsText.slice(0, 12), count: outOfBoundsText.length });
        if (lowContrastText.length) add("DOM_UI_TEXT_CONTRAST_LOW", "ERROR", "Visible client text does not meet the required contrast ratio", { samples: lowContrastText.slice(0, 12), count: lowContrastText.length });
        if (brokenWords.length) add("DOM_UI_WORD_BROKEN", "ERROR", "A client-visible word or hyphenated token is split across lines", { samples: brokenWords.slice(0, 12), count: brokenWords.length });

        const pageNumbers = normalizedVisibleText(shell.header);
        const footerNumber = normalizedVisibleText(shell.footer?.querySelector("strong"));
        const expectedNumber = String(pageNumber || 0).padStart(2, "0");
        const expectedHeader = expectedNumber + " / " + pageElements.length;
        if (!pageNumbers.includes(expectedHeader) || footerNumber !== expectedNumber) {
          add("DOM_UI_PAGE_LABEL_MISMATCH", "ERROR", "Header and footer page labels must match the rendered sequence", { expectedHeader, headerText: pageNumbers, expectedFooter: expectedNumber, footerText: footerNumber });
        }

        output.push(...pageFindings);
        metrics.perPage.push({
          pageNumber,
          kind,
          passed: pageFindings.length === 0,
          findingCodes: [...new Set(pageFindings.map((finding) => finding.code))],
          visibleTitle: titleText.slice(0, 240),
          visibleTokens: visibleTokenInventory(pageElement, 250),
          textSampleCount: textSamples.length,
          minimumFontSize: textSamples.length ? round(Math.min(...textSamples.map((element) => parseFloat(getComputedStyle(element).fontSize) || Infinity))) : null,
        });
        if (pageFindings.length) metrics.failedPageCount += 1;
        else metrics.passedPageCount += 1;
      }
      if (pageElements.some((pageElement, index) => Number(pageElement.dataset.pageNumber) !== index + 1)) {
        output.push({ code: "DOM_UI_PAGE_SEQUENCE_INVALID", severity: "BLOCKER", message: "Rendered pages must be sequential in DOM order" });
      }
      metrics.kindCounts = Object.fromEntries([...duplicateKinds.entries()]);
      return { findings: output, metrics };
    }
    function pageKindUiContract(kind) {
      const contracts = {
        cover: { requirements: [
          required("root", ":scope > .page-body > .cover-grid"),
          required("cover main", ".cover-main"),
          required("cover main header", ".cover-main-head"),
          required("cover promise", ".cover-promise"),
          required("cover main copy", ".cover-main-copy > p"),
          required("cover side", ".cover-side"),
          required("cover side index", ".cover-side-index"),
          required("cover side copy", ".cover-side-copy"),
          required("cover side signal", ".cover-side-signal > span", 3, 3),
          required("cover meta", ".cover-meta"),
          required("cover metrics", ".cover-meta .metric", 3, 4),
          required("cover metric labels", ".cover-meta .metric > span", 3, 4),
          required("cover metric values", ".cover-meta .metric > strong", 3, 4),
        ] },
        opening_manifesto: { requirements: [
          required("root", ":scope > .page-body > .thread-layout"),
          required("decision thread", ".thread-line"),
          required("decision item", ".thread-item", 4, 4),
          required("decision item index", ".thread-item > span", 4, 4),
          required("decision item title", ".thread-item > strong", 4, 4),
          required("decision item detail", ".thread-item > p", 4, 4),
          required("decision summary", ".thread-layout > .muted"),
        ] },
        chapter_why_now: { requirements: chapterRequirements("03") },
        problem: {
          requirements: [],
          oneOf: [":scope > .page-body > .handoff-layout", ":scope > .page-body > .missing-state"],
          stateRequirements: [
            { when: ":scope > .page-body > .handoff-layout", requirements: [
              required("handoff thesis", ".handoff-thesis"),
              required("handoff thesis title", ".handoff-thesis > strong"),
              required("handoff thesis detail", ".handoff-thesis > p"),
              required("handoff list", ".handoff-list"),
              required("handoff rows", ".handoff-row", 1, 5),
              required("handoff row titles", ".handoff-row > div > strong", 1, 5),
              required("handoff row details", ".handoff-row > div > p", 1, 5),
              required("handoff row statuses", ".handoff-row > small", 1, 5),
            ] },
            { when: ":scope > .page-body > .missing-state", requirements: missingStateRequirements(4, 4) },
          ],
        },
        market_research: { requirements: [
          required("root", ":scope > .page-body > .evidence-layout"),
          required("evidence hero", ".evidence-hero"),
          required("evidence hero title", ".evidence-hero > strong"),
          required("evidence hero detail", ".evidence-hero > p"),
          required("evidence metrics", ".evidence-metrics"),
          required("evidence metrics", ".evidence-metrics .metric", 2, 2),
          required("evidence list", ".evidence-list"),
          required("evidence rows", ".evidence-row", 1, 4),
          required("evidence row labels", ".evidence-row > span", 1, 4),
          required("evidence row titles", ".evidence-row > strong", 1, 4),
          required("evidence row details", ".evidence-row > .evidence-detail", 1, 4),
        ] },
        market_sizing: {
          requirements: [
            required("root", ":scope > .page-body > .market-sizing-layout"),
            required("market story", ".market-story"),
            required("market thesis", ".market-sizing-thesis"),
            required("market discipline", ".market-sizing-discipline"),
            required("market model", ".market-model"),
            required("market context", ".market-context"),
            required("market funnel", ".market-sizing-funnel[data-viz-kind='nested_market']"),
            required("TAM", "[data-market-level='tam']"),
            required("SAM", "[data-market-level='sam']"),
            required("SOM", "[data-market-level='som']"),
            required("market level copy", ".market-level-copy", 3, 3),
            required("methodology", "[data-market-methodology='true']"),
            required("scenario disclosure", "[data-market-scenario-disclosure='true']"),
          ],
          oneOf: [
            ":scope > .page-body > .market-sizing-layout[data-market-state='numeric']",
            ":scope > .page-body > .market-sizing-layout[data-market-state='pending']",
          ],
          stateRequirements: [
            { when: ".market-sizing-layout[data-market-state='numeric']", requirements: [
              required("numeric market values", "[data-market-value]", 3, 5),
              required("SOM scenarios", ".market-scenario", 1, 3),
            ] },
            { when: ".market-sizing-layout[data-market-state='pending']", requirements: [
              required("pending input list", "[data-market-missing-inputs='true']"),
              required("pending input questions", ".market-missing-input", 1, 5),
              required("pending input labels", ".market-missing-input > span", 1, 5),
              required("pending input copy", ".market-missing-input > p", 1, 5),
            ] },
          ],
        },
        analog_research: { requirements: [
          required("root", ":scope > .page-body > .analog-layout"),
          required("analog panel", ".analog-panel", 2, 2),
          required("analog title", ".analog-title"),
          required("analog summary", ".analog-summary"),
          required("analog list", ".analog-list"),
          required("analog learning", ".analog-learning", 1, 3),
          required("analog learning title", ".analog-learning > strong", 1, 3),
          required("analog learning type", ".analog-learning > p", 1, 3),
          required("analog disclosure", ".analog-disclosure"),
        ] },
        launch_boundary: semanticRequirements("ownership_boundary", { minimumNodes: 2, minimumEdges: 1 }),
        chapter_product: { requirements: chapterRequirements("09") },
        product_map: semanticRequirements("hub_spoke", { minimumNodes: 2, maximumNodes: 42, minimumEdges: 1, maximumEdges: 41, extra: [
          required("mind map root", ".viz-node-core", 1, 1),
          required("mind map branches", ".viz-node-domain", 1, 8),
        ] }),
        design_project: { forbidden: true, requirements: [] },
        primary_flow: {
          requirements: [
            required("root", ":scope > .page-body > .semantic-layout"),
            required("semantic note", ".semantic-note"),
            required("BPMN visualization", ".viz-canvas[data-viz-kind='bpmn']"),
          ],
          oneOf: [
            ".viz-canvas[data-viz-kind='bpmn']:not([data-data-state='pending']):not([data-viz-variant='questions']):not([data-viz-variant='pending'])",
            ".viz-canvas[data-viz-kind='bpmn'][data-data-state='pending'],.viz-canvas[data-viz-kind='bpmn'][data-viz-variant='questions'],.viz-canvas[data-viz-kind='bpmn'][data-viz-variant='pending']",
          ],
          stateRequirements: [
            { when: ".viz-canvas[data-viz-kind='bpmn']:not([data-data-state='pending']):not([data-viz-variant='questions']):not([data-viz-variant='pending'])", requirements: [
              required("BPMN lanes", ".viz-bpmn-lane", 1, 8),
              required("BPMN lane labels", ".viz-bpmn-lane-label", 1, 8),
              required("BPMN start", ".viz-node-start_event", 1, 1),
              required("BPMN tasks", ".viz-node-task", 1, 20),
              required("BPMN end", ".viz-node-end_event", 1, 4),
              required("BPMN edges", "[data-geometry-role='edge'][data-edge-id]", 1, 30),
            ] },
            { when: ".viz-canvas[data-viz-kind='bpmn'][data-data-state='pending'],.viz-canvas[data-viz-kind='bpmn'][data-viz-variant='questions'],.viz-canvas[data-viz-kind='bpmn'][data-viz-variant='pending']", requirements: [
              required("BPMN decision questions", "[data-node-id]", 1, 8),
            ] },
          ],
        },
        architecture: {
          requirements: [
            required("root", ":scope > .page-body > .semantic-layout"),
            required("semantic note", ".semantic-note"),
            required("architecture visualization", ".viz-canvas[data-viz-kind='architecture']"),
            required("architecture legend", ".viz-architecture-legend"),
            required("architecture legend title", ".viz-architecture-legend-title"),
            required("architecture legend items", ".viz-architecture-legend-item", 5, 5),
            required("architecture layers", ".viz-architecture-layer", 5, 5),
            required("architecture layer labels", ".viz-architecture-layer-label", 5, 5),
            required("architecture nodes", ".viz-architecture-node", 1, 24),
          ],
        },
        org_structure: {
          requirements: [
            required("root", ":scope > .page-body > .org-layout"),
            required("organization chart", ".org-chart"),
            required("organization evidence", ".org-evidence"),
            required("organization evidence label", ".org-evidence > span"),
            required("organization evidence detail", ".org-evidence > p"),
            required("organization root", ".org-node.org-root"),
            required("organization root connector", ".org-root-connector"),
          ],
          oneOf: [".org-chart-people", ".org-branches"],
          stateRequirements: [
            { when: ".org-chart-people", requirements: [
              required("delivery manager node", ".org-manager-node", 1, 1),
              required("delivery manager connector", ".org-manager-connector", 1, 1),
              required("delivery role grid", ".org-people-grid", 1, 1),
              required("delivery role cards", ".org-person-node", 2, 8),
              required("delivery role connectors", ".org-person-connector", 2, 8),
            ] },
            { when: ".org-branches", requirements: [
              required("organization branches", ".org-branch", 3, 3),
              required("organization branch nodes", ".org-branch-node", 3, 3),
              required("organization branch connectors", ".org-branch-connector", 3, 3),
              required("organization child groups", ".org-children", 3, 3),
              required("organization child nodes", ".org-child-node", 3, 9),
              required("organization child connectors", ".org-child-connector", 3, 9),
            ] },
          ],
        },
        swot: { requirements: [
          required("root", ":scope > .page-body > .quadrant-grid"),
          required("quadrant", ".quadrant[data-swot-quadrant]", 4, 4),
          required("strength", "[data-swot-quadrant='strength']"),
          required("weakness", "[data-swot-quadrant='weakness']"),
          required("opportunity", "[data-swot-quadrant='opportunity']"),
          required("threat", "[data-swot-quadrant='threat']"),
          required("quadrant status", ".quadrant > span", 4, 4),
          required("quadrant title", ".quadrant > strong", 4, 4),
          required("quadrant copy", ".quadrant > p", 8, 8),
          required("recommended response", ".quadrant > p .eyebrow", 4, 4),
        ] },
        client_dependencies: {
          requirements: [
            required("root", ":scope > .page-body > .client-dependencies-layout"),
            required("dependency summary", ".client-dependencies-summary"),
            required("summary metric", ".client-dependency-metric", 3, 3),
            required("summary metric labels", ".client-dependency-metric > span", 3, 3),
            required("summary metric values", ".client-dependency-metric > strong", 3, 3),
            required("dependency principle", ".client-dependencies-principle"),
            required("dependency principle title", ".client-dependencies-principle > strong"),
            required("dependency principle detail", ".client-dependencies-principle > p"),
          ],
          oneOf: [".client-dependencies-table", ".client-dependencies-empty"],
          stateRequirements: [
            { when: ".client-dependencies-table", requirements: [
              required("dependency table head", ".client-dependencies-head"),
              required("dependency table head cells", ".client-dependencies-head > span", 3, 3),
              required("dependency groups", ".client-dependency-group", 1, 3),
              required("dependency rows", ".client-dependency-row", 1, 12),
              required("dependency names", ".client-dependency-name", 1, 12),
              required("dependency owners", ".client-dependency-owner", 1, 12),
              required("dependency states", ".client-dependency-state", 1, 12),
              required("dependency checkboxes", ".client-dependency-checkbox", 1, 12),
            ] },
            { when: ".client-dependencies-empty", requirements: [
              required("empty dependency title", ".client-dependencies-empty > strong"),
              required("empty dependency detail", ".client-dependencies-empty > p"),
            ] },
          ],
        },
        chapter_delivery: { requirements: chapterRequirements("15") },
        function_price: {
          requirements: [required("root", ":scope > .page-body > .function-price-layout")],
          oneOf: [".function-price-table", ".function-price-layout > .missing-state"],
          stateRequirements: [
            { when: ".function-price-table", requirements: [
              required("function table head", ".function-price-head"),
              required("function table head cells", ".function-price-head > span", 5, 5),
              required("function rows", ".function-price-row", 1, Number.MAX_SAFE_INTEGER),
              required("function row indexes", ".function-price-index", 1, Number.MAX_SAFE_INTEGER),
              required("function epics", ".function-price-epic", 1, Number.MAX_SAFE_INTEGER),
              required("function tasks", ".function-price-task", 1, Number.MAX_SAFE_INTEGER),
              required("function subtasks", ".function-price-subtask", 1, Number.MAX_SAFE_INTEGER),
              required("function deadlines", ".function-price-deadline", 1, Number.MAX_SAFE_INTEGER),
            ] },
            { when: ".function-price-layout > .missing-state", requirements: missingStateRequirements(3, 3) },
          ],
        },
        team: {
          requirements: [],
          oneOf: [":scope > .page-body > .team-capacity-layout", ":scope > .page-body > .missing-state"],
          stateRequirements: [
            { when: ":scope > .page-body > .team-capacity-layout", requirements: [
              required("team metrics", ".team-capacity-metrics"),
              required("team metric cards", ".team-capacity-metric", 4, 4),
              required("team capacity table", ".team-capacity-table"),
              required("team scenario disclosure", ".team-capacity-disclosure"),
              required("team table head", ".team-capacity-head"),
              required("team table head cells", ".team-capacity-head > span", 5, 5),
              required("team role rows", ".team-capacity-row", 1, 9),
              required("team role labels", ".team-capacity-role", 1, 9),
              required("team quantities", ".team-quantity", 1, 9),
              required("team durations", ".team-duration", 1, 9),
              required("team monthly rates", ".team-rate", 1, 9),
              required("team amounts", ".team-amount", 1, 9),
              required("team total", ".team-capacity-total"),
              required("team cost total", ".team-cost-total"),
              required("team capacity note", ".team-capacity-note"),
            ] },
            { when: ":scope > .page-body > .missing-state", requirements: missingStateRequirements(2, 3) },
          ],
        },
        roadmap: {
          requirements: [required("Gantt visualization", "[data-viz-kind='gantt']")],
          oneOf: [":scope > .page-body > .roadmap-stage-layout", ":scope > .page-body > .semantic-layout:not(.roadmap-stage-layout)"],
          stateRequirements: [
            { when: ":scope > .page-body > .roadmap-stage-layout", requirements: [
              required("roadmap intro", ".roadmap-stage-intro"),
              required("roadmap thesis", ".roadmap-stage-thesis"),
              required("roadmap duration", ".roadmap-duration-fact"),
              required("detailed Gantt", ".roadmap-stage-chart[data-viz-kind='gantt'][data-viz-variant='gantt']"),
              required("label column", ".roadmap-label-column"),
              required("timeline column", ".roadmap-timeline-column"),
              required("phase track", ".roadmap-phase-track"),
              required("phase bands", ".roadmap-phase-band", 1, 10),
              required("timeline axis", ".roadmap-week-track"),
              required("workstream", ".roadmap-workstream-row", 1, 14),
              required("workstream bars", ".roadmap-workstream-bar", 1, 14),
              required("gate lines", ".roadmap-gate-line", 1, 10),
              required("gate outcomes", ".roadmap-gate-card", 1, 10),
              required("scenario disclosure", ".roadmap-stage-disclosure"),
            ] },
            { when: ":scope > .page-body > .semantic-layout:not(.roadmap-stage-layout)", requirements: [
              required("roadmap semantic note", ".semantic-note"),
              required("milestone or pending Gantt", ".viz-canvas[data-viz-kind='gantt'][data-viz-variant='milestone'],.viz-canvas[data-viz-kind='gantt'][data-viz-variant='pending']"),
              required("roadmap milestone or question nodes", "[data-node-id]", 1, 12),
            ] },
          ],
        },
        project_price: { requirements: [
          required("root", ":scope > .page-body > .project-price-layout"),
          required("price ledger", ".project-price-ledger"),
          required("price summary", ".project-price-summary"),
          required("price summary copy", ".project-price-summary-copy"),
          required("price summary meta", ".project-price-summary-meta"),
          required("scenario disclosure", "[data-price-scenario-disclosure='true']"),
          required("price head", ".project-price-head"),
          required("price head cells", ".project-price-head > .project-price-cell", 5, 5),
          required("price rows", ".project-price-row", 1, 8),
          required("price item cells", ".project-price-row [data-price-field='item']", 1, 8),
          required("price quantity cells", ".project-price-row [data-price-field='quantity']", 1, 8),
          required("price duration cells", ".project-price-row [data-price-field='duration']", 1, 8),
          required("price rate cells", ".project-price-row [data-price-field='unit_rate']", 1, 8),
          required("price amount cells", ".project-price-row [data-price-field='amount']", 1, 8),
          required("price total", "[data-project-price-total='true']"),
          required("price total label", ".project-price-total-label"),
          required("price total value", ".project-price-total-value"),
          required("commercial terms", ".project-price-term", 4, 4),
        ] },
        payments: {
          requirements: [required("root", ":scope > .page-body > .payment-layout"), required("payment total", ".payment-total")],
          oneOf: [":scope > .page-body > .payment-layout[data-payment-schedule='true']", ":scope > .page-body > .payment-layout > .missing-state"],
          stateRequirements: [
            { when: ".payment-layout[data-payment-schedule='true']", requirements: [
              required("payment table", ".payment-layout > .panel"),
              required("payment head", ".payment-head"),
              required("payment head cells", ".payment-head > span", 3, 3),
              required("payment rows", ".payment-row", 1, 12),
              required("payment row descriptions", ".payment-row > div", 1, 12),
              required("payment row values", ".payment-row > span", 2, 24),
            ] },
            { when: ".payment-layout > .missing-state", requirements: missingStateRequirements(3, 3) },
          ],
        },
        close: {
          requirements: [
            required("root", ":scope > .page-body > .decision-layout"),
            required("decision list", ".decision-list"),
            required("decision table head", ".decision-list > .table-head"),
            required("decision table head cells", ".decision-list > .table-head > span", 4, 4),
            required("decision row", ".decision-row", 3, 3),
            required("decision outcome", ".decision-row > strong", 3, 3),
            required("decision owner", ".decision-row > p", 3, 3),
            required("decision status", ".decision-status", 3, 3),
            required("next action", ".next-action"),
            required("next action title", ".next-action > strong"),
            required("next action detail", ".next-action > p"),
          ],
          oneOf: [".close-blockers", ".close-assumptions"],
          stateRequirements: [
            { when: ".close-blockers", requirements: [required("close blockers", ".close-blocker[data-close-blocker='true']", 1, 32)] },
            { when: ".close-assumptions", requirements: [required("meeting outcome rows", ".close-assumptions > p", 3, 3)] },
          ],
        },
      };
      return contracts[kind] || null;
    }
    function required(role, selector, min = 1, max = min) {
      return { role, selector, min, max };
    }
    function visibleTokenInventory(element, limit = 250) {
      const text = normalizedVisibleText(element).normalize("NFKC").toLowerCase();
      const tokens = [];
      const seen = new Set();
      for (const match of text.matchAll(/[\p{L}\p{N}]+(?:[-'’ʻ][\p{L}\p{N}]+)*/gu)) {
        const token = match[0];
        if (Array.from(token).length < 3 || seen.has(token)) continue;
        seen.add(token);
        tokens.push(token);
        if (tokens.length >= limit) break;
      }
      return tokens;
    }
    function chapterRequirements(index) {
      return [
        required("root", ":scope > .page-body > .chapter-layout"),
        required("chapter index", ".chapter-index"),
        required("chapter index label", ".chapter-index > span"),
        required("chapter index number " + index, ".chapter-index > strong"),
        required("chapter copy", ".chapter-copy"),
        required("chapter copy title", ".chapter-copy > strong"),
        required("chapter copy detail", ".chapter-copy > p"),
        required("driver", ".driver", 3, 3),
        required("driver index", ".driver > span", 3, 3),
        required("driver detail", ".driver > p", 3, 3),
      ];
    }
    function semanticRequirements(vizKind, options = {}) {
      const minimumNodes = Number(options.minimumNodes || 1);
      const minimumEdges = Number(options.minimumEdges || 0);
      const maximumNodes = Number(options.maximumNodes || 30);
      const maximumEdges = Number(options.maximumEdges || 40);
      const canvas = ".viz-canvas[data-viz-kind='" + vizKind + "']";
      const activeCanvas = canvas + ":not([data-data-state='pending']):not([data-viz-variant='questions']):not([data-viz-variant='pending'])";
      const pendingCanvas = canvas + "[data-data-state='pending']," + canvas + "[data-viz-variant='questions']," + canvas + "[data-viz-variant='pending']";
      return {
        requirements: [
          required("root", ":scope > .page-body > .semantic-layout"),
          required("visualization", canvas),
          required("semantic note", ".semantic-note"),
          required("semantic note label", ".semantic-note > span"),
          required("semantic note detail", ".semantic-note > p"),
        ],
        oneOf: [activeCanvas, pendingCanvas],
        stateRequirements: [
          { when: activeCanvas, requirements: [
            required("semantic nodes", "[data-node-id]", minimumNodes, maximumNodes),
            ...(minimumEdges ? [required("semantic edges", "[data-geometry-role='edge'][data-edge-id]", minimumEdges, maximumEdges)] : []),
            ...(options.extra || []),
          ] },
          { when: pendingCanvas, requirements: [required("semantic decision questions", "[data-node-id]", 1, 12)] },
        ],
      };
    }
    function missingStateRequirements(minimumQuestions, maximumQuestions) {
      return [
        required("missing state title", ".missing-state > div:first-child > strong"),
        required("missing state detail", ".missing-state > div:first-child > p"),
        required("question list", ".missing-state > .question-list"),
        required("question rows", ".missing-state .question-row", minimumQuestions, maximumQuestions),
        required("question labels", ".missing-state .question-row > span", minimumQuestions, maximumQuestions),
        required("question copy", ".missing-state .question-row > strong", minimumQuestions, maximumQuestions),
      ];
    }
    function visibleOwnTextElements(pageElement) {
      return [...pageElement.querySelectorAll(".page-header *, .page-title-row *, .page-body *, .page-footer *")]
        .filter((element) => isVisible(element) && ownVisibleText(element));
    }
    function ownVisibleText(element) {
      return [...(element?.childNodes || [])]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    }
    function textContrastRatio(element) {
      const foreground = parseCssColor(getComputedStyle(element).color);
      if (!foreground || foreground.a < .95) return null;
      let background = { r: 255, g: 255, b: 255, a: 1 };
      const ancestors = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE) {
        ancestors.push(current);
        current = current.parentElement;
      }
      for (const ancestor of ancestors.reverse()) {
        const color = parseCssColor(getComputedStyle(ancestor).backgroundColor);
        if (color && color.a > 0) background = compositeColor(color, background);
      }
      return contrastRatio(foreground, background);
    }
    function forcedWordBreaks(element) {
      const output = [];
      for (const node of element.childNodes || []) {
        if (node.nodeType !== Node.TEXT_NODE) continue;
        const text = node.textContent || "";
        for (const match of text.matchAll(/[\p{L}\p{N}]+(?:[-'’ʻ][\p{L}\p{N}]+)*/gu)) {
          const word = match[0];
          if (Array.from(word).length < 5) continue;
          const citationUrlPath = element.matches(".source-chip,[data-content-role='citation']") && text[match.index - 1] === "/";
          if (citationUrlPath) continue;
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + word.length);
          const lines = [];
          for (const rect of range.getClientRects()) {
            if (rect.width <= .5 || rect.height <= .5) continue;
            if (!lines.some((top) => Math.abs(top - rect.top) <= 1)) lines.push(rect.top);
          }
          if (lines.length > 1) output.push(word);
        }
      }
      return output;
    }
    function parseCssColor(value) {
      const match = String(value || "").match(/rgba?\(\s*([0-9.]+)[, ]+([0-9.]+)[, ]+([0-9.]+)(?:\s*[,/]\s*([0-9.]+))?\s*\)/i);
      if (!match) return null;
      return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4]) };
    }
    function compositeColor(foreground, background) {
      const alpha = foreground.a + background.a * (1 - foreground.a);
      if (alpha <= 0) return { r: 255, g: 255, b: 255, a: 1 };
      return {
        r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
        g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
        b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
        a: alpha,
      };
    }
    function contrastRatio(left, right) {
      const l1 = relativeLuminance(left);
      const l2 = relativeLuminance(right);
      return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
    }
    function relativeLuminance(color) {
      const channel = (value) => {
        const normalized = Math.max(0, Math.min(255, value)) / 255;
        return normalized <= .03928 ? normalized / 12.92 : Math.pow((normalized + .055) / 1.055, 2.4);
      };
      return .2126 * channel(color.r) + .7152 * channel(color.g) + .0722 * channel(color.b);
    }
    function numericFontWeight(value) {
      if (value === "bold" || value === "bolder") return 700;
      const number = Number(value);
      return Number.isFinite(number) ? number : 400;
    }
    function rectInside(inner, outer, tolerance = 0) {
      return inner.left >= outer.left - tolerance && inner.top >= outer.top - tolerance && inner.right <= outer.right + tolerance && inner.bottom <= outer.bottom + tolerance;
    }
    function near(value, expected, tolerance = 0) {
      return Math.abs(Number(value) - Number(expected)) <= tolerance;
    }
    function compactRect(rect) {
      return { x: round(rect.left), y: round(rect.top), width: round(rect.width), height: round(rect.height), right: round(rect.right), bottom: round(rect.bottom) };
    }
    function round(value) {
      return Math.round(Number(value) * 100) / 100;
    }
    function classLabel(element) {
      return String(element?.className?.baseVal || element?.className || element?.tagName || "").trim().slice(0, 160);
    }
    function elementLabel(element) {
      const className = classLabel(element).replace(/\s+/g, ".");
      return String(element?.tagName || "element").toLowerCase() + (className ? "." + className : "");
    }
    function measureVisualFeatures(pageElements) {
      const pageRects = pageElements.map((element) => element.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0);
      const titleElements = [...document.querySelectorAll(".page-title,h1")].filter(isVisible);
      const bodyElements = [...document.querySelectorAll(".page-body p,.page-body li")].filter(isVisible);
      const metadataElements = [...document.querySelectorAll(".eyebrow,.status,.page-badge,.page-number")].filter(isVisible);
      const titleStyles = titleElements.map(computedTextMetrics);
      const bodyStyles = bodyElements.map(computedTextMetrics);
      const metadataStyles = metadataElements.map(computedTextMetrics);
      const titleSize = median(titleStyles.map((row) => row.fontSize));
      const bodySize = median(bodyStyles.map((row) => row.fontSize));
      const metadataSize = median(metadataStyles.map((row) => row.fontSize));
      const blockSelector = ".page-title-row, .page-body > *, .panel, .panel-soft, .viz-canvas, .chapter-layout, .cover-grid";
      const blocks = [...document.querySelectorAll(blockSelector)].filter(isVisible);
      const coverage = pageRects.length ? mean(pageRects.map((pageRect, pageIndex) => {
        const localBlocks = blocks.filter((element) => pageElements[pageIndex]?.contains(element));
        if (!localBlocks.length) return 0;
        let occupied = 0;
        const columns = 30; const rows = 20;
        for (let y = 0; y < rows; y += 1) {
          for (let x = 0; x < columns; x += 1) {
            const px = pageRect.left + ((x + 0.5) / columns) * pageRect.width;
            const py = pageRect.top + ((y + 0.5) / rows) * pageRect.height;
            if (localBlocks.some((element) => pointInRect(px, py, element.getBoundingClientRect()))) occupied += 1;
          }
        }
        return occupied / (columns * rows);
      })) : 0;
      const gutters = pageElements.map((element) => {
        const pageRect = element.getBoundingClientRect();
        const content = element.querySelector(".page-body")?.getBoundingClientRect();
        return content && pageRect.width ? Math.max(0, content.left - pageRect.left) / pageRect.width : null;
      }).filter(Number.isFinite);
      const layoutRegionSamples = [];
      pageElements.forEach((element) => {
        const pageRect = element.getBoundingClientRect();
        if (!pageRect.width || !pageRect.height) return;
        for (const [role, selector] of [["headline", ".page-title"], ["content", ".page-body"]]) {
          const rect = element.querySelector(selector)?.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) continue;
          layoutRegionSamples.push({
            role,
            x: (rect.left - pageRect.left) / pageRect.width,
            y: (rect.top - pageRect.top) / pageRect.height,
            w: rect.width / pageRect.width,
            h: rect.height / pageRect.height,
          });
        }
      });
      const rhythms = [];
      const blocksPerPage = [];
      pageElements.forEach((element) => {
        const pageRect = element.getBoundingClientRect();
        const localBlocks = blocks.filter((block) => element.contains(block));
        const rows = localBlocks.map((child) => child.getBoundingClientRect()).sort((a, b) => a.top - b.top || a.left - b.left);
        blocksPerPage.push(rows.length);
        for (let index = 1; index < rows.length; index += 1) {
          const gap = Math.max(0, rows[index].top - rows[index - 1].bottom);
          if (pageRect.height) rhythms.push(gap / pageRect.height);
        }
      });
      const geometryElements = [...document.querySelectorAll(".panel,.panel-soft,.metric,.status,.quadrant,[data-node-id]")].filter(isVisible);
      const radii = geometryElements.map((element) => parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0);
      const borderCount = geometryElements.filter((element) => {
        const style = getComputedStyle(element);
        return (parseFloat(style.borderTopWidth) || 0) > 0 && style.borderTopColor !== "rgba(0, 0, 0, 0)";
      }).length;
      const shadowCount = geometryElements.filter((element) => getComputedStyle(element).boxShadow !== "none").length;
      const connectedCount = geometryElements.filter((element) => {
        const style = getComputedStyle(element);
        const noBorder = (parseFloat(style.borderTopWidth) || 0) === 0;
        const transparent = style.backgroundColor === "rgba(0, 0, 0, 0)" || style.backgroundColor === "transparent";
        return noBorder && transparent;
      }).length;
      const media = [...document.querySelectorAll("img,picture,video,.media-region,[data-imagery-role]")].filter(isVisible);
      const mediaArea = media.reduce((sum, element) => {
        const rect = element.getBoundingClientRect();
        return sum + rect.width * rect.height;
      }, 0);
      const pageArea = pageRects.reduce((sum, rect) => sum + rect.width * rect.height, 0);
      const gradientDecorations = pageElements.filter((element) => {
        const own = getComputedStyle(element).backgroundImage;
        const before = getComputedStyle(element, "::before").backgroundImage;
        return /gradient/i.test(`${own} ${before}`);
      }).length;
      const semanticElements = [...document.querySelectorAll("[data-semantic-role]")].filter(isVisible);
      const styledSemanticElements = semanticElements.filter((element) => {
        const style = getComputedStyle(element);
        return style.fill !== "none" || style.stroke !== "none" || !["transparent", "rgba(0, 0, 0, 0)"].includes(style.backgroundColor);
      });
      return {
        palette: {
          semanticPlacementSim: semanticElements.length ? styledSemanticElements.length / semanticElements.length : 1,
        },
        layout: { whitespaceRatio: clamp01(1 - coverage), regions: summarizeRegions(layoutRegionSamples) },
        typography: {
          displayClass: fontClass(titleStyles[0]?.fontFamily),
          bodyClass: fontClass(bodyStyles[0]?.fontFamily),
          metadataClass: fontClass(metadataStyles[0]?.fontFamily),
          displayFamilies: fontFamilyList(titleStyles[0]?.fontFamily),
          bodyFamilies: fontFamilyList(bodyStyles[0]?.fontFamily),
          metadataFamilies: fontFamilyList(metadataStyles[0]?.fontFamily),
          displayResolvedFamily: resolvedFontFamily(titleStyles[0]?.fontFamily, titleStyles[0]?.fontWeight),
          bodyResolvedFamily: resolvedFontFamily(bodyStyles[0]?.fontFamily, bodyStyles[0]?.fontWeight),
          metadataResolvedFamily: resolvedFontFamily(metadataStyles[0]?.fontFamily, metadataStyles[0]?.fontWeight),
          displayPrimaryAvailable: primaryFontAvailable(titleStyles[0]?.fontFamily, titleStyles[0]?.fontWeight),
          bodyPrimaryAvailable: primaryFontAvailable(bodyStyles[0]?.fontFamily, bodyStyles[0]?.fontWeight),
          metadataPrimaryAvailable: primaryFontAvailable(metadataStyles[0]?.fontFamily, metadataStyles[0]?.fontWeight),
          displayWeight: Math.round(median(titleStyles.map((row) => row.fontWeight)) || 0),
          bodyWeight: Math.round(median(bodyStyles.map((row) => row.fontWeight)) || 0),
          titleBodySizeRatio: bodySize ? titleSize / bodySize : null,
          bodyLineHeightRatio: bodySize ? median(bodyStyles.map((row) => row.lineHeight / Math.max(1, row.fontSize))) : null,
          metadataTrackingEm: metadataSize ? median(metadataStyles.map((row) => row.letterSpacing / Math.max(1, row.fontSize))) : null,
          headingCase: headingCase(titleElements.map((element) => element.textContent || "").join(" ")),
        },
        tone: { decorationAreaRatio: clamp01((gradientDecorations / Math.max(1, pageElements.length)) * 0.12) },
        density: {
          occupiedAreaRatio: clamp01(coverage),
          medianGutterToPageWidth: median(gutters),
          blocksPerPage: mean(blocksPerPage),
          verticalRhythmToPageHeight: median(rhythms) ?? ((median(gutters) || 0) * 1.2),
        },
        geometry: {
          radiusHistogram: radiusHistogram(radii),
          borderUsageRatio: geometryElements.length ? borderCount / geometryElements.length : 0,
          shadowUsageRatio: geometryElements.length ? shadowCount / geometryElements.length : 0,
          canvasRelationshipRatio: geometryElements.length ? connectedCount / geometryElements.length : 0,
        },
        imagery: {
          mode: media.length ? "mixed" : gradientDecorations ? "abstract_static" : "none",
          coverageRatio: pageArea ? clamp01(mediaArea / pageArea) : 0,
          cropMode: media.length ? "mixed" : "none",
          maskShape: "none",
          overlay: gradientDecorations ? "low_contrast" : "none",
          unapprovedMediaCount: [...document.querySelectorAll("img[src^='http'],img[src^='file:'],video,iframe")].length,
        },
      };
    }
    function computedTextMetrics(element) {
      const style = getComputedStyle(element);
      const fontSize = parseFloat(style.fontSize) || 0;
      const lineHeight = style.lineHeight === "normal" ? fontSize * 1.2 : parseFloat(style.lineHeight) || fontSize * 1.2;
      const fontWeight = Number(style.fontWeight) || ({ normal: 400, bold: 700 })[style.fontWeight] || 400;
      const letterSpacing = style.letterSpacing === "normal" ? 0 : parseFloat(style.letterSpacing) || 0;
      return { fontFamily: style.fontFamily, fontSize, lineHeight, fontWeight, letterSpacing };
    }
    function fontClass(value = "") {
      const family = String(value).toLowerCase();
      if (/mono|courier|consolas/.test(family)) return "monospace";
      if (/serif|times|georgia/.test(family) && !/sans-serif/.test(family)) return "transitional_serif";
      if (/arial|helvetica|inter|roboto|sans-serif/.test(family)) return "neo_grotesk_sans";
      return "humanist_sans";
    }
    function fontFamilyList(value = "") {
      return String(value || "")
        .split(",")
        .map((family) => family.trim().replace(/^['\"]|['\"]$/g, ""))
        .filter(Boolean)
        .slice(0, 8);
    }
    function primaryFontAvailable(value = "", weight = 400) {
      const primary = fontFamilyList(value)[0];
      return primary ? fontAvailable(primary, weight) : false;
    }
    function resolvedFontFamily(value = "", weight = 400) {
      return fontFamilyList(value).find((family) => fontAvailable(family, weight)) || null;
    }
    function fontResolutionForElement(element) {
      if (!element) return null;
      const style = getComputedStyle(element);
      const requestedStack = fontFamilyList(style.fontFamily);
      const requestedPrimary = requestedStack[0] || null;
      const weight = Number(style.fontWeight) || ({ normal: 400, bold: 700 })[style.fontWeight] || 400;
      return {
        requestedStack,
        requestedPrimary,
        primaryAvailable: requestedPrimary ? fontAvailable(requestedPrimary, weight) : false,
        resolvedFamily: resolvedFontFamily(style.fontFamily, weight),
        weight,
      };
    }
    function fontAvailable(family, weight = 400) {
      const normalized = String(family || "").trim().toLowerCase();
      if (!normalized) return false;
      if (["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "-apple-system"].includes(normalized)) return true;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return false;
      const escaped = String(family).replace(/["\\]/g, "\\$&");
      const probes = ["mmmmmmmmmmlliWW00", "ЖЩЮЙфы09", "漢字かなABC123"];
      return ["monospace", "serif"].some((baseline) => probes.some((probe) => {
        context.font = `${Number(weight) || 400} 72px ${baseline}`;
        const baseWidth = context.measureText(probe).width;
        context.font = `${Number(weight) || 400} 72px "${escaped}", ${baseline}`;
        return Math.abs(context.measureText(probe).width - baseWidth) > 0.1;
      }));
    }
    function headingCase(value = "") {
      const letters = String(value).replace(/[^A-Za-zА-Яа-яЁё]+/g, "");
      if (!letters) return "mixed";
      if (letters === letters.toUpperCase()) return "upper";
      if (letters === letters.toLowerCase()) return "lower";
      const words = String(value).trim().split(/\s+/).filter(Boolean);
      const titleWords = words.filter((word) => /^[A-ZА-ЯЁ]/.test(word)).length;
      return titleWords / Math.max(1, words.length) > 0.75 ? "title" : "sentence";
    }
    function radiusHistogram(values) {
      const output = { "0_2": 0, "3_7": 0, "8_15": 0, "16_plus": 0 };
      values.forEach((value) => {
        if (value <= 2) output["0_2"] += 1;
        else if (value <= 7) output["3_7"] += 1;
        else if (value <= 15) output["8_15"] += 1;
        else output["16_plus"] += 1;
      });
      return output;
    }
    function summarizeRegions(rows) {
      const roles = [...new Set(rows.map((row) => row.role))];
      return roles.map((role) => {
        const matches = rows.filter((row) => row.role === role);
        return {
          id: `generated-${role}`,
          role,
          x: median(matches.map((row) => row.x)),
          y: median(matches.map((row) => row.y)),
          w: median(matches.map((row) => row.w)),
          h: median(matches.map((row) => row.h)),
        };
      });
    }
    function pointInRect(x, y, rect) {
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }
    function isVisible(element) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }
    function median(values) {
      const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
      if (!finite.length) return null;
      const middle = Math.floor(finite.length / 2);
      return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
    }
    function mean(values) {
      const finite = values.map(Number).filter(Number.isFinite);
      return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0;
    }
    function clamp01(value) {
      return Math.max(0, Math.min(1, Number(value) || 0));
    }
    function pathPoints(d) {
      // Q control points are included so a rounded corner is checked against
      // its containing control polygon (the curve never leaves that hull).
      const points = [];
      for (const match of String(d).matchAll(/([MLQ])\s*([0-9.-]+),([0-9.-]+)(?:\s+([0-9.-]+),([0-9.-]+))?/g)) {
        points.push({ x: Number(match[2]), y: Number(match[3]) });
        if (match[1] === "Q" && match[4] !== undefined) points.push({ x: Number(match[4]), y: Number(match[5]) });
      }
      return points;
    }
    function pointToRectDistance(point, rect) {
      const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.w));
      const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.h));
      return Math.hypot(dx, dy);
    }
    function rectsOverlap(a, b, gap = 0) {
      return !(a.right + gap <= b.left || b.right + gap <= a.left || a.bottom + gap <= b.top || b.bottom + gap <= a.top);
    }
    function shrinkRect(rect, px) {
      return { x: rect.x + px, y: rect.y + px, w: Math.max(0, rect.w - px * 2), h: Math.max(0, rect.h - px * 2) };
    }
    function segmentIntersectsRect(segment, rect) {
      const [a, b] = segment;
      const inside = (p) => p.x > rect.x && p.x < rect.x + rect.w && p.y > rect.y && p.y < rect.y + rect.h;
      if (inside(a) || inside(b)) return true;
      const edges = [
        [{ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y }],
        [{ x: rect.x + rect.w, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h }],
        [{ x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h }],
        [{ x: rect.x, y: rect.y + rect.h }, { x: rect.x, y: rect.y }],
      ];
      return edges.some((edge) => segmentsIntersect(a, b, edge[0], edge[1]));
    }
    function segmentsIntersect(a, b, c, d) {
      const ccw = (p1, p2, p3) => (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
      return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
    }
    function inspectClientContentPolicy(pageElements, currentPlan, languageMetrics) {
      const output = [];
      const metrics = {
        enabled: isNewClientProposalPlan(currentPlan),
        policyVersion: "1.0",
        plannedPageCount: 0,
        checkedPageCount: 0,
        passedPageCount: 0,
        failedPageCount: 0,
        perPage: [],
        annotatedFactualClaimCount: 0,
        inlineCitationCount: 0,
        warningStatusOccurrences: 0,
        internalTerminologyCount: 0,
        paymentSchedulePageCount: 0,
        factualOriginRequiredPageCount: 0,
        factualOriginMissingPageCount: 0,
      };
      if (!metrics.enabled) return { findings: output, metrics };

      const planPages = Array.isArray(currentPlan?.pages) ? currentPlan.pages : [];
      metrics.plannedPageCount = planPages.length;
      metrics.checkedPageCount = pageElements.length;
      metrics.perPage = pageElements.map((pageElement) => {
        const planned = planPages.find((row) => Number(row?.pageNumber) === Number(pageElement.dataset.pageNumber)) || {};
        return {
          page: Number(pageElement.dataset.pageNumber) || null,
          kind: String(pageElement.dataset.pageKind || planned.kind || planned.pageKind || "") || null,
        };
      });
      const pagePlan = (pageElement) => planPages.find((row) => Number(row?.pageNumber) === Number(pageElement.dataset.pageNumber)) || {};
      for (const pageElement of pageElements) {
        const planned = pagePlan(pageElement);
        const kind = String(pageElement.dataset.pageKind || planned.kind || planned.pageKind || "").trim().toLowerCase();
        const pageNumber = Number(pageElement.dataset.pageNumber) || Number(planned.pageNumber) || null;
        const heading = normalizedVisibleText(pageElement.querySelector(".page-title,h1,h2,h3,.slide-title"));
        if (["sources", "source_list", "references", "reference_sources"].includes(kind) || isStandaloneSourceHeading(heading)) {
          output.push({
            code: "DOM_STANDALONE_SOURCE_LIST_VISIBLE",
            severity: "BLOCKER",
            page: pageNumber,
            message: "Client proposal must place sources beside the relevant facts instead of using a standalone source page",
            evidence: { kind: kind || null, heading: heading || null },
          });
        }
        if (kind === "design_project" || isDesignProjectHeading(heading)) {
          output.push({
            code: "DOM_DESIGN_PROJECT_PAGE_VISIBLE",
            severity: "BLOCKER",
            page: pageNumber,
            message: "A standalone internal Design Project page is not allowed in the client proposal",
            evidence: { kind: kind || null, heading: heading || null },
          });
        }
      }

      const warningDensity = inspectWarningStatusDensity(pageElements);
      metrics.warningStatusOccurrences = warningDensity.total;
      if (warningDensity.excess.length || warningDensity.duplicateStatuses.length) {
        output.push({
          code: "DOM_WARNING_STATUS_DENSITY_HIGH",
          severity: "ERROR",
          message: "Client-visible warnings or confirmation statuses are repeated too densely",
          evidence: {
            pageCount: pageElements.length,
            families: warningDensity.families,
            limits: warningDensity.limits,
            excess: warningDensity.excess,
            duplicateStatuses: warningDensity.duplicateStatuses.slice(0, 8),
          },
        });
      }

      const declaredLanguage = String(languageMetrics?.declaredLanguage || document.documentElement.lang || "").toLowerCase();
      if (/^(?:uz|ru)(?:-|$)/.test(declaredLanguage)) {
        const terminologyMatches = [];
        for (const pageElement of pageElements) {
          const matches = clientProseText(pageElement).match(/\b(?:scope|discovery|roadmap|checkout|reconciliation|dashboard|kpi|mobile-first|push-based)\b/giu) || [];
          if (!matches.length) continue;
          terminologyMatches.push({
            page: Number(pageElement.dataset.pageNumber) || null,
            terms: [...new Set(matches.map((value) => value.toLowerCase()))],
            count: matches.length,
          });
        }
        metrics.internalTerminologyCount = terminologyMatches.reduce((sum, row) => sum + row.count, 0);
        if (terminologyMatches.length) {
          output.push({
            code: "DOM_INTERNAL_TERMINOLOGY_MIXED",
            severity: "ERROR",
            message: "Uzbek/Russian client copy contains untranslated internal product terminology",
            evidence: { declaredLanguage, pages: terminologyMatches.slice(0, 12) },
          });
        }
      }

      const factualClaims = [...document.querySelectorAll([
        "[data-factual-claim]",
        "[data-content-role='factual-claim']",
        "[data-claim-id][data-source-ids]",
        "[data-claim-id][data-source-id]",
      ].join(","))].filter(isVisible);
      metrics.annotatedFactualClaimCount = factualClaims.length;
      const claimsWithoutSourceIds = [];
      const claimsWithoutInlineCitation = [];
      for (const [index, claim] of factualClaims.entries()) {
        const claimId = String(claim.dataset.claimId || `claim-${index + 1}`);
        const sourceIds = sourceIdsFromElement(claim);
        const pageNumber = Number(claim.closest(".kp-page")?.dataset.pageNumber) || null;
        if (!sourceIds.length) {
          claimsWithoutSourceIds.push({ claimId, page: pageNumber });
          continue;
        }
        if (hasMatchingInlineCitation(claim, claimId, sourceIds)) metrics.inlineCitationCount += 1;
        else claimsWithoutInlineCitation.push({ claimId, page: pageNumber, sourceIds });
      }
      if (claimsWithoutSourceIds.length) {
        output.push({
          code: "DOM_FACTUAL_CLAIM_SOURCE_IDS_MISSING",
          severity: "ERROR",
          message: "A DOM-marked factual claim does not declare source IDs",
          evidence: { claims: claimsWithoutSourceIds.slice(0, 12) },
        });
      }
      if (claimsWithoutInlineCitation.length) {
        output.push({
          code: "DOM_INLINE_CITATION_MISSING",
          severity: "ERROR",
          message: "A DOM-marked factual claim does not show a matching source beside the claim",
          evidence: { claims: claimsWithoutInlineCitation.slice(0, 12) },
        });
      }

      const factualOriginGaps = [];
      for (const planned of planPages) {
        const contentClasses = Array.isArray(planned?.contentClasses) ? planned.contentClasses.map(String) : [];
        const expectedSourceIds = uniqueStrings(Array.isArray(planned?.sourceIds) ? planned.sourceIds : []);
        if (!contentClasses.includes("fact") || !expectedSourceIds.length) continue;
        metrics.factualOriginRequiredPageCount += 1;
        const pageElement = pageElements.find((element) => Number(element.dataset.pageNumber) === Number(planned.pageNumber));
        const candidates = pageElement ? [
          ...pageElement.querySelectorAll([
            "[data-content-origin][data-source-ids]",
            "[data-content-origin][data-source-id]",
            "[data-factual-claim][data-source-ids]",
            "[data-factual-claim][data-source-id]",
            "[data-truth-status][data-source-ids]",
            "[data-truth-status][data-source-id]",
            "[data-citation][data-source-id]",
            "[data-content-role='citation'][data-source-id]",
          ].join(",")),
        ].filter(isVisible) : [];
        const matchedSourceIds = uniqueStrings(candidates.flatMap((element) => sourceIdsFromElement(element))).filter((sourceId) => expectedSourceIds.includes(sourceId));
        if (!matchedSourceIds.length) {
          factualOriginGaps.push({
            page: Number(planned.pageNumber) || null,
            kind: planned.kind || planned.pageKind || null,
            expectedSourceIds,
            pagePresent: Boolean(pageElement),
          });
        }
      }
      metrics.factualOriginMissingPageCount = factualOriginGaps.length;
      for (const gap of factualOriginGaps) {
        output.push({
          code: "DOM_FACTUAL_CONTENT_ORIGIN_MISSING",
          severity: "BLOCKER",
          page: gap.page,
          message: "A page declared as factual has no visible DOM content bound to its planned sources",
          evidence: gap,
        });
      }

      const paymentPages = pageElements.filter((pageElement) => {
        const planned = pagePlan(pageElement);
        const kind = String(pageElement.dataset.pageKind || planned.kind || planned.pageKind || "").toLowerCase();
        return kind === "payments" || Boolean(pageElement.querySelector("[data-payment-schedule]"));
      });
      metrics.paymentSchedulePageCount = paymentPages.length;
      for (const paymentPage of paymentPages) {
        const planned = pagePlan(paymentPage);
        const renderedSchedule = Boolean(paymentPage.querySelector("[data-payment-schedule='true']"));
        // A baseline commercial page may honestly state that the schedule is
        // still missing. It is not a visible payment schedule and therefore
        // must not be rejected as an unrequested modeled schedule.
        if (!renderedSchedule) continue;
        const explicitRequest = paymentPage.dataset.explicitlyRequested === "true"
          || planned.explicitlyRequested === true
          || (planned.selectionReasons || []).includes("explicitly_requested_in_prompt")
          || currentPlan?.diagnostics?.pageDecisions?.some((row) => row?.kind === "payments" && row?.explicitlyRequested === true);
        // A schedule reconciled to the client's explicitly stated budget is a
        // sanctioned planning scenario: it restates the client's own figure in
        // stages and must carry exactly one scenario disclosure below.
        const budgetScenario = (planned.selectionReasons || []).includes("budget_based_payment_scenario_available")
          || currentPlan?.diagnostics?.pageDecisions?.some((row) => row?.kind === "payments"
            && (row?.reasons || row?.selectionReasons || []).includes("budget_based_payment_scenario_available"));
        const assumedByDom = Boolean(paymentPage.querySelector([
          "[data-payment-truth-status='assumed']",
          "[data-payment-truth-status='modeled']",
          "[data-payment-truth-status='inferred']",
          "[data-payment-schedule][data-truth-status='assumed']",
          "[data-payment-schedule][data-truth-status='modeled']",
          "[data-payment-schedule][data-truth-status='inferred']",
          "[data-truth-status='assumed']",
        ].join(",")));
        const assumedByPlan = (planned.contentClasses || []).some((value) => ["model", "recommendation"].includes(String(value)))
          || planned.fallbackMode === "transparent_model";
        if (explicitRequest || budgetScenario) {
          if (assumedByDom || assumedByPlan) {
            const markedDisclosures = paymentPage.querySelectorAll("[data-payment-scenario-disclosure]").length;
            const disclosureCount = markedDisclosures || countMatches(paymentPage.innerText || "", /(?:planning\s+scenario|rejalashtirish\s+ssenariysi|сценарий\s+планирования)/giu);
            if (disclosureCount !== 1) {
              output.push({
                code: disclosureCount ? "DOM_PAYMENT_SCENARIO_DISCLOSURE_REPEATED" : "DOM_PAYMENT_SCENARIO_DISCLOSURE_MISSING",
                severity: "ERROR",
                page: Number(paymentPage.dataset.pageNumber) || Number(planned.pageNumber) || null,
                message: "A model payment schedule must have one concise scenario disclosure",
                evidence: { disclosureCount, assumedByDom, assumedByPlan, explicitRequest, budgetScenario },
              });
            }
          }
          continue;
        }
        output.push({
          code: assumedByDom || assumedByPlan ? "DOM_ASSUMED_PAYMENT_SCHEDULE_VISIBLE" : "DOM_PAYMENT_SCHEDULE_UNREQUESTED",
          severity: "BLOCKER",
          page: Number(paymentPage.dataset.pageNumber) || Number(planned.pageNumber) || null,
          message: "A payment schedule is visible without an explicit client request",
          evidence: { assumedByDom, assumedByPlan },
        });
      }
      const failedPages = new Set(output.map((finding) => Number(finding.page)).filter((page) => Number.isInteger(page) && page > 0));
      metrics.failedPageCount = failedPages.size;
      metrics.passedPageCount = Math.max(0, metrics.checkedPageCount - metrics.failedPageCount);
      metrics.perPage = metrics.perPage.map((row) => ({ ...row, passed: !failedPages.has(row.page) }));
      return { findings: output, metrics };
    }
    function isNewClientProposalPlan(value) {
      return String(value?.schemaVersion || "") === "1.0" || String(value?.planId || "").startsWith("PPLAN-");
    }
    function isStandaloneSourceHeading(value) {
      const heading = String(value || "").toLowerCase().replace(/[.:—–-]+$/g, "").trim();
      return /^(?:sources?|source list|references|reference sources|readable sources|источники|список источников|источники и ссылки|manbalar|manbalar ro['’]?yxati|dalil manbalari)$/iu.test(heading);
    }
    function isDesignProjectHeading(value) {
      const heading = String(value || "").toLowerCase().replace(/[.:—–-]+$/g, "").trim();
      return /^(?:design project|design direction|дизайн[- ]?проект|дизайн проекта|dizayn loyihasi)$/iu.test(heading);
    }
    function inspectWarningStatusDensity(pageElements) {
      const text = pageElements.map((element) => {
        const clone = element.cloneNode(true);
        // The single Hero currency fact is structured data, not a repeated
        // narrative warning.
        clone.querySelectorAll(".cover-budget-currency").forEach((node) => node.remove());
        return clone.innerText || clone.textContent || "";
      }).join("\n");
      const families = {
        confirmation: countMatches(text, /(?:tasdiqlash\s+kerak|tasdiq(?:lash)?\s+talab|confirmation\s+required|requires?\s+confirmation|confirm(?:ation)?\s+(?:required|needed)|нужно\s+подтвердить|требует\s+подтверждения)/giu),
        assumption: countMatches(text, /(?:\btaxmin(?:iy)?\b|\bassum(?:ption|ed)\b|предположени\p{L}*|допущени\p{L}*)/giu),
        recommendation: countMatches(text, /(?:tavsiya\s+etilgan|\brecommended\b|рекомендован\p{L}*)/giu),
        missingInput: countMatches(text, /(?:not\s+supplied|not\s+confirmed|ko['’]?rsatilmagan|tasdiqlanmagan|не\s+указан\p{L}*|не\s+подтвержд[её]н\p{L}*)/giu),
      };
      const limits = {
        // Dynamic proposals may legitimately carry one confirmation at each
        // major decision surface. Density is measured against deck length,
        // rather than the old compact-deck ceiling.
        confirmation: Math.max(3, Math.ceil(pageElements.length / 3)),
        assumption: 4,
        recommendation: Math.max(5, Math.ceil(pageElements.length * 1.25)),
        missingInput: 4,
      };
      const excess = Object.entries(families).filter(([family, count]) => count > limits[family]).map(([family, count]) => ({ family, count, limit: limits[family] }));
      const statusTexts = [...document.querySelectorAll(".status,.page-badge,.scenario-banner,.warning,.notice,[data-warning-status]")]
        .filter(isVisible)
        .map(normalizedVisibleText)
        .map((value) => value.toLowerCase())
        .filter((value) => value.length >= 3 && value.length <= 120);
      const repeated = new Map();
      statusTexts.forEach((value) => repeated.set(value, (repeated.get(value) || 0) + 1));
      const duplicateStatuses = [...repeated.entries()].filter(([, count]) => count > 3).map(([textValue, count]) => ({ text: textValue, count }));
      return { families, limits, excess, duplicateStatuses, total: Object.values(families).reduce((sum, count) => sum + count, 0) };
    }
    function clientProseText(element) {
      const clone = element.cloneNode(true);
      clone.querySelectorAll([
        "[data-brand]",
        ".brand-name",
        ".brand-mark",
        ".logo",
        "[data-citation]",
        "[data-content-role='citation']",
        "[data-content-role='source']",
        ".source-chip",
        ".source-citation",
        ".source-url",
        ".inline-citation",
        ".citation",
        "[data-allow-foreign-term]",
      ].join(",")).forEach((node) => node.remove());
      return String(clone.innerText || clone.textContent || "")
        .replace(/https?:\/\/\S+|www\.\S+|\b\S+@\S+\.\S+\b/giu, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    function sourceIdsFromElement(element) {
      return uniqueStrings([
        ...parseSourceIds(element.getAttribute("data-source-ids")),
        ...parseSourceIds(element.getAttribute("data-source-id")),
      ]);
    }
    function parseSourceIds(value) {
      const raw = String(value || "").trim();
      if (!raw) return [];
      if (raw.startsWith("[")) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
        } catch {}
      }
      return raw.split(/[\s,|;]+/).map((item) => item.trim()).filter(Boolean);
    }
    function hasMatchingInlineCitation(claim, claimId, sourceIds) {
      const pageElement = claim.closest(".kp-page") || document;
      const candidates = new Set([
        ...claim.querySelectorAll("[data-citation],[data-citation-for],[data-citation-ids],.source-chip,.source-citation,.inline-citation,.citation"),
      ]);
      const next = claim.nextElementSibling;
      if (next?.matches?.("[data-citation],[data-citation-for],[data-citation-ids],.source-chip,.source-citation,.inline-citation,.citation")) candidates.add(next);
      const container = claim.closest("[data-claim-container],.fact-row,.claim-row,.evidence-row,.metric");
      if (container) container.querySelectorAll("[data-citation],[data-citation-for],[data-citation-ids],.source-chip,.source-citation,.inline-citation,.citation").forEach((item) => candidates.add(item));
      if (claimId) pageElement.querySelectorAll("[data-citation-for]").forEach((item) => {
        if (parseSourceIds(item.getAttribute("data-citation-for")).includes(claimId)) candidates.add(item);
      });
      return [...candidates].filter(isActuallyVisibleCitation).some((citation) => {
        const citationFor = parseSourceIds(citation.getAttribute("data-citation-for"));
        if (claimId && citationFor.includes(claimId)) return true;
        const citationIds = uniqueStrings([
          ...sourceIdsFromElement(citation),
          ...parseSourceIds(citation.getAttribute("data-citation-ids")),
        ]);
        return citationIds.some((sourceId) => sourceIds.includes(sourceId));
      });
    }
    function isActuallyVisibleCitation(element) {
      if (!isVisible(element) || !normalizedVisibleText(element)) return false;
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE) {
        const style = getComputedStyle(current);
        if (style.display === "none" || ["hidden", "collapse"].includes(style.visibility) || Number(style.opacity) <= 0.01) return false;
        current = current.parentElement;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1 || !element.getClientRects().length) return false;
      const style = getComputedStyle(element);
      if (style.color === "transparent" || /rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/i.test(style.color)) return false;
      return true;
    }
    function normalizedVisibleText(element) {
      return String(element?.innerText || element?.textContent || "").replace(/\s+/g, " ").trim();
    }
    function countMatches(value, pattern) {
      return [...String(value || "").matchAll(pattern)].length;
    }
    function uniqueStrings(values) {
      return [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))];
    }
    function inspectUnsafeMarkup() {
      const unsafe = [];
      const allowedTags = new Set(["HTML", "HEAD", "BODY", "TITLE", "META", "STYLE", "SCRIPT", "MAIN", "SECTION", "HEADER", "SPAN", "STRONG", "DIV", "H1", "P", "A", "IMG", "TABLE", "CAPTION", "THEAD", "TBODY", "TFOOT", "TR", "TH", "TD", "SVG", "DEFS", "MARKER", "PATH", "SMALL"]);
      const allowedAttrs = new Set(["class", "lang", "name", "scope", "colspan", "data-renderer-version", "data-page-number", "data-page-kind", "data-page-composition", "data-layout-family", "data-viz-id", "data-viz-kind", "data-viz-variant", "data-viz-density", "data-data-state", "data-geometry-role", "data-node-id", "data-node-type", "data-semantic-role", "data-group-id", "data-lane", "data-lane-id", "data-truth-status", "data-inclusion", "data-edge-id", "data-edge-from", "data-edge-to", "data-kp-image-error", "data-source-id", "data-source-ids", "data-claim-id", "data-factual-claim", "data-claim-container", "data-citation", "data-citation-for", "data-citation-ids", "data-content-role", "data-content-origin", "data-brand", "data-allow-foreign-term", "data-decorative", "data-warning-status", "data-payment-schedule", "data-payment-truth-status", "data-payment-scenario-disclosure", "data-explicitly-requested", "data-team-month-count", "data-team-matrix-truth-status", "data-team-metric", "data-team-capacity-envelope", "data-team-total-minor", "data-team-peak-fte", "data-team-rate-minor", "data-team-amount-minor", "data-active-months", "data-role-index", "data-role-peak-fte", "data-role-fte-months", "data-month", "data-fte", "data-fte-level", "data-peak", "data-branch-index", "data-market-state", "data-market-level", "data-market-value", "data-market-methodology", "data-market-missing-inputs", "data-market-scenario-disclosure", "data-scenario-id", "data-project-price-table", "data-project-price-total", "data-project-price-total-minor", "data-client-budget-minor", "data-project-amount-kind", "data-amount-kind", "data-price-row", "data-price-field", "data-value-status", "data-currency-status", "data-price-scenario-disclosure", "data-dependency-row-count", "data-ready-count", "data-waiting-count", "data-blocked-count", "data-readiness-counter", "data-readiness-bucket", "data-checked", "data-close-ready", "data-close-blocker-count", "data-close-blocker", "data-blocker-kind", "data-swot-quadrant", "style", "viewBox", "width", "height", "id", "markerWidth", "markerHeight", "refX", "refY", "orient", "d", "fill", "stroke", "stroke-width", "marker-end", "src", "href", "alt", "role", "aria-hidden", "charset", "http-equiv", "content", "nonce"]);
      for (const element of document.querySelectorAll("*")) {
        const tagName = element.tagName.toUpperCase();
        if (!allowedTags.has(tagName)) unsafe.push({ code: "DOM_UNSAFE_MARKUP", severity: "BLOCKER", elementIds: [tagName] });
        for (const attr of element.attributes) {
          if (!allowedAttrs.has(attr.name) || /^on/i.test(attr.name) || attr.name === "srcdoc") unsafe.push({ code: "DOM_UNSAFE_MARKUP", severity: "BLOCKER", elementIds: [tagName, attr.name] });
          if ((attr.name === "style" || attr.name === "content") && /url\s*\(|expression\s*\(|@import|javascript:|data:text\/html|file:|https?:\/\//i.test(attr.value)) unsafe.push({ code: "DOM_UNSAFE_MARKUP", severity: "BLOCKER", elementIds: [tagName, attr.name] });
          if (attr.name === "src" && !/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(attr.value)) unsafe.push({ code: "DOM_UNSAFE_MARKUP", severity: "BLOCKER", elementIds: [tagName, attr.name] });
          if (attr.name === "href") {
            try {
              const target = new URL(attr.value);
              if (tagName !== "A" || target.protocol !== "https:" || target.username || target.password) unsafe.push({ code: "DOM_UNSAFE_MARKUP", severity: "BLOCKER", elementIds: [tagName, attr.name] });
            } catch {
              unsafe.push({ code: "DOM_UNSAFE_MARKUP", severity: "BLOCKER", elementIds: [tagName, attr.name] });
            }
          }
        }
      }
      return unsafe;
    }
    function inspectInternalRendererLabels(pageElements) {
      const patterns = [
        /\b(?:cover asymmetric|editorial split|chapter opener|connected graph|evidence table|evidence story|commercial hero|proportional series|capacity matrix)\b/gi,
        /\b(?:reference driven|fallback default|fallback partial|formula pending|two sided tree)\b/gi,
        /\b(?:commercial lock applied|locked project total|locked team plan|\d+\s+locked (?:rows|stages|function groups))\b/gi,
        /\b(?:versioned udevs safe system|udevs safe visual system|no client-brand claim)\b/gi,
        /\b(?:mixed|grounded)\s*·\s*(?:complete|layered|gantt|two sided tree)\b/gi,
        /\b(?:renderer debug|internal note|brandbook-ready|lorem ipsum|placeholder)\b/gi,
      ];
      const output = [];
      for (const element of pageElements) {
        const text = element.innerText?.replace(/\s+/g, " ").trim() || "";
        const matches = [...new Set(patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0])))];
        if (!matches.length) continue;
        output.push({
          code: "DOM_INTERNAL_RENDERER_LABEL_VISIBLE",
          severity: "BLOCKER",
          page: Number(element.dataset.pageNumber) || null,
          message: "Client-visible PDF copy contains renderer, contract, fallback, or debug terminology",
          evidence: { matches: matches.slice(0, 8) },
        });
      }
      return output;
    }
    function inspectClientLanguage(text) {
      const rawLanguage = String(document.documentElement.lang || "").trim();
      if (!rawLanguage) {
        return {
          findings: [{
            code: "DOM_CLIENT_LANGUAGE_UNDECLARED",
            severity: "BLOCKER",
            message: "Rendered proposal does not declare the client source language on the HTML root",
          }],
          metrics: { declaredLanguage: null, detectedLanguage: "undetermined", wordCount: 0 },
        };
      }
      const normalizedLanguage = rawLanguage.toLowerCase();
      let expected = null;
      if (normalizedLanguage.startsWith("uz")) expected = { code: "uz", script: /cyrl/.test(normalizedLanguage) ? "Cyrl" : "Latn" };
      else if (normalizedLanguage.startsWith("ru")) expected = { code: "ru", script: "Cyrl" };
      else if (normalizedLanguage.startsWith("en")) expected = { code: "en", script: "Latn" };
      if (!expected) {
        return {
          findings: [{
            code: "DOM_CLIENT_LANGUAGE_UNDECLARED",
            severity: "BLOCKER",
            message: "Rendered proposal declares an unsupported or ambiguous client language",
            evidence: { declaredLanguage: rawLanguage },
          }],
          metrics: { declaredLanguage: rawLanguage, detectedLanguage: "undetermined", wordCount: 0 },
        };
      }
      const cleaned = String(text || "")
        .normalize("NFC")
        .replace(/https?:\/\/\S+|www\.\S+|\b\S+@\S+\.\S+\b/giu, " ")
        .replace(/\b[A-Z]{2,}(?:-[A-Z0-9]+)*\b/g, " ")
        .replace(/[0-9]+(?:[.,][0-9]+)?/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const words = (cleaned.match(/[\p{L}][\p{L}'’ʻ-]*/gu) || []).map((word) => word.toLowerCase().replace(/[’ʻ`]/g, "'")).filter((word) => word.length > 1);
      if (words.length < 80 || cleaned.length < 400) {
        return {
          findings: [],
          metrics: { declaredLanguage: rawLanguage, detectedLanguage: "undetermined", wordCount: words.length },
        };
      }
      const englishWords = new Set(["the", "and", "with", "for", "this", "that", "before", "after", "must", "confirm", "confirmed", "proposal", "project", "scope", "delivery", "client", "product", "market", "requires", "required", "accepted", "acceptance", "evidence", "owner", "payment", "team", "source", "working", "assumption", "explicit", "recommended", "remains", "approve", "decision", "decisions", "operating", "system", "user", "value", "launch", "commercial", "baseline", "outcome", "outcomes", "through", "from", "into", "only"]);
      const uzbekWords = new Set(["va", "uchun", "bilan", "kerak", "loyiha", "bozor", "mijoz", "foydalanuvchi", "orqali", "bo'yicha", "qilinadi", "qilish", "tasdiqlash", "bosqich", "to'lov", "muddat", "jamoa", "narx", "taklif", "tizim", "mahsulot", "xizmat", "hamda", "ammo", "yoki", "bu", "bir", "har", "emas", "keyin", "oldin", "ichida", "mavjud", "aniqlash", "etiladi", "reja", "doirasida", "bo'ladi", "bo'lishi", "talab", "natija", "egasi"]);
      const english = words.filter((word) => englishWords.has(word)).length;
      const uzbek = words.filter((word) => uzbekWords.has(word) || /(?:o'|g')/.test(word)).length;
      const letters = Array.from(cleaned).filter((char) => /\p{L}/u.test(char));
      const cyrillic = letters.filter((char) => /[А-Яа-яЁёҚқҒғҲҳЎў]/u.test(char)).length;
      const cyrillicRatio = letters.length ? cyrillic / letters.length : 0;
      let detected = "undetermined";
      if (cyrillicRatio >= 0.28) detected = "ru-or-cyrillic";
      else if (english >= 12 && english > uzbek * 1.5) detected = "en";
      else if (uzbek >= 10 && uzbek >= english * 0.65) detected = "uz-Latn";
      const mismatch = expected.code === "uz" && expected.script === "Latn"
        ? cyrillicRatio >= 0.2 || detected === "en"
        : expected.code === "uz" && expected.script === "Cyrl"
          ? cyrillicRatio < 0.2 && detected === "en"
          : expected.code === "ru"
            ? cyrillicRatio < 0.15 && (detected === "en" || detected === "uz-Latn")
            : cyrillicRatio >= 0.28 || (detected === "uz-Latn" && uzbek > english * 1.3);
      const metrics = {
        declaredLanguage: rawLanguage,
        detectedLanguage: detected,
        wordCount: words.length,
        cyrillicRatio: Math.round(cyrillicRatio * 1000) / 1000,
        englishSignalCount: english,
        uzbekSignalCount: uzbek,
      };
      if (!mismatch) return { findings: [], metrics };
      return {
        findings: [{
          code: "DOM_CLIENT_LANGUAGE_MISMATCH",
          severity: "BLOCKER",
          message: "Rendered client-visible language does not match the declared source language",
          evidence: metrics,
        }],
        metrics,
      };
    }
  }, presentationPlan);
}
