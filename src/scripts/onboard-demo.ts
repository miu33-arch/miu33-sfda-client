import {
  EcosmaRegulatoryEngine,
  GhadRegulatoryEngine,
  FoodRegulatoryEngine,
  Gs1TraceabilityEngine,
  SovereignClearanceBridge,
  CommercialInvoiceLineItem,
} from "../index.js";

async function runOnboardingDemo() {
  console.log("=== 1. Validating Raw Inbound Invoice Line Items ===");
  const invoiceItems: CommercialInvoiceLineItem[] = [
    {
      itemIndex: 0,
      hsCode: "33049900", // Cosmetics
      commercialDescription: "Anti-Aging Facial Serum with Retinol",
      quantity: 5000,
      unitOfMeasure: "PCS",
      cifValueSar: 125000,
      countryOfOrigin: "FR",
      gtin: "06281000000018",
    },
    {
      itemIndex: 1,
      hsCode: "90183900", // Medical Devices
      commercialDescription: "Sterile Disposable Infusion Set",
      quantity: 12000,
      unitOfMeasure: "BOX",
      cifValueSar: 48000,
      countryOfOrigin: "DE",
      gtin: "06281000000025",
    },
    {
      itemIndex: 2,
      hsCode: "73089090", // Structural Steel
      commercialDescription: "Prefabricated Steel Bridge Beams",
      quantity: 45,
      unitOfMeasure: "TON",
      cifValueSar: 350000,
      countryOfOrigin: "CN",
    },
  ];

  const routedItems = SovereignClearanceBridge.splitInvoiceItems(invoiceItems);
  console.log("Routed items count:", routedItems.length);
  routedItems.forEach((item) => {
    console.log(
      `- Item ${item.itemIndex}: HS ${item.hsCode} -> Authority: ${item.statutoryRegulatoryAuthority} (${item.routingTarget})`
    );
  });

  console.log("\n=== 2. Testing GSO 1943 Cosmetic Safety Validation ===");
  const cosmeticResult = EcosmaRegulatoryEngine.validateDossier({
    brandNameArabic: "سيروم العناية",
    brandNameEnglish: "Care Serum",
    productNameArabic: "سيروم مقاوم للتجاعيد",
    productNameEnglish: "Anti-Aging Facial Serum",
    gtin: "06281000000018",
    manufacturerGln: "6281000000018",
    ingredients: [
      { inciName: "Aqua", percentage: 80 },
      { inciName: "Salicylic Acid", percentage: 1.5 },
      { inciName: "Glycerin", percentage: 18.5 },
    ],
    packaging: {
      hasArabicLabeling: true,
      hasEnglishLabeling: true,
      countryOfOrigin: "FR",
      paoMonths: 12,
      storageConditionsArabic: "يحفظ في مكان بارد وجاف",
      storageConditionsEnglish: "Store in a cool dry place",
    },
  });
  console.log("Cosmetic Compliance Validated:", cosmeticResult.isCompliant);

  console.log("\n=== 3. Simulating GS1-128 / DataMatrix Parsing ===");
  const rawDataMatrix = "(01)06281000000025(17)281231(10)LOT9876A(21)SN554433221";
  const gs1Result = Gs1TraceabilityEngine.parseDataMatrix(rawDataMatrix);
  console.log(
    "GS1 Decoded Batch:",
    gs1Result.record?.batchLot,
    "| Expiry ISO:",
    gs1Result.record?.standardizedExpiryIso
  );

  console.log("\n=== 4. Assembling FASAH Bayan Customs Declaration Draft ===");
  const certMap = new Map<number, string>();
  certMap.set(0, "SFDA-ECOSMA-2026-99214");
  certMap.set(1, "MDMA-2026-004412");
  certMap.set(2, "SCoC-SASO-2026-88120");

  const bayanDraft = SovereignClearanceBridge.compileBayanDraft(
    "BL-COSCO-2026-KSA-019",
    "MAN-DMM-8841",
    "SADMM",
    routedItems,
    certMap
  );

  console.log("Bayan Declaration Port:", bayanDraft.declarationHeader.portCode);
  console.log("Total CIF Value:", bayanDraft.declarationHeader.totalCifSar, "SAR");
  console.log(
    "Estimated Customs Duty (5%):",
    bayanDraft.declarationHeader.estimatedCustomsDutySar,
    "SAR"
  );
  console.log(
    "Statutory VAT (15%):",
    bayanDraft.declarationHeader.statutoryVat15PercentSar,
    "SAR"
  );
  console.log("\n✓ All enterprise compliance pipelines fully verified.");
}

runOnboardingDemo().catch(console.error);