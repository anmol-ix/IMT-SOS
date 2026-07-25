import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import nextEnv from "@next/env";
import { AuthenticationException, WorkOS } from "@workos-inc/node";
import { chromium } from "playwright";
import pg from "pg";
import { z } from "zod";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error: console.error });

const config = z
  .object({
    WORKOS_API_KEY: z.string().min(1),
    WORKOS_CLIENT_ID: z.string().min(1),
    WORKOS_COOKIE_PASSWORD: z.string().min(32),
    MIGRATION_DATABASE_URL: z.string().url(),
    BUSINESS_NAME: z.string().trim().min(1).default("ItsMyToy"),
    APP_ORIGIN: z.string().url().default("http://127.0.0.1:4173"),
  })
  .parse(process.env);

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("WorkOS returned an invalid TOTP secret.");
    bits += index.toString(2).padStart(5, "0");
  }

  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret, at = Date.now(), digits = 6) {
  let counter = BigInt(Math.floor(at / 30_000));
  const message = Buffer.alloc(8);
  for (let index = 7; index >= 0; index -= 1) {
    message[index] = Number(counter & 0xffn);
    counter >>= 8n;
  }

  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest.at(-1) & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

assert.equal(
  totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000, 8),
  "94287082",
  "TOTP implementation failed the RFC 6238 reference vector",
);

const lineTotal = (lines) =>
  lines.reduce((total, line) => total + line.quantity * line.unitPricePaise, 0);
const onePayment = (lines, paymentMode = "UPI") => [
  { paymentMode, amountPaise: lineTotal(lines) },
];
const twoPayments = (lines) => {
  const totalPaise = lineTotal(lines);
  const cashPaise = Math.floor(totalPaise / 2);
  return [
    { paymentMode: "CASH", amountPaise: cashPaise },
    { paymentMode: "UPI", amountPaise: totalPaise - cashPaise },
  ];
};

const workos = new WorkOS(config.WORKOS_API_KEY, {
  clientId: config.WORKOS_CLIENT_ID,
});
const database = new pg.Client({ connectionString: config.MIGRATION_DATABASE_URL });
const marker = Date.now();
const email = `operator-proof-${marker}@example.net`;
const password = `${randomBytes(32).toString("base64url")}Aa1!`;
let dummyUserId;
let localUserId;
let sessionId;
let saleCommandId;
let approvalSaleCommandId;
let ownerExceptionSaleCommandId;
let approvalId;
let receiptCommandId;
let receiptCompletionCommandId;
let draftReceiptId;
let newProductCommandId;
let newProductReceiptCommandId;
let newProductVariantId;
let newProductSequenceBefore;
let newProductSequenceNumber;
let productChangeCommandId;
let productChangeId;
let stalePriceApprovalId;
let staleStockAdjustmentId;
let stockAdjustmentId;
let stockAdjustmentDecisionCommandId;
let stockAdjustmentSaleCommandId;
let supplierId;
let customerId;
let guestApprovalId;
let highValueSaleCommandId;
let firstClosingId;
let firstClosingCommandId;
let closingRevisionId;
let closingRevisionCommandId;
let reorderPolicyChangeId;
let reorderPolicyCommandId;

