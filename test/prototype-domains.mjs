import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildAndValidateAppPrototypeSpec } from "../scripts/kp_app_prototype_planner.mjs";
import { runAppPrototypeQa } from "../scripts/kp_app_prototype_qa.mjs";
import { renderAppPrototypeToFile } from "../scripts/kp_app_prototype_renderer.mjs";

const domainCases = [
  {
    label: "CRM",
    family: "crm",
    requiredScreen: "pipeline",
    forbiddenScreen: "purchase_orders",
    scope: ["Лиды и сделки", "Воронка продаж", "Задачи менеджеров", "База клиентов"],
  },
  {
    label: "ERP",
    family: "erp",
    requiredScreen: "purchase_orders",
    forbiddenScreen: "pipeline",
    scope: ["Заявки на закупку", "Заказы поставщикам", "Складские остатки", "Финансовая отчетность"],
  },
  {
    label: "Marketplace",
    family: "marketplace",
    requiredScreen: "seller_workspace",
    forbiddenScreen: "admin_catalog",
    scope: ["Каталог продавцов", "Карточка товара", "Корзина и оплата", "Кабинет продавца"],
    actors: [
      { id: "buyer", label: "Покупатель", type: "external_user" },
      { id: "seller", label: "Продавец", type: "external_user" },
    ],
  },
  {
    label: "SaaS",
    family: "saas",
    requiredScreen: "workspaces",
    forbiddenScreen: "pipeline",
    scope: ["Рабочие пространства", "Проекты команды", "Автоматизации", "Тарифы и подписка"],
  },
  {
    label: "E-commerce",
    family: "ecommerce",
    requiredScreen: "checkout",
    forbiddenScreen: "seller_workspace",
    scope: ["Каталог товаров", "Карточка товара", "Корзина", "Оформление и оплата заказа"],
    themeTokens: { primary: "#FBC100", secondary: "#333333" },
  },
  {
    label: "Mobile App",
    family: "mobile-app",
    requiredScreen: "app_permissions",
    forbiddenScreen: "pipeline",
    scope: ["Персональная лента", "Поиск контента", "Создание публикации", "Push-уведомления"],
  },
  {
    label: "Website",
    family: "website",
    requiredScreen: "services",
    forbiddenScreen: "pipeline",
    scope: ["Главная страница", "Каталог услуг", "Кейсы", "Форма обратной связи"],
  },
  {
    label: "TMS",
    family: "tms",
    requiredScreen: "dispatch_board",
    forbiddenScreen: "pipeline",
    scope: ["Транспортные заявки", "Диспетчеризация", "Отслеживание грузов", "Управление автопарком"],
  },
  {
    label: "Other",
    family: "business-app",
    requiredScreen: "workspace",
    forbiddenScreen: "pipeline",
    scope: ["Реестр обращений", "Карточка обращения", "Согласование", "Задачи исполнителей"],
  },
];

const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kp-prototype-domains-"));
const summaries = [];
const requestedDomain = String(process.env.KP_TEST_PROTOTYPE_DOMAIN || "").trim().toLowerCase();
const activeDomainCases = requestedDomain
  ? domainCases.filter((domainCase) => domainCase.label.toLowerCase() === requestedDomain || domainCase.family === requestedDomain)
  : domainCases;
assert.ok(activeDomainCases.length > 0, `Unknown prototype domain filter: ${requestedDomain}`);

try {
  for (const [index, domainCase] of activeDomainCases.entries()) {
    const requestId = `KP-DOMAIN-${String(index + 1).padStart(2, "0")}`;
    const sourceRefs = domainCase.scope.map((_, scopeIndex) => `${requestId}-SCOPE-${scopeIndex + 1}`);
    const prompt = [
      "Составь коммерческое предложение для проекта.",
      `Тип проекта: ${domainCase.label}`,
      `Функциональность: ${domainCase.scope.join(", ")}`,
    ].join("\n");
    const spec = await buildAndValidateAppPrototypeSpec({
      requestId,
      publicId: `DomainPrototype${String(index + 1).padStart(2, "0")}X`,
      locale: "ru-RU",
      env: {},
      themeTokens: domainCase.themeTokens || null,
      proposalModel: {
        requestId,
        title: `${domainCase.label} — демонстрационный проект`,
        brief: {
          projectName: `${domainCase.label} Demo`,
          type: domainCase.label,
          prompt,
        },
        scope: domainCase.scope.map((feature, scopeIndex) => ({
          id: sourceRefs[scopeIndex],
          epic: domainCase.label,
          feature,
          detail: `${feature}: основной пользовательский сценарий`,
          truthStatus: "client_input",
        })),
      },
      semanticModel: {
        requestId,
        project: { name: `${domainCase.label} Demo`, category: domainCase.label },
        scopeItems: domainCase.scope.map((feature, scopeIndex) => ({
          id: sourceRefs[scopeIndex],
          feature,
          detail: `${feature}: основной пользовательский сценарий`,
          sourceRefs: [sourceRefs[scopeIndex]],
        })),
        actors: domainCase.actors || [{ id: "user", label: "Пользователь", type: "external_user" }],
      },
    });

    assert.equal(spec.project.type, domainCase.family, domainCase.label);
    assert.ok(spec.screens.length >= 6 && spec.screens.length <= 16, `${domainCase.label}: screen count`);
    assert.ok(spec.screens.some((screen) => screen.id === domainCase.requiredScreen), `${domainCase.label}: required screen`);
    assert.equal(spec.screens.some((screen) => screen.id === domainCase.forbiddenScreen), false, `${domainCase.label}: forbidden screen`);

    const caseDir = path.join(testRoot, domainCase.family);
    const htmlPath = path.join(caseDir, "index.html");
    await renderAppPrototypeToFile(spec, htmlPath);
    const qa = await runAppPrototypeQa({ spec, htmlPath });
    assert.notEqual(qa.status, "FAIL", `${domainCase.label}: DOM QA`);
    summaries.push({
      domain: domainCase.label,
      family: spec.project.type,
      screens: spec.screens.length,
      qa: qa.status,
      findings: qa.findings.map((finding) => finding.code),
    });
    console.log(`${domainCase.label}: ${qa.status}, ${spec.screens.length} screens`);
  }

  assert.equal(summaries.length, activeDomainCases.length);
  console.log(`Prototype domain checks PASS (${summaries.length}/${activeDomainCases.length})`);
  await fs.rm(testRoot, { recursive: true, force: true });
} catch (error) {
  console.error(`Prototype domain artifacts retained at ${testRoot}`);
  throw error;
}
