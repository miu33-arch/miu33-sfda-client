import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SovereignClearanceBridge,
  CommercialInvoiceLineItem,
} from "../src/index.js";

describe("Multi-Agency Arbitration & Boundary Dispatch", () => {
  it("correctly routes composite medical cart, probe accessories, and clinical wipes", () => {
    const rawInvoice: CommercialInvoiceLineItem[] = [
      {
        itemIndex: 0,
        hsCode: "90183900", // Medical electro-diagnostic cart / apparatus
        commercialDescription: "Diagnostic Cart with Embedded Software and Internal Li-Ion Battery",
        quantity: 2,
        unitOfMeasure: "UNT",
        cifValueSar: 420000,
        countryOfOrigin: "DE",
        gtin: "04012345678901",
      },
      {
        itemIndex: 1,
        hsCode: "90189000", // Medical device parts & accessories (sterile probe covers)
        commercialDescription: "Sterile Disposable Probe Covers (Medical Accessory)",
        quantity: 10000,
        unitOfMeasure: "BOX",
        cifValueSar: 35000,
        countryOfOrigin: "US",
        gtin: "00812345678902",
      },
    ];

    const routed = SovereignClearanceBridge.splitInvoiceItems(rawInvoice);

    assert.equal(routed.length, 2);
    assert.equal(routed[0].statutoryRegulatoryAuthority, "SFDA");
    assert.equal(routed[0].routingTarget, "SFDA_GHAD");
    assert.equal(routed[1].statutoryRegulatoryAuthority, "SFDA");
    assert.equal(routed[1].routingTarget, "SFDA_GHAD");

    // Compile FASAH Bayan draft with MDMA mappings
    const certMap = new Map<number, string>();
    certMap.set(0, "MDMA-2026-CART-991");
    certMap.set(1, "MDMA-2026-COV-442");

    const bayan = SovereignClearanceBridge.compileBayanDraft(
      "BL-MSC-2026-DMM-7782",
      "MAN-SADMM-9901",
      "SADMM",
      routed,
      certMap
    );

    assert.equal(bayan.declarationHeader.portCode, "SADMM");
    assert.equal(bayan.declarationHeader.totalCifSar, 455000);
    assert.equal(bayan.declarationHeader.estimatedCustomsDutySar, 22750); // 5%
    assert.equal(bayan.declarationHeader.statutoryVat15PercentSar, 71662.5); // 15%
  });
});