try {
  await database.connect();

  const dummy = await workos.userManagement.createUser({
    email,
    password,
    emailVerified: true,
    firstName: "Synthetic",
    lastName: "Operator",
    metadata: { purpose: "operator_authorization_proof" },
  });
  dummyUserId = dummy.id;

  const business = await database.query(
    "SELECT id FROM businesses WHERE name = $1",
    [config.BUSINESS_NAME],
  );
  if (!business.rows[0]) throw new Error("ItsMyToy business row is missing.");

  const localUser = await database.query(
    `INSERT INTO app_users
       (business_id, workos_user_id, display_name, role, status)
     VALUES ($1, $2, 'Synthetic Operator', 'STORE_OPERATOR', 'ACTIVE')
     RETURNING id`,
    [business.rows[0].id, dummyUserId],
  );
  localUserId = localUser.rows[0].id;

  let pendingAuthenticationToken;
  try {
    await workos.userManagement.authenticateWithPassword({
      email,
      password,
      clientId: config.WORKOS_CLIENT_ID,
    });
    throw new Error("MFA was not required for the synthetic operator.");
  } catch (error) {
    if (
      !(error instanceof AuthenticationException) ||
      error.code !== "mfa_enrollment" ||
      !error.pendingAuthenticationToken
    ) {
      throw error;
    }
    pendingAuthenticationToken = error.pendingAuthenticationToken;
  }

  const { authenticationFactor, authenticationChallenge } =
    await workos.multiFactorAuth.createUserAuthFactor({
      userId: dummyUserId,
      type: "totp",
      totpIssuer: "ItsMyToy Security Proof",
      totpUser: email,
    });

  const authentication = await workos.userManagement.authenticateWithTotp({
    code: totp(authenticationFactor.totp.secret),
    pendingAuthenticationToken,
    authenticationChallengeId: authenticationChallenge.id,
    clientId: config.WORKOS_CLIENT_ID,
    session: {
      sealSession: true,
      cookiePassword: config.WORKOS_COOKIE_PASSWORD,
    },
  });
  if (!authentication.sealedSession) {
    throw new Error("WorkOS did not return a sealed session.");
  }

  const tokenPayload = JSON.parse(
    Buffer.from(authentication.accessToken.split(".")[1], "base64url").toString(),
  );
  sessionId = z.string().min(1).parse(tokenPayload.sid);

  const request = (path, options = {}) =>
    fetch(new URL(path, config.APP_ORIGIN), {
      ...options,
      headers: {
        cookie: `wos-session=${authentication.sealedSession}`,
        ...options.headers,
      },
      redirect: "manual",
    });

  const capture = async (path, fileName, viewport, prepare) => {
    if (process.env.CAPTURE_UI !== "1") return;
    await mkdir("output/playwright", { recursive: true });
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport,
        permissions: ["clipboard-read", "clipboard-write"],
      });
      await context.addCookies([{
        name: "wos-session",
        value: authentication.sealedSession,
        url: config.APP_ORIGIN,
        httpOnly: true,
        sameSite: "Lax",
      }]);
      const page = await context.newPage();
      await page.goto(new URL(path, config.APP_ORIGIN).toString());
      if (prepare) await prepare(page);
      await page.screenshot({ path: `output/playwright/${fileName}`, fullPage: true });
      await context.close();
    } finally {
      await browser.close();
    }
  };

  const meResponse = await request("/api/v1/me");
  const meBody = await meResponse.json();
  assert.equal(meResponse.status, 200);
  assert.equal(meBody.user.role, "STORE_OPERATOR");

  const ownerResponse = await request("/api/v1/owner/proof");
  const ownerBody = await ownerResponse.json();
  assert.equal(ownerResponse.status, 403);
  assert.equal(ownerBody.error.code, "FORBIDDEN");
  const ownerDashboardDeniedResponse = await request("/api/v1/owner/dashboard");
  const ownerDashboardDeniedBody = await ownerDashboardDeniedResponse.json();
  assert.equal(ownerDashboardDeniedResponse.status, 403);
  assert.equal(ownerDashboardDeniedBody.error.code, "FORBIDDEN");
  const dailyClosingDeniedResponse = await request("/api/v1/daily-closing");
  const dailyClosingDeniedBody = await dailyClosingDeniedResponse.json();
  assert.equal(dailyClosingDeniedResponse.status, 403);
  assert.equal(dailyClosingDeniedBody.error.code, "FORBIDDEN");

  const catalogResponse = await request(
    "/api/v1/catalog?q=IMT-CAR-RC-0001-RED",
  );
  const catalogBody = await catalogResponse.json();
  assert.equal(catalogResponse.status, 200);
  assert.equal(catalogBody.products.length, 1);
  const product = catalogBody.products[0];
  assert.ok(product.stock > 0);
  assert.equal(product.latestLandedCostPaise, undefined);
  assert.equal(product.weightedAverageCostPaise, undefined);
  const storeReorderPolicyDeniedResponse = await request(
    `/api/v1/inventory/${product.id}/reorder-policy`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({
        reorderPoint: 2,
        restockTarget: 8,
        reason: "INITIAL_SETUP",
        note: "Store operator authorization denial proof.",
      }),
    },
  );
  const storeReorderPolicyDeniedBody =
    await storeReorderPolicyDeniedResponse.json();
  assert.equal(storeReorderPolicyDeniedResponse.status, 403);
  assert.equal(storeReorderPolicyDeniedBody.error.code, "FORBIDDEN");

  await capture("/", "operator-barcode-scanner-mobile.png", { width: 390, height: 844 }, async (page) => {
    await page.evaluate(() => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => new MediaStream(),
      });
      Object.defineProperty(HTMLMediaElement.prototype, "play", {
        configurable: true,
        value: async () => {},
      });
      Object.defineProperty(window, "BarcodeDetector", {
        configurable: true,
        value: class {
          async detect() {
            return [];
          }
        },
      });
    });
    await page.getByRole("button", { name: "Scan barcode" }).click();
    await page.getByRole("heading", { name: "Scan product barcode" }).waitFor();
  });

  await capture("/", "operator-barcode-scan-result-mobile.png", { width: 390, height: 844 }, async (page) => {
    await page.evaluate((barcode) => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => new MediaStream(),
      });
      Object.defineProperty(HTMLMediaElement.prototype, "play", {
        configurable: true,
        value: async () => {},
      });
      Object.defineProperty(window, "BarcodeDetector", {
        configurable: true,
        value: class {
          async detect() {
            return [{ rawValue: barcode }];
          }
        },
      });
    }, product.barcode);
    await page.getByRole("button", { name: "Scan barcode" }).click();
    await page.getByText(`Barcode ${product.barcode} scanned.`).waitFor();
    await page.locator(".selected-product").getByRole("heading", { name: product.name }).waitFor();
  });

  const fullCatalogResponse = await request("/api/v1/catalog?q=");
  const fullCatalogBody = await fullCatalogResponse.json();
  assert.equal(fullCatalogResponse.status, 200);
  const secondProduct = fullCatalogBody.products.find(
    (item) => item.id !== product.id && item.stock > 1,
  );
  assert.ok(secondProduct);
  assert.equal(secondProduct.latestLandedCostPaise, undefined);

  const customerPhone = `98${String(marker).slice(-8)}`;
  const customerCreateResponse = await request("/api/v1/customers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Synthetic Customer",
      phone: customerPhone,
      locality: "Acceptance Test",
    }),
  });
  const customerCreateBody = await customerCreateResponse.json();
  assert.equal(customerCreateResponse.status, 201);
  customerId = customerCreateBody.customer.id;

  const customerSearchResponse = await request(
    `/api/v1/customers?q=${customerPhone.slice(-6)}`,
  );
  const customerSearchBody = await customerSearchResponse.json();
  assert.equal(customerSearchResponse.status, 200);
  assert.equal(customerSearchBody.customers[0].id, customerId);

  const duplicateCustomerResponse = await request("/api/v1/customers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Duplicate Synthetic", phone: customerPhone }),
  });
  const duplicateCustomerBody = await duplicateCustomerResponse.json();
  assert.equal(duplicateCustomerResponse.status, 409);
  assert.equal(duplicateCustomerBody.error.code, "CUSTOMER_ALREADY_EXISTS");

  receiptCommandId = randomUUID();
  const deniedReceiptPayload = {
    supplierId: randomUUID(),
    supplierInvoiceReference: `TEST-${marker}`,
    note: "Temporary local acceptance proof",
    lines: [{
      variantId: product.id,
      sellableQuantity: 2,
      openBoxQuantity: 0,
      damagedQuantity: 0,
      invoiceUnitCostPaise: 50_000,
    }],
  };
  const deniedReceiptResponse = await request("/api/v1/stock-receipts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": receiptCommandId,
    },
    body: JSON.stringify(deniedReceiptPayload),
  });
  const deniedReceiptBody = await deniedReceiptResponse.json();
  assert.equal(deniedReceiptResponse.status, 403);
  assert.equal(deniedReceiptBody.error.code, "FORBIDDEN");

  await database.query(
    "UPDATE app_users SET role = 'TRUSTED_OPERATOR', updated_at = now() WHERE id = $1",
    [localUserId],
  );
  const supplierResponse = await request("/api/v1/suppliers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `Synthetic Supplier ${marker}`,
      phone: "9999999999",
    }),
  });
  const supplierBody = await supplierResponse.json();
  assert.equal(supplierResponse.status, 201);
  supplierId = supplierBody.supplier.id;
  newProductCommandId = randomUUID();
  const newProductPayload = {
    productName: `Synthetic Solar Robot ${marker}`,
    category: "Educational",
    categoryCode: "EDU",
    subcategory: "Science Kits",
    subcategoryCode: "SCI",
    brand: "Acceptance Lab",
    variantName: "Blue",
    variantCode: "BLU",
    supplierBarcode: `SUP-${marker}`,
    unitOfMeasure: "UNIT",
    packSize: 1,
    rackLocation: "C2-S3",
    purchaseCostPaise: 40_000,
    standardPricePaise: 80_000,
    mrpPaise: 100_000,
    ownerFloorPaise: 60_000,
    trustedOperatorFloorPaise: 70_000,
    storeOperatorFloorPaise: 75_000,
  };
  const trustedNewProductResponse = await request("/api/v1/products", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": newProductCommandId,
    },
    body: JSON.stringify(newProductPayload),
  });
  const trustedNewProductBody = await trustedNewProductResponse.json();
  assert.equal(trustedNewProductResponse.status, 403);
  assert.equal(trustedNewProductBody.error.code, "FORBIDDEN");
  const trustedProductChangeResponse = await request(
    `/api/v1/products/${product.id}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({}),
    },
  );
  const trustedProductChangeBody = await trustedProductChangeResponse.json();
  assert.equal(trustedProductChangeResponse.status, 403);
  assert.equal(trustedProductChangeBody.error.code, "FORBIDDEN");
  const trustedProductBeforeResponse = await request(
    `/api/v1/catalog?q=${encodeURIComponent(product.sku)}`,
  );
  const trustedProductBeforeBody = await trustedProductBeforeResponse.json();
  const trustedSecondProductBeforeResponse = await request(
    `/api/v1/catalog?q=${encodeURIComponent(secondProduct.sku)}`,
  );
  const trustedSecondProductBeforeBody = await trustedSecondProductBeforeResponse.json();
  assert.equal(trustedProductBeforeResponse.status, 200);
  assert.equal(trustedSecondProductBeforeResponse.status, 200);

  const receiptPayload = {
    supplierId,
    supplierInvoiceReference: `TEST-${marker}`,
    note: "Temporary local acceptance proof",
    lines: [
      {
        variantId: product.id,
        sellableQuantity: 2,
        openBoxQuantity: 0,
        damagedQuantity: 1,
        invoiceUnitCostPaise: 50_000,
      },
      {
        variantId: secondProduct.id,
        sellableQuantity: 3,
        openBoxQuantity: 2,
        damagedQuantity: 0,
        invoiceUnitCostPaise: 30_000,
      },
    ],
  };
  const trustedDraftResponse = await request("/api/v1/stock-receipts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": receiptCommandId,
    },
    body: JSON.stringify(receiptPayload),
  });
  const trustedDraftBody = await trustedDraftResponse.json();
  assert.equal(trustedDraftResponse.status, 201);
  assert.equal(trustedDraftBody.draft.lines.length, 2);
  assert.equal(trustedDraftBody.draft.totalQuantity, 8);
  assert.equal(trustedDraftBody.draft.totalSellableQuantity, 5);
  assert.equal(trustedDraftBody.draft.totalOpenBoxQuantity, 2);
  assert.equal(trustedDraftBody.draft.totalDamagedQuantity, 1);
  assert.equal(trustedDraftBody.draft.totalInvoiceValuePaise, undefined);
  assert.ok(
    trustedDraftBody.draft.lines.every(
      (line) => line.invoiceUnitCostPaise === undefined,
    ),
  );
  draftReceiptId = trustedDraftBody.draft.receiptId;

  const stockAfterDraftResponse = await request(
    `/api/v1/catalog?q=${encodeURIComponent(product.sku)}`,
  );
  const stockAfterDraftBody = await stockAfterDraftResponse.json();
  assert.equal(stockAfterDraftResponse.status, 200);
  assert.equal(stockAfterDraftBody.products[0].stock, product.stock);
  assert.equal(
    stockAfterDraftBody.products[0].damagedStock,
    trustedProductBeforeBody.products[0].damagedStock,
  );
  assert.equal(stockAfterDraftBody.products[0].latestLandedCostPaise, undefined);
  const secondStockAfterDraftResponse = await request(
    `/api/v1/catalog?q=${encodeURIComponent(secondProduct.sku)}`,
  );
  const secondStockAfterDraftBody = await secondStockAfterDraftResponse.json();
  assert.equal(secondStockAfterDraftBody.products[0].stock, secondProduct.stock);
  assert.equal(
    secondStockAfterDraftBody.products[0].openBoxStock,
    trustedSecondProductBeforeBody.products[0].openBoxStock,
  );

  const duplicateReceiptResponse = await request("/api/v1/stock-receipts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify(receiptPayload),
  });
  const duplicateReceiptBody = await duplicateReceiptResponse.json();
  assert.equal(duplicateReceiptResponse.status, 409);
  assert.equal(
    duplicateReceiptBody.error.code,
    "POSSIBLE_DUPLICATE_SUPPLIER_INVOICE",
  );

  receiptCompletionCommandId = randomUUID();
  const trustedCompletionResponse = await request(
    `/api/v1/stock-receipts/${draftReceiptId}/complete`,
    {
      method: "POST",
      headers: { "idempotency-key": receiptCompletionCommandId },
    },
  );
  const trustedCompletionBody = await trustedCompletionResponse.json();
  assert.equal(trustedCompletionResponse.status, 403);
  assert.equal(trustedCompletionBody.error.code, "FORBIDDEN");

  await capture(
    "/receive",
    "trusted-operator-receipt-draft-mobile.png",
    { width: 390, height: 900 },
    async (page) => {
      await page.getByRole("heading", { name: "Build. Save. Owner checks." }).waitFor();
      await page.getByText(trustedDraftBody.draft.receiptNumber).waitFor();
      await page.getByText("Your drafts awaiting owner").waitFor();
      await page.getByText("2 product lines · 8 total units").waitFor();
      await page.getByRole("combobox", { name: "Supplier", exact: true })
        .selectOption({ label: supplierBody.supplier.name });
      await page.getByLabel("Bill / invoice reference", { exact: true }).fill(`UI-${marker}`);
      await page.locator(".product-row", { hasText: secondProduct.name }).click();
      await page.getByLabel("Sellable", { exact: true }).fill("4");
      await page.getByLabel("Open box", { exact: true }).fill("1");
      await page.getByLabel("Invoice unit cost (₹)").fill("310");
      await page.getByRole("button", { name: "Add product to receipt" }).click();
      await page.locator(".product-row", { hasText: product.name }).click();
      await page.getByLabel("Sellable", { exact: true }).fill("2");
      await page.getByLabel("Damaged", { exact: true }).fill("1");
      await page.getByLabel("Invoice unit cost (₹)").fill("510");
      await page.getByRole("button", { name: "Add product to receipt" }).click();
      await page.getByText("2 product lines · 8 units").waitFor();
      assert.equal(await page.getByText(/weighted average|latest landed/i).count(), 0);
    },
  );
  const proveExistingProductChange = async () => {
  await database.query(
    "UPDATE app_users SET role = 'STORE_OPERATOR', updated_at = now() WHERE id = $1",
    [localUserId],
  );
  const staleApprovalResponse = await request("/api/v1/price-approvals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      variantId: newProductVariantId,
      quantity: 1,
      requestedUnitPricePaise: 50_000,
    }),
  });
  const staleApprovalBody = await staleApprovalResponse.json();
  assert.equal(staleApprovalResponse.status, 201);
  assert.equal(staleApprovalBody.approval.status, "PENDING");
  stalePriceApprovalId = staleApprovalBody.approval.id;

  await database.query(
    "UPDATE app_users SET role = 'BUSINESS_OWNER', updated_at = now() WHERE id = $1",
    [localUserId],
  );
  const productStateBeforeChange = await database.query(
    `SELECT
       ib.quantity_on_hand,
       COALESCE((SELECT sum(quantity_on_hand)
         FROM inventory_condition_balances cb
         WHERE cb.location_id = ib.location_id
           AND cb.variant_id = ib.variant_id
           AND cb.stock_condition = 'OPEN_BOX'), 0)::int AS open_box_quantity,
       (SELECT count(*)::int FROM inventory_movements m
         WHERE m.variant_id = ib.variant_id) AS movement_count
     FROM inventory_balances ib
     WHERE ib.variant_id = $1`,
    [newProductVariantId],
  );
  productChangeCommandId = randomUUID();
  const productChangePayload = {
    rackLocation: "C2-S4",
    mrpPaise: 110_000,
    standardPricePaise: 85_000,
    ownerFloorPaise: 60_000,
    trustedOperatorFloorPaise: 75_000,
    storeOperatorFloorPaise: 80_000,
    reason: "MARGIN_REVIEW",
    note: "Temporary versioned price and rack proof",
  };
  const productChangeResponse = await request(
    `/api/v1/products/${newProductVariantId}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "idempotency-key": productChangeCommandId,
      },
      body: JSON.stringify(productChangePayload),
    },
  );
  const productChangeBody = await productChangeResponse.json();
  assert.equal(productChangeResponse.status, 201);
  assert.equal(productChangeBody.change.priceChanged, true);
  assert.equal(productChangeBody.change.rackChanged, true);
  assert.equal(productChangeBody.change.expiredPriceApprovals, 1);
  assert.equal(productChangeBody.change.previous.rackLocation, "C2-S3");
  assert.equal(productChangeBody.change.product.rackLocation, "C2-S4");
  assert.equal(productChangeBody.change.product.standardPricePaise, 85_000);
  assert.equal(productChangeBody.change.product.mrpPaise, 110_000);
  assert.equal(productChangeBody.change.product.stock, 3);
  assert.equal(productChangeBody.change.product.openBoxStock, 1);
  productChangeId = productChangeBody.change.changeId;

  const productChangeReplayResponse = await request(
    `/api/v1/products/${newProductVariantId}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "idempotency-key": productChangeCommandId,
      },
      body: JSON.stringify(productChangePayload),
    },
  );
  const productChangeReplayBody = await productChangeReplayResponse.json();
  assert.equal(productChangeReplayResponse.status, 200);
  assert.equal(productChangeReplayBody.change.changeId, productChangeId);

  const productStateAfterChange = await database.query(
    `SELECT
       ib.quantity_on_hand,
       COALESCE((SELECT sum(quantity_on_hand)
         FROM inventory_condition_balances cb
         WHERE cb.location_id = ib.location_id
           AND cb.variant_id = ib.variant_id
           AND cb.stock_condition = 'OPEN_BOX'), 0)::int AS open_box_quantity,
       (SELECT count(*)::int FROM inventory_movements m
         WHERE m.variant_id = ib.variant_id) AS movement_count
     FROM inventory_balances ib
     WHERE ib.variant_id = $1`,
    [newProductVariantId],
  );
  assert.deepEqual(
    productStateAfterChange.rows[0],
    productStateBeforeChange.rows[0],
  );
  const productPriceHistory = await database.query(
    `SELECT id, effective_from, effective_to, mrp_paise, standard_price_paise
       FROM price_versions
      WHERE variant_id = $1
      ORDER BY effective_from`,
    [newProductVariantId],
  );
  assert.equal(productPriceHistory.rows.length, 2);
  assert.ok(productPriceHistory.rows[0].effective_to);
  assert.equal(productPriceHistory.rows[1].effective_to, null);
  assert.equal(Number(productPriceHistory.rows[1].standard_price_paise), 85_000);
  const staleApprovalLookupResponse = await request(
    `/api/v1/price-approvals/${stalePriceApprovalId}`,
  );
  const staleApprovalLookupBody = await staleApprovalLookupResponse.json();
  assert.equal(staleApprovalLookupResponse.status, 200);
  assert.equal(staleApprovalLookupBody.approval.status, "EXPIRED");

  await capture(
    "/receive",
    "owner-existing-product-change-mobile.png",
    { width: 390, height: 1000 },
    async (page) => {
      await page.locator(".product-row", {
        hasText: newProductPayload.productName,
      }).click();
      await page.getByRole("button", {
        name: "Manage current prices and rack",
      }).click();
      await page.getByRole("heading", {
        name: `Manage ${newProductPayload.productName}`,
      }).waitFor();
      assert.equal(
        await page.getByLabel("Primary rack · S1 bottom, S6 top").inputValue(),
        "C2-S4",
      );
      assert.equal(
        await page.getByLabel("Standard selling price (₹)", { exact: true })
          .inputValue(),
        "850.00",
      );
      await page.getByText(
        "Saving prices closes the old version and starts a new one.",
        { exact: false },
      ).waitFor();
    },
  );
  return {
    productChangeResponse,
    productChangeBody,
    productChangeReplayBody,
    productStateBeforeChange,
    productStateAfterChange,
    productPriceHistory,
    staleApprovalLookupBody,
  };
  };

  const proveStockCountAndMovementHistory = async () => {
    await database.query(
      "UPDATE app_users SET role = 'STORE_OPERATOR', updated_at = now() WHERE id = $1",
      [localUserId],
    );
    const storeCountDeniedResponse = await request("/api/v1/stock-adjustments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({
        variantId: newProductVariantId,
        stockCondition: "SELLABLE",
        countedQuantity: 2,
        reason: "PHYSICAL_COUNT",
        note: "Temporary store-operator denial proof",
      }),
    });
    const storeCountDeniedBody = await storeCountDeniedResponse.json();
    assert.equal(storeCountDeniedResponse.status, 403);
    assert.equal(storeCountDeniedBody.error.code, "FORBIDDEN");

    await database.query(
      "UPDATE app_users SET role = 'TRUSTED_OPERATOR', updated_at = now() WHERE id = $1",
      [localUserId],
    );
    const staleCountResponse = await request("/api/v1/stock-adjustments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({
        variantId: newProductVariantId,
        stockCondition: "SELLABLE",
        countedQuantity: 2,
        reason: "PHYSICAL_COUNT",
        note: "Temporary stale stock-count proof",
      }),
    });
    const staleCountBody = await staleCountResponse.json();
    assert.equal(staleCountResponse.status, 201);
    assert.equal(staleCountBody.adjustment.recordedQuantity, 3);
    assert.equal(staleCountBody.adjustment.countedQuantity, 2);
    assert.equal(staleCountBody.adjustment.quantityDelta, -1);
    assert.equal(staleCountBody.adjustment.expectedValueDeltaPaise, undefined);
    staleStockAdjustmentId = staleCountBody.adjustment.id;

    const trustedDecisionResponse = await request(
      `/api/v1/stock-adjustments/${staleStockAdjustmentId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "idempotency-key": randomUUID(),
        },
        body: JSON.stringify({ decision: "APPROVE" }),
      },
    );
    const trustedDecisionBody = await trustedDecisionResponse.json();
    assert.equal(trustedDecisionResponse.status, 403);
    assert.equal(trustedDecisionBody.error.code, "FORBIDDEN");

    await database.query(
      "UPDATE app_users SET role = 'STORE_OPERATOR', updated_at = now() WHERE id = $1",
      [localUserId],
    );
    stockAdjustmentSaleCommandId = randomUUID();
    const interveningSaleResponse = await request("/api/v1/sales", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": stockAdjustmentSaleCommandId,
      },
      body: JSON.stringify({
        lines: [{
          variantId: newProductVariantId,
          quantity: 1,
          unitPricePaise: 85_000,
        }],
        payments: [{ paymentMode: "UPI", amountPaise: 85_000 }],
      }),
    });
    const interveningSaleBody = await interveningSaleResponse.json();
    assert.equal(interveningSaleResponse.status, 201);
    assert.equal(interveningSaleBody.sale.lines[0].remainingStock, 2);

    await database.query(
      "UPDATE app_users SET role = 'BUSINESS_OWNER', updated_at = now() WHERE id = $1",
      [localUserId],
    );
    const staleDecisionResponse = await request(
      `/api/v1/stock-adjustments/${staleStockAdjustmentId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "idempotency-key": randomUUID(),
        },
        body: JSON.stringify({ decision: "APPROVE" }),
      },
    );
    const staleDecisionBody = await staleDecisionResponse.json();
    assert.equal(staleDecisionResponse.status, 409);
    assert.equal(staleDecisionBody.error.code, "STOCK_ADJUSTMENT_STALE");

    const rejectStaleResponse = await request(
      `/api/v1/stock-adjustments/${staleStockAdjustmentId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "idempotency-key": randomUUID(),
        },
        body: JSON.stringify({
          decision: "REJECT",
          note: "Stock changed after the count.",
        }),
      },
    );
    const rejectStaleBody = await rejectStaleResponse.json();
    assert.equal(rejectStaleResponse.status, 200);
    assert.equal(rejectStaleBody.adjustment.status, "REJECTED");

    await database.query(
      "UPDATE app_users SET role = 'TRUSTED_OPERATOR', updated_at = now() WHERE id = $1",
      [localUserId],
    );
    const freshCountNote = `Temporary physical count proof ${marker}`;
    await capture(
      "/inventory",
      "trusted-stock-count-mobile.png",
      { width: 390, height: 1000 },
      async (page) => {
        await page.locator(".product-row", {
          hasText: newProductPayload.productName,
        }).click();
        await page.getByText("Ledger matches balances").waitFor();
        await page.getByLabel("Quantity physically present").fill("1");
        await page.getByLabel("Count note").fill(freshCountNote);
        await page.getByRole("button", {
          name: "Submit difference for approval",
        }).click();
        await page.getByText("Stock has not changed", { exact: false }).waitFor();
      },
    );
    const freshAdjustment = await database.query(
      `SELECT id FROM stock_adjustments
        WHERE requested_by = $1 AND note = $2 AND status = 'REQUESTED'`,
      [localUserId, freshCountNote],
    );
    assert.equal(freshAdjustment.rows.length, 1);
    stockAdjustmentId = freshAdjustment.rows[0].id;

    await database.query(
      "UPDATE app_users SET role = 'BUSINESS_OWNER', updated_at = now() WHERE id = $1",
      [localUserId],
    );
    const pendingResponse = await request("/api/v1/stock-adjustments");
    const pendingBody = await pendingResponse.json();
    assert.equal(pendingResponse.status, 200);
    const pending = pendingBody.adjustments.find(
      (adjustment) => adjustment.id === stockAdjustmentId,
    );
    assert.ok(pending);
    assert.equal(pending.recordedQuantity, 2);
    assert.equal(pending.countedQuantity, 1);
    assert.equal(pending.expectedValueDeltaPaise, -40_000);

    await capture(
      "/approvals",
      "owner-stock-adjustment-approval-mobile.png",
      { width: 390, height: 1000 },
      async (page) => {
        await page.getByRole("heading", {
          name: "Stock-count differences",
        }).waitFor();
        await page.locator(".stock-approval-card", {
          hasText: newProductPayload.productName,
        }).getByText("Physically counted").waitFor();
        await page.getByText("-₹400").waitFor();
      },
    );

    const beforeApproval = await database.query(
      `SELECT quantity_on_hand, inventory_value_paise, version,
              (SELECT count(*)::int FROM inventory_movements
                WHERE variant_id = $1) AS movement_count
         FROM inventory_balances
        WHERE variant_id = $1`,
      [newProductVariantId],
    );
    assert.equal(beforeApproval.rows[0].quantity_on_hand, 2);
    assert.equal(Number(beforeApproval.rows[0].inventory_value_paise), 80_000);

    stockAdjustmentDecisionCommandId = randomUUID();
    const decisionPayload = {
      decision: "APPROVE",
      note: "Owner verified the recount evidence.",
    };
    const decisionResponse = await request(
      `/api/v1/stock-adjustments/${stockAdjustmentId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "idempotency-key": stockAdjustmentDecisionCommandId,
        },
        body: JSON.stringify(decisionPayload),
      },
    );
    const decisionBody = await decisionResponse.json();
    assert.equal(decisionResponse.status, 200);
    assert.equal(decisionBody.adjustment.status, "APPLIED");
    assert.equal(decisionBody.adjustment.quantityDelta, -1);
    assert.equal(decisionBody.adjustment.expectedValueDeltaPaise, -40_000);

    const replayResponse = await request(
      `/api/v1/stock-adjustments/${stockAdjustmentId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "idempotency-key": stockAdjustmentDecisionCommandId,
        },
        body: JSON.stringify(decisionPayload),
      },
    );
    const replayBody = await replayResponse.json();
    assert.equal(replayResponse.status, 200);
    assert.equal(replayBody.adjustment.id, stockAdjustmentId);
    assert.equal(replayBody.adjustment.replayed, true);

    const afterApproval = await database.query(
      `SELECT quantity_on_hand, inventory_value_paise, version,
              (SELECT count(*)::int FROM inventory_movements
                WHERE variant_id = $1) AS movement_count
         FROM inventory_balances
        WHERE variant_id = $1`,
      [newProductVariantId],
    );
    assert.equal(afterApproval.rows[0].quantity_on_hand, 1);
    assert.equal(Number(afterApproval.rows[0].inventory_value_paise), 40_000);
    assert.equal(
      afterApproval.rows[0].movement_count,
      beforeApproval.rows[0].movement_count + 1,
    );

    const historyResponse = await request(
      `/api/v1/inventory/${newProductVariantId}/history`,
    );
    const historyBody = await historyResponse.json();
    assert.equal(historyResponse.status, 200);
    assert.equal(historyBody.inventory.balances.SELLABLE, 1);
    assert.equal(historyBody.inventory.ledgerBalances.SELLABLE, 1);
    assert.equal(historyBody.inventory.reconciled, true);
    assert.equal(historyBody.inventory.movements[0].movementType, "ADJUSTMENT");
    assert.equal(historyBody.inventory.movements[0].quantityDelta, -1);
    assert.equal(historyBody.inventory.movements[0].reason, "PHYSICAL_COUNT");

    await capture(
      "/inventory",
      "owner-inventory-history-mobile.png",
      { width: 390, height: 1000 },
      async (page) => {
        await page.locator(".product-row", {
          hasText: newProductPayload.productName,
        }).click();
        await page.getByText("Ledger matches balances").waitFor();
        await page.getByText("Approved stock count").waitFor();
        await page.getByText("Weighted average").waitFor();
      },
    );

    return {
      storeCountDeniedResponse,
      staleDecisionBody,
      pending,
      decisionBody,
      replayBody,
      afterApproval,
      historyBody,
    };
  };

  await database.query(
    "UPDATE app_users SET role = 'STORE_OPERATOR', updated_at = now() WHERE id = $1",
    [localUserId],
  );

  const invalidCartLines = [
    { variantId: product.id, quantity: 1, unitPricePaise: product.minimumPricePaise },
    {
      variantId: secondProduct.id,
      quantity: secondProduct.stock + 1,
      unitPricePaise: secondProduct.minimumPricePaise,
    },
  ];
  const invalidCartResponse = await request("/api/v1/sales", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({
      lines: invalidCartLines,
      payments: onePayment(invalidCartLines),
    }),
  });
  const invalidCartBody = await invalidCartResponse.json();
  assert.equal(invalidCartResponse.status, 409);
  assert.equal(invalidCartBody.error.code, "INSUFFICIENT_STOCK");
  const stockAfterDeniedCartResponse = await request(
    "/api/v1/catalog?q=IMT-CAR-RC-0001-RED",
  );
  const stockAfterDeniedCartBody = await stockAfterDeniedCartResponse.json();
  assert.equal(stockAfterDeniedCartBody.products[0].stock, product.stock);

  const duplicateCartLines = [
    { variantId: product.id, quantity: 1, unitPricePaise: product.minimumPricePaise },
    { variantId: product.id, quantity: 1, unitPricePaise: product.minimumPricePaise },
  ];
  const duplicateCartResponse = await request("/api/v1/sales", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({
      lines: duplicateCartLines,
      payments: onePayment(duplicateCartLines),
    }),
  });
  const duplicateCartBody = await duplicateCartResponse.json();
  assert.equal(duplicateCartResponse.status, 400);
  assert.equal(duplicateCartBody.error.code, "INVALID_REQUEST");

  saleCommandId = randomUUID();
  const saleLines = [
    {
      variantId: product.id,
      quantity: 1,
      unitPricePaise: product.minimumPricePaise,
    },
    {
      variantId: secondProduct.id,
      quantity: 1,
      unitPricePaise: secondProduct.minimumPricePaise,
    },
  ];
  const invalidPaymentResponse = await request("/api/v1/sales", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({
      lines: saleLines,
      payments: [{
        paymentMode: "UPI",
        amountPaise: lineTotal(saleLines) - 1,
      }],
      customerId,
    }),
  });
  const invalidPaymentBody = await invalidPaymentResponse.json();
  assert.equal(invalidPaymentResponse.status, 400);
  assert.equal(invalidPaymentBody.error.code, "INVALID_PAYMENTS");

  const salePayload = {
    lines: saleLines,
    payments: twoPayments(saleLines),
    customerId,
  };
  const saleResponse = await request("/api/v1/sales", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": saleCommandId,
    },
    body: JSON.stringify(salePayload),
  });
  const saleBody = await saleResponse.json();
  assert.equal(saleResponse.status, 201);
  assert.match(saleBody.sale.saleNumber, /^SAL-[0-9A-F]{12}$/);
  assert.ok(Number.isFinite(Date.parse(saleBody.sale.completedAt)));
  assert.equal(saleBody.sale.customerName, "Synthetic Customer");
  assert.equal(saleBody.sale.payments.length, 2);
  assert.equal(saleBody.sale.lines.length, 2);
  assert.equal(saleBody.sale.lines[0].quantity, 1);
  assert.equal(typeof saleBody.sale.lines[0].unitPricePaise, "number");
  assert.equal(typeof saleBody.sale.lines[0].sku, "string");
  const storedSplitPayments = await database.query(
    `SELECT payment_mode, amount_paise
       FROM sale_payments
      WHERE sale_id = $1
      ORDER BY payment_mode`,
    [saleBody.sale.saleId],
  );
  assert.equal(storedSplitPayments.rows.length, 2);
  assert.equal(
    storedSplitPayments.rows.reduce((total, payment) => total + Number(payment.amount_paise), 0),
    saleBody.sale.totalPaise,
  );
  assert.equal(
    saleBody.sale.lines.find((line) => line.variantId === product.id).remainingStock,
    product.stock - 1,
  );
  assert.equal(
    saleBody.sale.lines.find((line) => line.variantId === secondProduct.id).remainingStock,
    secondProduct.stock - 1,
  );

  const replayResponse = await request("/api/v1/sales", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": saleCommandId,
    },
    body: JSON.stringify(salePayload),
  });
  const replayBody = await replayResponse.json();
  assert.equal(replayResponse.status, 200);
  assert.equal(replayBody.sale.saleId, saleBody.sale.saleId);
  assert.equal(replayBody.sale.lines.length, 2);

  await capture("/activity", "operator-activity-mobile.png", { width: 390, height: 844 }, async (page) => {
    await page.getByRole("heading", { name: "Activity" }).waitFor();
    await page.getByText(saleBody.sale.saleNumber).waitFor();
    await page.getByText("Your recent sales and approval requests.").waitFor();
    assert.equal(await page.getByText(/Accounting COGS|replacement cost/i).count(), 0);
  });

  const requestedUnitPricePaise = Math.max(1, Math.round(product.minimumPricePaise / 2));
  const approvalRequestResponse = await request("/api/v1/price-approvals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      variantId: product.id,
      quantity: 1,
      requestedUnitPricePaise,
    }),
  });
  const approvalRequestBody = await approvalRequestResponse.json();
  assert.equal(approvalRequestResponse.status, 201);
  assert.equal(approvalRequestBody.approval.status, "PENDING");
  assert.equal(approvalRequestBody.approval.expectedGrossResultPaise, undefined);
  approvalId = approvalRequestBody.approval.id;

  await capture("/", "operator-lower-price-mobile.png", { width: 390, height: 844 }, async (page) => {
    await page.locator(".product-row").first().click();
    await page.getByRole("button", { name: "Customer needs a lower price" }).click();
  });
  await capture("/", "operator-multi-cart-mobile.png", { width: 390, height: 844 }, async (page) => {
    await page.locator(".product-row").nth(0).click();
    await page.getByRole("button", { name: "Add to cart" }).click();
    await page.locator(".product-row").nth(1).click();
    await page.getByRole("button", { name: "Add to cart" }).click();
  });
  await capture("/", "operator-split-payment-mobile.png", { width: 390, height: 844 }, async (page) => {
    await page.locator(".product-row").nth(0).click();
    await page.getByRole("button", { name: "Add to cart" }).click();
    await page.locator(".product-row").nth(1).click();
    await page.getByRole("button", { name: "Add to cart" }).click();
    await page.getByLabel("Split between two payment methods").check();
    await page.getByLabel("First amount (₹)").fill("300");
  });

  const deniedExceptionalSaleResponse = await request("/api/v1/sales", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({
      ...salePayload,
      lines: salePayload.lines.map((line) => line.variantId === product.id
        ? { ...line, unitPricePaise: requestedUnitPricePaise }
        : line),
    }),
  });
  const deniedExceptionalSaleBody = await deniedExceptionalSaleResponse.json();
  assert.equal(deniedExceptionalSaleResponse.status, 409);
  assert.equal(deniedExceptionalSaleBody.error.code, "PRICE_APPROVAL_REQUIRED");

  await database.query(
    "UPDATE app_users SET role = 'BUSINESS_OWNER', updated_at = now() WHERE id = $1",
    [localUserId],
  );
  const ownerApprovalsResponse = await request("/api/v1/price-approvals");
  const ownerApprovalsBody = await ownerApprovalsResponse.json();
  assert.equal(ownerApprovalsResponse.status, 200);
  const ownerApproval = ownerApprovalsBody.approvals.find((item) => item.id === approvalId);
  assert.equal(typeof ownerApproval.expectedReplacementMarginPaise, "number");

  await capture("/approvals", "owner-approval-desktop.png", { width: 1440, height: 1000 });

  const approvalDecisionResponse = await request(`/api/v1/price-approvals/${approvalId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision: "APPROVE", reason: "CLEARANCE" }),
  });
  const approvalDecisionBody = await approvalDecisionResponse.json();
  assert.equal(approvalDecisionResponse.status, 200);
  assert.equal(approvalDecisionBody.approval.status, "APPROVED");

  await capture(
    "/activity?type=approvals",
    "owner-approval-activity-desktop.png",
    { width: 1200, height: 900 },
    async (page) => {
      await page.getByRole("heading", { name: "Activity" }).waitFor();
      await page.getByText("Recent sales and approval decisions across the business.").waitFor();
      await page.getByText("Lower-price request").first().waitFor();
      await page.getByText("Approved").first().waitFor();
    },
  );

  await database.query(
    "UPDATE app_users SET role = 'STORE_OPERATOR', updated_at = now() WHERE id = $1",
    [localUserId],
  );
  const approvedLookupResponse = await request(`/api/v1/price-approvals/${approvalId}`);
  const approvedLookupBody = await approvedLookupResponse.json();
  assert.equal(approvedLookupResponse.status, 200);
  assert.equal(approvedLookupBody.approval.status, "APPROVED");
  assert.equal(approvedLookupBody.approval.expectedGrossResultPaise, undefined);

  approvalSaleCommandId = randomUUID();
  const approvalSalePayload = {
    ...salePayload,
    lines: salePayload.lines.map((line) => line.variantId === product.id
      ? { ...line, unitPricePaise: requestedUnitPricePaise, approvalId }
      : line),
  };
  approvalSalePayload.payments = onePayment(approvalSalePayload.lines);
  const approvalSaleResponse = await request("/api/v1/sales", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": approvalSaleCommandId,
    },
    body: JSON.stringify(approvalSalePayload),
  });
  const approvalSaleBody = await approvalSaleResponse.json();
  assert.equal(approvalSaleResponse.status, 201);
  assert.equal(approvalSaleBody.sale.lines.length, 2);
  assert.equal(
    approvalSaleBody.sale.lines.find((line) => line.variantId === product.id).remainingStock,
    product.stock - 2,
  );

  const consumedApprovalResponse = await request(`/api/v1/price-approvals/${approvalId}`);
  const consumedApprovalBody = await consumedApprovalResponse.json();
  assert.equal(consumedApprovalBody.approval.status, "CONSUMED");

  await database.query(
    "UPDATE app_users SET role = 'BUSINESS_OWNER', updated_at = now() WHERE id = $1",
    [localUserId],
  );
  const ownerCatalogResponse = await request("/api/v1/catalog?q=IMT-CAR-RC-0001-RED");
  const ownerCatalogBody = await ownerCatalogResponse.json();
  assert.equal(ownerCatalogResponse.status, 200);
  const ownerExceptionPricePaise = ownerCatalogBody.products[0].minimumPricePaise - 500;
  const ownerExceptionLinesWithoutReason = [{
    ...salePayload.lines[0],
    unitPricePaise: ownerExceptionPricePaise,
  }];
  const ownerExceptionWithoutReasonResponse = await request("/api/v1/sales", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({
      lines: ownerExceptionLinesWithoutReason,
      payments: onePayment(ownerExceptionLinesWithoutReason),
    }),
  });
  const ownerExceptionWithoutReasonBody = await ownerExceptionWithoutReasonResponse.json();
  assert.equal(ownerExceptionWithoutReasonResponse.status, 409);
  assert.equal(ownerExceptionWithoutReasonBody.error.code, "PRICE_APPROVAL_REQUIRED");

  ownerExceptionSaleCommandId = randomUUID();
  const ownerExceptionLines = [{
    ...salePayload.lines[0],
    unitPricePaise: ownerExceptionPricePaise,
    ownerException: { reason: "CLEARANCE" },
  }];
  const ownerExceptionSaleResponse = await request("/api/v1/sales", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": ownerExceptionSaleCommandId,
    },
    body: JSON.stringify({
      lines: ownerExceptionLines,
      payments: onePayment(ownerExceptionLines),
    }),
  });
  const ownerExceptionSaleBody = await ownerExceptionSaleResponse.json();
  assert.equal(ownerExceptionSaleResponse.status, 201);
  assert.equal(ownerExceptionSaleBody.sale.lines.length, 1);
  const stockBeforeReceiptResponse = await request("/api/v1/catalog?q=");
  const stockBeforeReceiptBody = await stockBeforeReceiptResponse.json();
  assert.equal(stockBeforeReceiptResponse.status, 200);
  const stockBeforeReceipt = new Map(
    stockBeforeReceiptBody.products.map((item) => [item.id, item.stock]),
  );

  await capture(
    "/receive",
    "owner-receipt-review-desktop.png",
    { width: 1200, height: 900 },
    async (page) => {
      await page.getByRole("heading", { name: "Receipts awaiting review" }).waitFor();
      await page.getByText(trustedDraftBody.draft.receiptNumber).waitFor();
      await page.getByRole("button", { name: "Complete and add 8 units" }).waitFor();
    },
  );

  const receiptResponse = await request(
    `/api/v1/stock-receipts/${draftReceiptId}/complete`,
    {
      method: "POST",
      headers: { "idempotency-key": receiptCompletionCommandId },
    },
  );
  const receiptBody = await receiptResponse.json();
  assert.equal(receiptResponse.status, 201);
  assert.equal(receiptBody.receipt.lines.length, 2);
  assert.equal(receiptBody.receipt.totalReceivedQuantity, 8);
  assert.equal(receiptBody.receipt.totalSellableQuantity, 5);
  assert.equal(receiptBody.receipt.totalOpenBoxQuantity, 2);
  assert.equal(receiptBody.receipt.totalDamagedQuantity, 1);
  assert.equal(
    receiptBody.receipt.lines.find((line) => line.variantId === product.id).newStock,
    stockBeforeReceipt.get(product.id) + 2,
  );
  assert.equal(
    receiptBody.receipt.lines.find((line) => line.variantId === secondProduct.id).newStock,
    stockBeforeReceipt.get(secondProduct.id) + 3,
  );
  const productReceiptLine = receiptBody.receipt.lines.find(
    (line) => line.variantId === product.id,
  );
  const secondProductReceiptLine = receiptBody.receipt.lines.find(
    (line) => line.variantId === secondProduct.id,
  );
  assert.equal(
    productReceiptLine.newDamagedStock,
    stockBeforeReceiptBody.products.find((item) => item.id === product.id).damagedStock + 1,
  );
  assert.equal(
    secondProductReceiptLine.newOpenBoxStock,
    stockBeforeReceiptBody.products.find((item) => item.id === secondProduct.id).openBoxStock + 2,
  );

  const receiptReplayResponse = await request(
    `/api/v1/stock-receipts/${draftReceiptId}/complete`,
    {
      method: "POST",
      headers: { "idempotency-key": receiptCompletionCommandId },
    },
  );
  const receiptReplayBody = await receiptReplayResponse.json();
  assert.equal(receiptReplayResponse.status, 200);
  assert.equal(receiptReplayBody.receipt.receiptId, receiptBody.receipt.receiptId);
  assert.deepEqual(receiptReplayBody.receipt.lines, receiptBody.receipt.lines);

  const skuSequence = await database.query(
    "SELECT last_number FROM business_sku_sequences WHERE business_id = $1",
    [business.rows[0].id],
  );
  newProductSequenceBefore = skuSequence.rows[0].last_number;
  const newProductResponse = await request("/api/v1/products", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": newProductCommandId,
    },
    body: JSON.stringify(newProductPayload),
  });
  const newProductBody = await newProductResponse.json();
  assert.equal(newProductResponse.status, 201);
  assert.match(
    newProductBody.product.sku,
    /^IMT-EDU-SCI-[0-9]{4}-BLU$/,
  );
  assert.equal(newProductBody.product.barcode, newProductBody.product.sku);
  assert.equal(newProductBody.product.rackLocation, "C2-S3");
  assert.equal(newProductBody.product.stock, 0);
  assert.equal(newProductBody.product.openBoxStock, 0);
  assert.equal(newProductBody.product.minimumPricePaise, 60_000);
  newProductVariantId = newProductBody.product.id;
  newProductSequenceNumber = Number(
    newProductBody.product.sku.match(/-([0-9]{4})-/)?.[1],
  );
  assert.equal(newProductSequenceNumber, newProductSequenceBefore + 1);
  const storedProductFloors = await database.query(
    `SELECT owner_floor_paise, trusted_operator_floor_paise,
            store_operator_floor_paise
       FROM price_versions
      WHERE variant_id = $1 AND effective_to IS NULL`,
    [newProductVariantId],
  );
  assert.deepEqual(
    storedProductFloors.rows.map((row) => [
      Number(row.owner_floor_paise),
      Number(row.trusted_operator_floor_paise),
      Number(row.store_operator_floor_paise),
    ]),
    [[60_000, 70_000, 75_000]],
  );

  const newProductReplayResponse = await request("/api/v1/products", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": newProductCommandId,
    },
    body: JSON.stringify(newProductPayload),
  });
  const newProductReplayBody = await newProductReplayResponse.json();
  assert.equal(newProductReplayResponse.status, 200);
  assert.equal(newProductReplayBody.product.id, newProductVariantId);
  assert.equal(newProductReplayBody.product.sku, newProductBody.product.sku);

  const alternateBarcodeResponse = await request(
    `/api/v1/catalog?q=${encodeURIComponent(newProductPayload.supplierBarcode)}`,
  );
  const alternateBarcodeBody = await alternateBarcodeResponse.json();
  assert.equal(alternateBarcodeResponse.status, 200);
  assert.equal(alternateBarcodeBody.products[0].id, newProductVariantId);
  assert.equal(alternateBarcodeBody.products[0].stock, 0);

  newProductReceiptCommandId = randomUUID();
  const newProductReceiptPayload = {
    supplierId,
    supplierInvoiceReference: `NEW-${marker}`,
    note: "Temporary new-product receiving proof",
    lines: [{
      variantId: newProductVariantId,
      sellableQuantity: 3,
      openBoxQuantity: 1,
      damagedQuantity: 0,
      invoiceUnitCostPaise: 40_000,
    }],
  };
  const newProductReceiptResponse = await request("/api/v1/stock-receipts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": newProductReceiptCommandId,
    },
    body: JSON.stringify(newProductReceiptPayload),
  });
  const newProductReceiptBody = await newProductReceiptResponse.json();
  assert.equal(newProductReceiptResponse.status, 201);
  assert.equal(newProductReceiptBody.receipt.totalReceivedQuantity, 4);
  assert.equal(newProductReceiptBody.receipt.totalSellableQuantity, 3);
  assert.equal(newProductReceiptBody.receipt.totalOpenBoxQuantity, 1);
  assert.equal(newProductReceiptBody.receipt.lines[0].newSellableStock, 3);
  assert.equal(newProductReceiptBody.receipt.lines[0].newOpenBoxStock, 1);
  assert.equal(newProductReceiptBody.receipt.lines[0].weightedAverageCostPaise, 40_000);

  await capture(
    "/receive",
    "owner-new-product-mobile.png",
    { width: 390, height: 1000 },
    async (page) => {
      await page.getByRole("button", { name: "Create new product" }).click();
      await page.getByLabel("Product name").fill("Space Explorer Activity Kit");
      await page.getByLabel("Category", { exact: true }).fill("Educational");
      await page.getByLabel("Category code", { exact: true }).fill("EDU");
      await page.getByLabel("Sub-category", { exact: true }).fill("Science Kits");
      await page.getByLabel("Sub-category code", { exact: true }).fill("SCI");
      await page.getByLabel("Variant, optional").fill("Green");
      await page.getByLabel("Variant code, optional").fill("GRN");
      await page.getByLabel("Primary rack · S1 bottom, S6 top").selectOption("C2-S3");
      await page.getByLabel("Purchase cost (₹)").fill("400");
      await page.getByLabel("Standard selling price (₹)").fill("800");
      await page.getByLabel("MRP (₹)").fill("1000");
      await page.getByText("IMT-EDU-SCI-####-GRN").waitFor();
      await page.getByText("₹640.00").waitFor();
    },
  );

  const existingProductChangeProof = await proveExistingProductChange();
  const stockCountProof = await proveStockCountAndMovementHistory();
  const invalidReorderPolicyResponse = await request(
    `/api/v1/inventory/${newProductVariantId}/reorder-policy`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({
        reorderPoint: 5,
        restockTarget: 5,
        reason: "INITIAL_SETUP",
        note: "Invalid policy boundary proof.",
      }),
    },
  );
  const invalidReorderPolicyBody = await invalidReorderPolicyResponse.json();
  assert.equal(invalidReorderPolicyResponse.status, 400);
  assert.equal(invalidReorderPolicyBody.error.code, "INVALID_REORDER_POLICY");

  const inventoryBeforeReorderPolicy = await database.query(
    `SELECT
       ib.quantity_on_hand,
       ib.inventory_value_paise,
       count(m.id)::int AS movement_count
     FROM inventory_balances ib
     LEFT JOIN inventory_movements m ON m.variant_id = ib.variant_id
     WHERE ib.variant_id = $1
     GROUP BY ib.quantity_on_hand, ib.inventory_value_paise`,
    [newProductVariantId],
  );
  reorderPolicyCommandId = randomUUID();
  const reorderPolicyResponse = await request(
    `/api/v1/inventory/${newProductVariantId}/reorder-policy`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "idempotency-key": reorderPolicyCommandId,
      },
      body: JSON.stringify({
        reorderPoint: 2,
        restockTarget: 8,
        reason: "INITIAL_SETUP",
        note: "Acceptance proof for owner-controlled replenishment.",
      }),
    },
  );
  const reorderPolicyBody = await reorderPolicyResponse.json();
  assert.equal(reorderPolicyResponse.status, 201);
  assert.equal(reorderPolicyBody.change.policy.status, "CONFIGURED");
  assert.equal(reorderPolicyBody.change.policy.reorderPoint, 2);
  assert.equal(reorderPolicyBody.change.policy.restockTarget, 8);
  assert.equal(reorderPolicyBody.change.policy.suggestedReorderQuantity, 7);
  assert.equal(reorderPolicyBody.change.previous.reorderPoint, null);
  assert.equal(reorderPolicyBody.change.previous.restockTarget, null);
  reorderPolicyChangeId = reorderPolicyBody.change.changeId;

  const reorderPolicyReplayResponse = await request(
    `/api/v1/inventory/${newProductVariantId}/reorder-policy`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "idempotency-key": reorderPolicyCommandId,
      },
      body: JSON.stringify({
        reorderPoint: 2,
        restockTarget: 8,
        reason: "INITIAL_SETUP",
        note: "Acceptance proof for owner-controlled replenishment.",
      }),
    },
  );
  const reorderPolicyReplayBody = await reorderPolicyReplayResponse.json();
  assert.equal(reorderPolicyReplayResponse.status, 200);
  assert.equal(reorderPolicyReplayBody.change.replayed, true);
  assert.equal(reorderPolicyReplayBody.change.changeId, reorderPolicyChangeId);

  const disableReorderPolicyResponse = await request(
    `/api/v1/inventory/${newProductVariantId}/reorder-policy`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({
        reorderPoint: null,
        restockTarget: null,
        reason: "OTHER",
        note: "Acceptance proof for an explicitly disabled policy.",
      }),
    },
  );
  const disableReorderPolicyBody = await disableReorderPolicyResponse.json();
  assert.equal(disableReorderPolicyResponse.status, 201);
  assert.equal(disableReorderPolicyBody.change.policy.status, "DISABLED");
  assert.equal(
    disableReorderPolicyBody.change.policy.suggestedReorderQuantity,
    null,
  );
  const disabledInventoryHistoryResponse = await request(
    `/api/v1/inventory/${newProductVariantId}/history`,
  );
  const disabledInventoryHistoryBody =
    await disabledInventoryHistoryResponse.json();
  assert.equal(disabledInventoryHistoryResponse.status, 200);
  assert.equal(
    disabledInventoryHistoryBody.inventory.product.reorderPolicyStatus,
    "DISABLED",
  );
  const disabledDashboardResponse = await request("/api/v1/owner/dashboard");
  const disabledDashboardBody = await disabledDashboardResponse.json();
  assert.equal(disabledDashboardResponse.status, 200);
  assert.ok(disabledDashboardBody.dashboard.stock.disabledReorderPolicyCount >= 1);
  assert.equal(
    disabledDashboardBody.dashboard.unconfiguredReorderProducts.some(
      (item) => item.variantId === newProductVariantId,
    ),
    false,
  );

  const reenableReorderPolicyResponse = await request(
    `/api/v1/inventory/${newProductVariantId}/reorder-policy`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({
        reorderPoint: 2,
        restockTarget: 8,
        reason: "DATA_CORRECTION",
        note: "Restore the configured policy after disabled-state proof.",
      }),
    },
  );
  const reenableReorderPolicyBody =
    await reenableReorderPolicyResponse.json();
  assert.equal(reenableReorderPolicyResponse.status, 201);
  assert.equal(reenableReorderPolicyBody.change.policy.status, "CONFIGURED");
  assert.equal(
    reenableReorderPolicyBody.change.policy.suggestedReorderQuantity,
    7,
  );

  const reorderInventoryHistoryResponse = await request(
    `/api/v1/inventory/${newProductVariantId}/history`,
  );
  const reorderInventoryHistoryBody = await reorderInventoryHistoryResponse.json();
  assert.equal(reorderInventoryHistoryResponse.status, 200);
  assert.equal(
    reorderInventoryHistoryBody.inventory.product.reorderPolicyStatus,
    "CONFIGURED",
  );
  assert.equal(reorderInventoryHistoryBody.inventory.product.reorderPoint, 2);
  assert.equal(reorderInventoryHistoryBody.inventory.product.restockTarget, 8);
  const inventoryAfterReorderPolicy = await database.query(
    `SELECT
       ib.quantity_on_hand,
       ib.inventory_value_paise,
       count(m.id)::int AS movement_count
     FROM inventory_balances ib
     LEFT JOIN inventory_movements m ON m.variant_id = ib.variant_id
     WHERE ib.variant_id = $1
     GROUP BY ib.quantity_on_hand, ib.inventory_value_paise`,
    [newProductVariantId],
  );
  assert.deepEqual(
    inventoryAfterReorderPolicy.rows,
    inventoryBeforeReorderPolicy.rows,
  );

  await capture(
    `/inventory?product=${newProductVariantId}`,
    "owner-reorder-policy-mobile.png",
    { width: 390, height: 1000 },
    async (page) => {
      await page.getByRole("heading", { name: "Set reorder policy" }).waitFor();
      await page.getByText("Order 7 now").waitFor();
    },
  );

  const dashboardResponse = await request("/api/v1/owner/dashboard");
  const dashboardBody = await dashboardResponse.json();
  assert.equal(dashboardResponse.status, 200);
  assert.ok(dashboardBody.dashboard.today.orderCount > 0);
  assert.ok(dashboardBody.dashboard.today.revenuePaise > 0);
  assert.equal(
    dashboardBody.dashboard.payments.reduce(
      (sum, payment) => sum + payment.amountPaise,
      0,
    ),
    dashboardBody.dashboard.today.revenuePaise,
  );
  assert.ok(
    dashboardBody.dashboard.sellers.some(
      (seller) => seller.name === "Synthetic Operator",
    ),
  );
  assert.equal(dashboardBody.dashboard.dataQuality.ledgerMismatchCount, 0);
  assert.ok(
    dashboardBody.dashboard.lowStockProducts.some(
      (item) =>
        item.variantId === newProductVariantId
        && item.quantity === 1
        && item.reorderPoint === 2
        && item.restockTarget === 8
        && item.suggestedReorderQuantity === 7,
    ),
  );
  assert.ok(dashboardBody.dashboard.stock.configuredReorderPolicyCount >= 1);
  assert.ok(dashboardBody.dashboard.stock.unconfiguredReorderPolicyCount >= 1);

  const openClosingResponse = await request("/api/v1/daily-closing");
  const openClosingBody = await openClosingResponse.json();
  assert.equal(openClosingResponse.status, 200);
  assert.equal(openClosingBody.closing.status, "OPEN");
  assert.equal(openClosingBody.closing.latestClosing, null);
  assert.equal(
    openClosingBody.closing.current.payments.reduce(
      (sum, payment) => sum + payment.expectedAmountPaise,
      0,
    ),
    openClosingBody.closing.current.revenuePaise,
  );
  const expectedClosingPayment = (mode) =>
    openClosingBody.closing.current.payments.find(
      (payment) => payment.paymentMode === mode,
    )?.expectedAmountPaise ?? 0;
  const openingCashPaise = 10_000;
  const cashPaidInPaise = 5_000;
  const cashPaidOutPaise = 2_000;
  const countedCashPaise =
    openingCashPaise
    + expectedClosingPayment("CASH")
    + cashPaidInPaise
    - cashPaidOutPaise;
  const firstClosingPayload = {
    openingCashPaise,
    cashPaidInPaise,
    cashPaidOutPaise,
    countedCashPaise,
    verifiedDigitalPayments: {
      UPI: expectedClosingPayment("UPI"),
      CARD: expectedClosingPayment("CARD"),
      BANK_TRANSFER: expectedClosingPayment("BANK_TRANSFER"),
    },
    cashMovementNote: "Temporary ₹50 cash added and ₹20 removed for acceptance proof.",
    closingNote: "Synthetic daily closing acceptance proof.",
  };

  await capture(
    "/closing",
    "owner-daily-closing-form-mobile.png",
    { width: 390, height: 1000 },
    async (page) => {
      await page.getByRole("heading", { name: "Close with evidence." }).waitFor();
      await page.getByLabel("Opening cash float").fill("100");
      await page.getByLabel("Cash paid in").fill("50");
      await page.getByLabel("Cash paid out").fill("20");
      await page.getByLabel("Explain cash paid in or out").fill(
        "Temporary ₹50 cash added and ₹20 removed for acceptance proof.",
      );
      await page.getByLabel("Cash physically counted").fill(
        String(countedCashPaise / 100),
      );
      await page.getByLabel("UPI verified amount").fill(
        String(expectedClosingPayment("UPI") / 100),
      );
      await page.getByLabel("Card verified amount").fill(
        String(expectedClosingPayment("CARD") / 100),
      );
      await page.getByLabel("Bank transfer verified amount").fill(
        String(expectedClosingPayment("BANK_TRANSFER") / 100),
      );
      await page.getByText("Read each total from the payment provider").waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Record daily closing" }).isEnabled(),
        true,
      );
    },
  );

  firstClosingCommandId = randomUUID();
  const firstClosingResponse = await request("/api/v1/daily-closing", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": firstClosingCommandId,
    },
    body: JSON.stringify(firstClosingPayload),
  });
  const firstClosingBody = await firstClosingResponse.json();
  assert.equal(firstClosingResponse.status, 201);
  assert.equal(firstClosingBody.closing.revision, 1);
  assert.equal(firstClosingBody.closing.hasVariance, false);
  assert.equal(firstClosingBody.closing.cashVariancePaise, 0);
  firstClosingId = firstClosingBody.closing.id;

  const firstClosingReplayResponse = await request("/api/v1/daily-closing", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": firstClosingCommandId,
    },
    body: JSON.stringify(firstClosingPayload),
  });
  const firstClosingReplayBody = await firstClosingReplayResponse.json();
  assert.equal(firstClosingReplayResponse.status, 200);
  assert.equal(firstClosingReplayBody.closing.id, firstClosingId);
  assert.equal(firstClosingReplayBody.closing.replayed, true);

  const closedViewResponse = await request("/api/v1/daily-closing");
  const closedViewBody = await closedViewResponse.json();
  assert.equal(closedViewResponse.status, 200);
  assert.equal(closedViewBody.closing.status, "CLOSED");

  await capture(
    "/dashboard",
    "owner-dashboard-mobile.png",
    { width: 390, height: 1000 },
    async (page) => {
      await page.getByRole("heading", {
        name: "Know what needs attention.",
      }).waitFor();
      await page.getByRole("heading", { name: "Action queue" }).waitFor();
      await page.getByText("Accounting gross product profit").waitFor();
      await page.getByText(newProductPayload.productName).waitFor();
      await page.getByText("Ledger mismatches").waitFor();
    },
  );

  await capture(
    `/inventory?product=${newProductVariantId}`,
    "owner-dashboard-stock-deep-link-mobile.png",
    { width: 390, height: 1000 },
    async (page) => {
      await page.getByText("Ledger matches balances").waitFor();
      await page.getByText(newProductPayload.productName, { exact: false }).first().waitFor();
      assert.equal(
        await page.locator(".product-row.selected", {
          hasText: newProductPayload.productName,
        }).count(),
        1,
      );
    },
  );

  await database.query(
    "UPDATE app_users SET role = 'STORE_OPERATOR', updated_at = now() WHERE id = $1",
    [localUserId],
  );
  const highValueCatalogResponse = await request("/api/v1/catalog?q=");
  const highValueCatalogBody = await highValueCatalogResponse.json();
  assert.equal(highValueCatalogResponse.status, 200);
  let amountNeededPaise = 500_000;
  const highValueLines = [];
  for (const item of highValueCatalogBody.products) {
    if (item.stock < 1 || highValueLines.length >= 20) continue;
    const quantity = Math.min(
      item.stock,
      20,
      Math.max(1, Math.ceil(amountNeededPaise / item.standardPricePaise)),
    );
    highValueLines.push({
      variantId: item.id,
      quantity,
      unitPricePaise: item.standardPricePaise,
    });
    amountNeededPaise -= quantity * item.standardPricePaise;
    if (amountNeededPaise <= 0) break;
  }
  assert.ok(amountNeededPaise <= 0, "Demo stock cannot form a ₹5,000 acceptance cart.");

  highValueSaleCommandId = randomUUID();
  const highValuePayload = { payments: onePayment(highValueLines), lines: highValueLines };
  const unapprovedGuestResponse = await request("/api/v1/sales", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": highValueSaleCommandId,
    },
    body: JSON.stringify(highValuePayload),
  });
  const unapprovedGuestBody = await unapprovedGuestResponse.json();
  assert.equal(unapprovedGuestResponse.status, 409);
  assert.equal(
    unapprovedGuestBody.error.code,
    "CUSTOMER_OR_GUEST_APPROVAL_REQUIRED",
  );

  const guestRequestResponse = await request("/api/v1/guest-sale-approvals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      saleCommandId: highValueSaleCommandId,
      lines: highValueLines,
    }),
  });
  const guestRequestBody = await guestRequestResponse.json();
  assert.equal(guestRequestResponse.status, 201);
  assert.equal(guestRequestBody.approval.status, "PENDING");
  guestApprovalId = guestRequestBody.approval.id;

  await capture("/", "operator-customer-finder-mobile.png", { width: 390, height: 844 }, async (page) => {
    await page.locator(".product-row:has(.stock-pill:not(.empty))").first().click();
    await page.getByRole("button", { name: "Add to cart" }).click();
    await page.getByRole("button", { name: "Find or add customer" }).click();
  });

  await database.query(
    "UPDATE app_users SET role = 'BUSINESS_OWNER', updated_at = now() WHERE id = $1",
    [localUserId],
  );
  const guestOwnerListResponse = await request("/api/v1/guest-sale-approvals");
  const guestOwnerListBody = await guestOwnerListResponse.json();
  assert.equal(guestOwnerListResponse.status, 200);
  assert.ok(guestOwnerListBody.approvals.some((item) => item.id === guestApprovalId));

  await capture("/approvals", "owner-guest-approval-desktop.png", { width: 1440, height: 1000 });

  const guestDecisionResponse = await request(
    `/api/v1/guest-sale-approvals/${guestApprovalId}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "APPROVE", note: "Synthetic customer declined." }),
    },
  );
  const guestDecisionBody = await guestDecisionResponse.json();
  assert.equal(guestDecisionResponse.status, 200);
  assert.equal(guestDecisionBody.approval.status, "APPROVED");

  await database.query(
    "UPDATE app_users SET role = 'STORE_OPERATOR', updated_at = now() WHERE id = $1",
    [localUserId],
  );
  const highValueSaleResponse = await request("/api/v1/sales", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": highValueSaleCommandId,
    },
    body: JSON.stringify({ ...highValuePayload, guestApprovalId }),
  });
  const highValueSaleBody = await highValueSaleResponse.json();
  assert.equal(highValueSaleResponse.status, 201);
  assert.ok(highValueSaleBody.sale.totalPaise >= 500_000);

  const consumedGuestResponse = await request(
    `/api/v1/guest-sale-approvals/${guestApprovalId}`,
  );
  const consumedGuestBody = await consumedGuestResponse.json();
  assert.equal(consumedGuestResponse.status, 200);
  assert.equal(consumedGuestBody.approval.status, "CONSUMED");

  await capture("/", "operator-sale-receipt-mobile.png", { width: 390, height: 844 }, async (page) => {
    await page.locator(".product-row:has(.stock-pill:not(.empty))").first().click();
    await page.getByRole("button", { name: "Add to cart" }).click();
    await page.getByRole("button", { name: "Complete sale" }).click();
    await page.getByRole("button", { name: "Share receipt" }).click();
    await page.getByText(/Receipt (shared|copied)/).waitFor();
  });

  await database.query(
    "UPDATE app_users SET role = 'BUSINESS_OWNER', updated_at = now() WHERE id = $1",
    [localUserId],
  );
  const staleClosingResponse = await request("/api/v1/daily-closing");
  const staleClosingBody = await staleClosingResponse.json();
  assert.equal(staleClosingResponse.status, 200);
  assert.equal(staleClosingBody.closing.status, "NEEDS_RECONCILIATION");
  assert.ok(staleClosingBody.closing.transactionsAfterClosing >= 1);
  assert.equal(staleClosingBody.closing.latestClosing.id, firstClosingId);

  const currentClosingPayment = (mode) =>
    staleClosingBody.closing.current.payments.find(
      (payment) => payment.paymentMode === mode,
    )?.expectedAmountPaise ?? 0;
  const revisedCountedCashPaise =
    openingCashPaise
    + currentClosingPayment("CASH")
    + cashPaidInPaise
    - cashPaidOutPaise;
  const closingRevisionPayload = {
    ...firstClosingPayload,
    countedCashPaise: revisedCountedCashPaise,
    verifiedDigitalPayments: {
      UPI: currentClosingPayment("UPI"),
      CARD: currentClosingPayment("CARD"),
      BANK_TRANSFER: currentClosingPayment("BANK_TRANSFER"),
    },
    replacesClosingId: firstClosingId,
    correctionReason: "LATE_SALES",
    correctionNote: "Synthetic sales completed after the first closing.",
  };
  closingRevisionCommandId = randomUUID();
  const closingRevisionResponse = await request("/api/v1/daily-closing", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": closingRevisionCommandId,
    },
    body: JSON.stringify(closingRevisionPayload),
  });
  const closingRevisionBody = await closingRevisionResponse.json();
  assert.equal(closingRevisionResponse.status, 201);
  assert.equal(closingRevisionBody.closing.revision, 2);
  assert.equal(closingRevisionBody.closing.supersedesClosingId, firstClosingId);
  assert.equal(closingRevisionBody.closing.cashVariancePaise, 0);
  closingRevisionId = closingRevisionBody.closing.id;

  const reconciledClosingResponse = await request("/api/v1/daily-closing");
  const reconciledClosingBody = await reconciledClosingResponse.json();
  assert.equal(reconciledClosingResponse.status, 200);
  assert.equal(reconciledClosingBody.closing.status, "CLOSED");
  assert.equal(reconciledClosingBody.closing.latestClosing.id, closingRevisionId);

  await capture(
    "/closing",
    "owner-daily-closing-record-mobile.png",
    { width: 390, height: 1000 },
    async (page) => {
      await page.getByRole("heading", { name: "Close with evidence." }).waitFor();
      await page.getByText(closingRevisionBody.closing.closingNumber).waitFor();
      await page.getByText("Revision 2").waitFor();
      await page.getByText("Immutable closing record").waitFor();
      await page.getByText("Matched", { exact: true }).first().waitFor();
    },
  );

  console.info(
    JSON.stringify({
      event: "local_operations_proved",
      identity: "temporary_synthetic_user",
      mfa: "enforced_and_completed",
      ordinaryEndpoint: meResponse.status,
      role: meBody.user.role,
      ownerOnlyEndpoint: ownerResponse.status,
      decision: ownerBody.error.code,
      ownerDashboardOperatorDenied: ownerDashboardDeniedResponse.status,
      dailyClosingOperatorDenied: dailyClosingDeniedResponse.status,
      productLookup: catalogResponse.status,
      cameraBarcodeScan: product.barcode,
      saleCreated: saleResponse.status,
      stockBefore: product.stock,
      stockAfter: saleBody.sale.lines.find((line) => line.variantId === product.id).remainingStock,
      cartProducts: saleBody.sale.lines.length,
      insufficientCartBlockedAtomically: invalidCartBody.error.code,
      duplicateCartBlocked: duplicateCartBody.error.code,
      invalidPaymentTotalBlocked: invalidPaymentBody.error.code,
      splitPaymentPartsStored: storedSplitPayments.rows.length,
      saleReceiptNumber: saleBody.sale.saleNumber,
      receiptPaymentParts: saleBody.sale.payments.length,
      operatorActivitySale: saleBody.sale.saleNumber,
      ownerApprovalActivity: approvalDecisionBody.approval.status,
      identicalRetry: replayBody.sale.saleId === saleBody.sale.saleId,
      priceApprovalRequested: approvalRequestResponse.status,
      unapprovedExceptionalSaleBlocked: deniedExceptionalSaleBody.error.code,
      priceApprovalDecision: approvalDecisionBody.approval.status,
      exceptionalSaleCreated: approvalSaleResponse.status,
      priceApprovalConsumed: consumedApprovalBody.approval.status,
      ownerExceptionWithoutReasonBlocked: ownerExceptionWithoutReasonBody.error.code,
      ownerExceptionSaleCreated: ownerExceptionSaleResponse.status,
      storeOperatorReceiptDenied: deniedReceiptResponse.status,
      trustedReceiptDraftCreated: trustedDraftResponse.status,
      receiptProductLines: trustedDraftBody.draft.lines.length,
      draftStockUnchanged: stockAfterDraftBody.products[0].stock === product.stock,
      duplicateSupplierInvoiceBlocked:
        duplicateReceiptBody.error.code,
      trustedReceiptCompletionDenied: trustedCompletionResponse.status,
      ownerDraftReceiptCompleted: receiptResponse.status,
      receiptUnitsAdded: receiptBody.receipt.totalReceivedQuantity,
      receiptConditionQuantities: {
        sellable: receiptBody.receipt.totalSellableQuantity,
        openBox: receiptBody.receipt.totalOpenBoxQuantity,
        damaged: receiptBody.receipt.totalDamagedQuantity,
      },
      receiptStocksAfter: receiptBody.receipt.lines.map((line) => ({
        sku: line.sku,
        sellable: line.newSellableStock,
        openBox: line.newOpenBoxStock,
        damaged: line.newDamagedStock,
      })),
      identicalReceiptRetry:
        receiptReplayBody.receipt.receiptId === receiptBody.receipt.receiptId,
      trustedNewProductDenied: trustedNewProductResponse.status,
      trustedProductChangeDenied: trustedProductChangeResponse.status,
      ownerNewProductCreated: newProductResponse.status,
      generatedSku: newProductBody.product.sku,
      ownerFloorOverrideStored:
        Number(storedProductFloors.rows[0].owner_floor_paise) === 60_000,
      internalBarcodeMatchesSku:
        newProductBody.product.barcode === newProductBody.product.sku,
      alternateBarcodeLookup: alternateBarcodeResponse.status,
      identicalProductRetry:
        newProductReplayBody.product.id === newProductVariantId,
      newProductReceipt: {
        sellable: newProductReceiptBody.receipt.totalSellableQuantity,
        openBox: newProductReceiptBody.receipt.totalOpenBoxQuantity,
        damaged: newProductReceiptBody.receipt.totalDamagedQuantity,
      },
      existingProductChange: {
        status: existingProductChangeProof.productChangeResponse.status,
        priceVersions:
          existingProductChangeProof.productPriceHistory.rows.length,
        rack:
          existingProductChangeProof.productChangeBody.change.product
            .rackLocation,
        stockUnchanged:
          existingProductChangeProof.productStateAfterChange.rows[0]
            .quantity_on_hand ===
          existingProductChangeProof.productStateBeforeChange.rows[0]
            .quantity_on_hand,
        staleApproval:
          existingProductChangeProof.staleApprovalLookupBody.approval.status,
        identicalRetry:
          existingProductChangeProof.productChangeReplayBody.change.changeId ===
          productChangeId,
      },
      stockTruth: {
        storeOperatorDenied:
          stockCountProof.storeCountDeniedResponse.status,
        staleCountBlocked: stockCountProof.staleDecisionBody.error.code,
        trustedRecordedQuantity: stockCountProof.pending.recordedQuantity,
        trustedCountedQuantity: stockCountProof.pending.countedQuantity,
        ownerDecision: stockCountProof.decisionBody.adjustment.status,
        finalSellableStock:
          stockCountProof.afterApproval.rows[0].quantity_on_hand,
        finalInventoryValuePaise: Number(
          stockCountProof.afterApproval.rows[0].inventory_value_paise,
        ),
        ledgerReconciled: stockCountProof.historyBody.inventory.reconciled,
        identicalRetry: stockCountProof.replayBody.adjustment.replayed,
      },
      reorderPolicy: {
        storeOperatorDenied: storeReorderPolicyDeniedResponse.status,
        invalidTargetBlocked: invalidReorderPolicyBody.error.code,
        ownerConfigured: reorderPolicyResponse.status,
        point: reorderPolicyBody.change.policy.reorderPoint,
        target: reorderPolicyBody.change.policy.restockTarget,
        suggestedOrderQuantity:
          reorderPolicyBody.change.policy.suggestedReorderQuantity,
        explicitDisable:
          disableReorderPolicyBody.change.policy.status,
        reenabled:
          reenableReorderPolicyBody.change.policy.status,
        stockAndLedgerUnchanged:
          JSON.stringify(inventoryAfterReorderPolicy.rows)
          === JSON.stringify(inventoryBeforeReorderPolicy.rows),
        identicalRetry: reorderPolicyReplayBody.change.replayed,
      },
      ownerDashboard: {
        status: dashboardResponse.status,
        revenuePaise: dashboardBody.dashboard.today.revenuePaise,
        orderCount: dashboardBody.dashboard.today.orderCount,
        units: dashboardBody.dashboard.today.unitCount,
        paymentsReconciled:
          dashboardBody.dashboard.payments.reduce(
            (sum, payment) => sum + payment.amountPaise,
            0,
          ) === dashboardBody.dashboard.today.revenuePaise,
        lowStockSyntheticLinked:
          dashboardBody.dashboard.lowStockProducts.some(
            (item) => item.variantId === newProductVariantId,
          ),
        configuredReorderPolicies:
          dashboardBody.dashboard.stock.configuredReorderPolicyCount,
        unconfiguredReorderPolicies:
          dashboardBody.dashboard.stock.unconfiguredReorderPolicyCount,
        ledgerExceptions:
          dashboardBody.dashboard.dataQuality.ledgerMismatchCount,
      },
      dailyClosing: {
        firstStatus: firstClosingResponse.status,
        firstRevision: firstClosingBody.closing.revision,
        identicalRetry: firstClosingReplayBody.closing.replayed,
        staleAfterLaterSales: staleClosingBody.closing.status,
        laterSales: staleClosingBody.closing.transactionsAfterClosing,
        revisionStatus: closingRevisionResponse.status,
        latestRevision: closingRevisionBody.closing.revision,
        immutableLink:
          closingRevisionBody.closing.supersedesClosingId === firstClosingId,
        reconciled: reconciledClosingBody.closing.status,
      },
      customerCreated: customerCreateResponse.status,
      duplicateCustomerBlocked: duplicateCustomerBody.error.code,
      customerLinkedSale: saleResponse.status,
      highValueGuestWithoutApprovalBlocked: unapprovedGuestBody.error.code,
      guestApprovalDecision: guestDecisionBody.approval.status,
      highValueGuestSaleCreated: highValueSaleResponse.status,
      guestApprovalConsumed: consumedGuestBody.approval.status,
    }),
  );
} finally {
  const cleanupErrors = [];
  const cleanup = async (action) => {
    try {
      await action();
    } catch (error) {
      cleanupErrors.push(error);
    }
  };

  if (sessionId) {
    await cleanup(() => workos.userManagement.revokeSession({ sessionId }));
  }
  if ((firstClosingId || closingRevisionId) && localUserId) {
    await cleanup(async () => {
      await database.query("BEGIN");
      try {
        const closings = await database.query(
          "SELECT id FROM daily_closings WHERE created_by = $1",
          [localUserId],
        );
        const closingIds = closings.rows.map((closing) => closing.id);
        if (closingIds.length > 0) {
          await database.query(
            "DELETE FROM daily_closing_payments WHERE closing_id = ANY($1::uuid[])",
            [closingIds],
          );
          await database.query(
            `DELETE FROM audit_events
              WHERE entity_type = 'DAILY_CLOSING'
                AND entity_id = ANY($1::uuid[])`,
            [closingIds],
          );
          await database.query(
            "DELETE FROM daily_closings WHERE id = ANY($1::uuid[])",
            [closingIds],
          );
        }
        await database.query("COMMIT");
      } catch (error) {
        await database.query("ROLLBACK");
        throw error;
      }
    });
  }
  if (localUserId) {
    await cleanup(async () => {
      await database.query("BEGIN");
      try {
        const sales = await database.query(
          "SELECT id FROM sales WHERE created_by = $1 ORDER BY created_at DESC",
          [localUserId],
        );
        for (const saleRow of sales.rows) {
          const saleCosts = await database.query(
            `SELECT variant_id, COALESCE(SUM(accounting_cogs_paise), 0) AS accounting_cogs_paise
               FROM sale_lines WHERE sale_id = $1 GROUP BY variant_id`,
            [saleRow.id],
          );
          const movement = await database.query(
            `DELETE FROM inventory_movements
              WHERE reference_type = 'SALE' AND reference_id = $1 AND created_by = $2
              RETURNING location_id, variant_id, quantity_delta`,
            [saleRow.id, localUserId],
          );
          await database.query(
            "DELETE FROM audit_events WHERE entity_type = 'SALE' AND entity_id = $1 AND actor_user_id = $2",
            [saleRow.id, localUserId],
          );
          await database.query("DELETE FROM sale_payments WHERE sale_id = $1", [saleRow.id]);
          await database.query("DELETE FROM sale_lines WHERE sale_id = $1", [saleRow.id]);
          await database.query("DELETE FROM sales WHERE id = $1", [saleRow.id]);
          for (const row of movement.rows) {
            const cost = saleCosts.rows.find((item) => item.variant_id === row.variant_id);
            assert.ok(cost);
            await database.query(
              `UPDATE inventory_balances
                  SET quantity_on_hand = quantity_on_hand - $1,
                      inventory_value_paise = inventory_value_paise + $2,
                      version = version + 1,
                      updated_at = now()
                WHERE location_id = $3 AND variant_id = $4`,
              [
                row.quantity_delta,
                cost.accounting_cogs_paise,
                row.location_id,
                row.variant_id,
              ],
            );
          }
        }
        await database.query("COMMIT");
      } catch (error) {
        await database.query("ROLLBACK");
        throw error;
      }
    });
  }
  if ((stockAdjustmentId || staleStockAdjustmentId) && localUserId) {
    await cleanup(async () => {
      await database.query("BEGIN");
      try {
        const adjustments = await database.query(
          `SELECT id, variant_id, location_id, stock_condition, status, result_json
             FROM stock_adjustments
            WHERE id = ANY($1::uuid[]) AND requested_by = $2`,
          [
            [stockAdjustmentId, staleStockAdjustmentId].filter(Boolean),
            localUserId,
          ],
        );
        for (const adjustment of adjustments.rows) {
          const movement = await database.query(
            `DELETE FROM inventory_movements
              WHERE reference_type = 'STOCK_ADJUSTMENT'
                AND reference_id = $1
              RETURNING quantity_delta`,
            [adjustment.id],
          );
          if (movement.rows[0] && adjustment.status === "APPLIED") {
            const valueDelta = BigInt(
              adjustment.result_json.inventoryValueDeltaPaise,
            );
            if (adjustment.stock_condition === "SELLABLE") {
              await database.query(
                `UPDATE inventory_balances
                    SET quantity_on_hand = quantity_on_hand - $1,
                        inventory_value_paise = inventory_value_paise - $2,
                        version = version + 1, updated_at = now()
                  WHERE location_id = $3 AND variant_id = $4`,
                [
                  movement.rows[0].quantity_delta,
                  valueDelta,
                  adjustment.location_id,
                  adjustment.variant_id,
                ],
              );
            } else {
              await database.query(
                `UPDATE inventory_condition_balances
                    SET quantity_on_hand = quantity_on_hand - $1,
                        inventory_value_paise = inventory_value_paise - $2,
                        version = version + 1, updated_at = now()
                  WHERE location_id = $3 AND variant_id = $4
                    AND stock_condition = $5`,
                [
                  movement.rows[0].quantity_delta,
                  valueDelta,
                  adjustment.location_id,
                  adjustment.variant_id,
                  adjustment.stock_condition,
                ],
              );
            }
          }
          await database.query(
            "DELETE FROM audit_events WHERE entity_type = 'STOCK_ADJUSTMENT' AND entity_id = $1",
            [adjustment.id],
          );
          await database.query(
            "DELETE FROM stock_adjustments WHERE id = $1",
            [adjustment.id],
          );
        }
        await database.query("COMMIT");
      } catch (error) {
        await database.query("ROLLBACK");
        throw error;
      }
    });
  }
  const syntheticReceiptCommandIds = [
    receiptCommandId,
    newProductReceiptCommandId,
  ].filter(Boolean);
  if (syntheticReceiptCommandIds.length > 0 && localUserId) {
    await cleanup(async () => {
      await database.query("BEGIN");
      try {
        for (const currentReceiptCommandId of syntheticReceiptCommandIds) {
        const receipt = await database.query(
          `SELECT id FROM stock_receipts
            WHERE command_id = $1 AND created_by = $2`,
          [currentReceiptCommandId, localUserId],
        );
        if (receipt.rows[0]) {
          const receiptCosts = await database.query(
            `SELECT variant_id,
                    invoice_unit_cost_paise,
                    previous_landed_cost_paise
               FROM stock_receipt_lines
              WHERE receipt_id = $1`,
            [receipt.rows[0].id],
          );
          const movement = await database.query(
            `DELETE FROM inventory_movements
              WHERE reference_type = 'STOCK_RECEIPT' AND reference_id = $1 AND created_by = $2
              RETURNING location_id, variant_id, stock_condition, quantity_delta`,
            [receipt.rows[0].id, localUserId],
          );
          await database.query(
            "DELETE FROM audit_events WHERE entity_type = 'STOCK_RECEIPT' AND entity_id = $1 AND actor_user_id = $2",
            [receipt.rows[0].id, localUserId],
          );
          await database.query("DELETE FROM stock_receipt_lines WHERE receipt_id = $1", [receipt.rows[0].id]);
          await database.query("DELETE FROM stock_receipts WHERE id = $1", [receipt.rows[0].id]);
          for (const row of movement.rows) {
            const receiptCost = receiptCosts.rows.find(
              (item) => item.variant_id === row.variant_id,
            );
            assert.ok(receiptCost);
            const valueAdded =
              BigInt(row.quantity_delta) * BigInt(receiptCost.invoice_unit_cost_paise);
            if (row.stock_condition === "SELLABLE") {
              await database.query(
                `UPDATE inventory_balances
                    SET quantity_on_hand = quantity_on_hand - $1,
                        inventory_value_paise = inventory_value_paise - $2,
                        version = version + 1,
                        updated_at = now()
                  WHERE location_id = $3 AND variant_id = $4`,
                [row.quantity_delta, valueAdded, row.location_id, row.variant_id],
              );
            } else {
              await database.query(
                `UPDATE inventory_condition_balances
                    SET quantity_on_hand = quantity_on_hand - $1,
                        inventory_value_paise = inventory_value_paise - $2,
                        version = version + 1,
                        updated_at = now()
                  WHERE location_id = $3 AND variant_id = $4
                    AND stock_condition = $5`,
                [
                  row.quantity_delta,
                  valueAdded,
                  row.location_id,
                  row.variant_id,
                  row.stock_condition,
                ],
              );
            }
          }
          for (const receiptCost of receiptCosts.rows) {
            const movementRow = movement.rows.find(
              (item) => item.variant_id === receiptCost.variant_id,
            );
            if (!movementRow) continue;
            await database.query(
              `UPDATE inventory_balances
                  SET latest_landed_cost_paise = $1,
                      version = version + 1,
                      updated_at = now()
                WHERE location_id = $2 AND variant_id = $3`,
              [
                receiptCost.previous_landed_cost_paise,
                movementRow.location_id,
                receiptCost.variant_id,
              ],
            );
          }
        }
        }
        await database.query("COMMIT");
      } catch (error) {
        await database.query("ROLLBACK");
        throw error;
      }
    });
  }
  if (newProductVariantId && localUserId) {
    await cleanup(async () => {
      await database.query("BEGIN");
      try {
        const product = await database.query(
          `SELECT product_id FROM product_variants
            WHERE id = $1`,
          [newProductVariantId],
        );
        if (product.rows[0]) {
          if (stalePriceApprovalId) {
            await database.query(
              "DELETE FROM audit_events WHERE entity_type = 'PRICE_APPROVAL' AND entity_id = $1",
              [stalePriceApprovalId],
            );
            await database.query(
              "DELETE FROM price_approval_requests WHERE id = $1",
              [stalePriceApprovalId],
            );
          }
          await database.query(
            "DELETE FROM audit_events WHERE entity_type = 'PRODUCT_VARIANT' AND entity_id = $1",
            [newProductVariantId],
          );
          await database.query(
            "DELETE FROM reorder_policy_changes WHERE variant_id = $1 AND actor_user_id = $2",
            [newProductVariantId, localUserId],
          );
          await database.query(
            "DELETE FROM product_change_events WHERE variant_id = $1",
            [newProductVariantId],
          );
          await database.query(
            "DELETE FROM inventory_condition_balances WHERE variant_id = $1",
            [newProductVariantId],
          );
          await database.query(
            "DELETE FROM inventory_balances WHERE variant_id = $1",
            [newProductVariantId],
          );
          await database.query(
            "DELETE FROM barcodes WHERE variant_id = $1",
            [newProductVariantId],
          );
          await database.query(
            "DELETE FROM price_versions WHERE variant_id = $1",
            [newProductVariantId],
          );
          await database.query(
            "DELETE FROM product_variants WHERE id = $1",
            [newProductVariantId],
          );
          await database.query(
            "DELETE FROM products WHERE id = $1 AND creation_command_id = $2",
            [product.rows[0].product_id, newProductCommandId],
          );
          if (
            Number.isInteger(newProductSequenceBefore) &&
            Number.isInteger(newProductSequenceNumber)
          ) {
            await database.query(
              `UPDATE business_sku_sequences
                  SET last_number = $1, updated_at = now()
                WHERE business_id = (
                  SELECT business_id FROM app_users WHERE id = $2
                )
                  AND last_number = $3`,
              [
                newProductSequenceBefore,
                localUserId,
                newProductSequenceNumber,
              ],
            );
          }
        }
        await database.query("COMMIT");
      } catch (error) {
        await database.query("ROLLBACK");
        throw error;
      }
    });
  }
  if (supplierId && localUserId) {
    await cleanup(async () => {
      await database.query(
        "DELETE FROM audit_events WHERE entity_type = 'SUPPLIER' AND entity_id = $1",
        [supplierId],
      );
      await database.query(
        "DELETE FROM suppliers WHERE id = $1 AND created_by = $2",
        [supplierId, localUserId],
      );
    });
  }
  if (approvalId && localUserId) {
    await cleanup(async () => {
      await database.query(
        "DELETE FROM audit_events WHERE entity_type = 'PRICE_APPROVAL' AND entity_id = $1",
        [approvalId],
      );
      await database.query(
        "DELETE FROM price_approval_requests WHERE id = $1 AND requester_user_id = $2",
        [approvalId, localUserId],
      );
    });
  }
  if (guestApprovalId && localUserId) {
    await cleanup(async () => {
      await database.query(
        "DELETE FROM audit_events WHERE entity_type = 'GUEST_SALE_APPROVAL' AND entity_id = $1",
        [guestApprovalId],
      );
      await database.query(
        "DELETE FROM guest_sale_approval_requests WHERE id = $1 AND requester_user_id = $2",
        [guestApprovalId, localUserId],
      );
    });
  }
  if (customerId && localUserId) {
    await cleanup(async () => {
      await database.query(
        "DELETE FROM audit_events WHERE entity_type = 'CUSTOMER' AND entity_id = $1",
        [customerId],
      );
      await database.query(
        "DELETE FROM customers WHERE id = $1 AND created_by = $2",
        [customerId, localUserId],
      );
    });
  }
  if (localUserId) {
    await cleanup(() =>
      database.query(
        "DELETE FROM app_users WHERE id = $1 AND workos_user_id = $2",
        [localUserId, dummyUserId],
      ),
    );
  }
  if (dummyUserId && email.startsWith("operator-proof-")) {
    await cleanup(() => workos.userManagement.deleteUser(dummyUserId));
  }
  if (!database.ended) await cleanup(() => database.end());
  if (cleanupErrors.length) {
    throw new AggregateError(cleanupErrors, "Synthetic-user cleanup failed.");
  }
}
