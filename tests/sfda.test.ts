import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { SFDAApiClient } from "../src/engine/client.js";
import { ImportPermitRequest } from "../src/types/sfda.js";

describe("SFDAApiClient eCosma & GHAD Clearance Workflow", () => {
  const client = new SFDAApiClient({
    apiKey: "mock_sfda_key",
    clientId: "mock_sfda_client",
    clientSecret: "mock_sfda_secret",
    mockMode: true,
  });

  const validRequest: ImportPermitRequest = {
    importerCr: "1010889900",
    sector: "COSMETICS",
    invoiceNumber: "INV-SFDA-2026-001",
    billOfLading: "OOCL992019",
    portOfEntry: "JED_SEA",
    products: [
      {
        productName: "Niacinamide Radiance Serum",
        brandName: "AuraCare",
        modelOrSku: "AC-SERUM-01",
        manufacturerCountry: "CN",
        manufacturerName: "Guangzhou Biotech Co.",
        sfdaListingNumber: "COS-2026-44910",
      },
    ],
  };

  test("validates product listings and rejects missing listing number", () => {
    assert.throws(
      () => {
        client.validateProductListing({
          productName: "Unlisted Cream",
          brandName: "AuraCare",
          modelOrSku: "AC-CRM-01",
          manufacturerCountry: "CN",
          manufacturerName: "Guangzhou Biotech Co.",
          sfdaListingNumber: "",
        });
      },
      {
        message: "[SFDAApiClient] Product AC-CRM-01 is missing an SFDA listing number.",
      }
    );
  });

  test("issues an approved SFDA import clearance permit (اذن فسح)", async () => {
    const res = await client.requestImportPermit(validRequest);

    assert.ok(res.permitNumber.startsWith("SFDA-IMP-2026-"));
    assert.equal(res.status, "APPROVED");
    assert.equal(res.customsIntegrationPayload.bayanLinkReady, true);
    assert.equal(res.customsIntegrationPayload.sfdaApprovalNumber, res.permitNumber);
  });

  test("verifies an issued permit by reference number", async () => {
    const permit = await client.requestImportPermit(validRequest);
    const verified = await client.verifyPermit(permit.permitNumber);

    assert.ok(verified);
    assert.equal(verified?.permitNumber, permit.permitNumber);
    assert.equal(verified?.importerCr, "1010889900");
  });
});