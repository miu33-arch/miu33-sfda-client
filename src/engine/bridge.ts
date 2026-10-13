import { z } from "zod";

export const HsCodeRoutingTargetSchema = z.enum(["SFDA_ECOSMA", "SFDA_GHAD", "SFDA_FOOD", "SABER_SASO", "STANDARD_CUSTOMS"]);
export type HsCodeRoutingTarget = z.infer<typeof HsCodeRoutingTargetSchema>;

export const CommercialInvoiceLineItemSchema = z.object({
  itemIndex: z.number().int().nonnegative(),
  hsCode: z.string().regex(/^\d{6,12}$/, "HS code must be between 6 and 12 digits"),
  commercialDescription: z.string().min(1),
  quantity: z.number().positive(),
  unitOfMeasure: z.string().min(1),
  cifValueSar: z.number().nonnegative(),
  countryOfOrigin: z.string().length(2),
  gtin: z.string().regex(/^\d{13,14}$/).optional(),
});

export type CommercialInvoiceLineItem = z.infer<typeof CommercialInvoiceLineItemSchema>;

export interface RoutedConsignmentItem extends CommercialInvoiceLineItem {
  routingTarget: HsCodeRoutingTarget;
  statutoryRegulatoryAuthority: "SFDA" | "SASO" | "ZATCA_DIRECT";
  clearanceReferenceNumber?: string;
}

export interface BayanDeclarationLineItem {
  lineNo: number;
  hsCode: string;
  goodsDescriptionArabic: string;
  quantity: number;
  cifAmountSar: number;
  saberScocNumber: string | null;
  sfdaApprovalNumber: string | null;
  dutyRatePercent: number;
  statutoryVatSar: number;
}

export interface BayanDraftDeclaration {
  declarationHeader: {
    billOfLading: string;
    manifestId: string;
    portCode: string; // e.g., "SADMM" (King Abdulaziz Port) or "SAJED" (Jeddah Islamic Port)
    totalCifSar: number;
    estimatedCustomsDutySar: number;
    statutoryVat15PercentSar: number;
  };
  bayanItems: BayanDeclarationLineItem[];
}

export class SovereignClearanceBridge {
  /**
   * Deterministically classifies HS Code to proper statutory agency
   */
  public static classifyHsCode(hsCode: string): { target: HsCodeRoutingTarget; authority: "SFDA" | "SASO" | "ZATCA_DIRECT" } {
    const cleanHs = hsCode.replace(/\D/g, "");

    // Chapter 33: Cosmetics & Essential Oils (SFDA eCosma)
    if (cleanHs.startsWith("3304") || cleanHs.startsWith("3305") || cleanHs.startsWith("3307")) {
      return { target: "SFDA_ECOSMA", authority: "SFDA" };
    }

    // Chapter 90 / 30: Medical Devices & Diagnostics (SFDA GHAD)
    if (cleanHs.startsWith("9018") || cleanHs.startsWith("9019") || cleanHs.startsWith("9021") || cleanHs.startsWith("9022") || cleanHs.startsWith("3006")) {
      return { target: "SFDA_GHAD", authority: "SFDA" };
    }

    // Chapters 02, 04, 07, 08, 09, 10, 11, 16, 19, 20, 21, 22: Foodstuffs (SFDA Food)
    if (
      cleanHs.startsWith("02") ||
      cleanHs.startsWith("04") ||
      cleanHs.startsWith("07") ||
      cleanHs.startsWith("08") ||
      cleanHs.startsWith("16") ||
      cleanHs.startsWith("19") ||
      cleanHs.startsWith("20") ||
      cleanHs.startsWith("21")
    ) {
      return { target: "SFDA_FOOD", authority: "SFDA" };
    }

    // Chapters 72, 73, 76 (Steel, Aluminum, Construction), 84, 85 (Machinery, Electrical): SASO / SABER
    if (
      cleanHs.startsWith("72") ||
      cleanHs.startsWith("73") ||
      cleanHs.startsWith("76") ||
      cleanHs.startsWith("84") ||
      cleanHs.startsWith("85")
    ) {
      return { target: "SABER_SASO", authority: "SASO" };
    }

    // Default / Non-regulated general cargo
    return { target: "STANDARD_CUSTOMS", authority: "ZATCA_DIRECT" };
  }

  /**
   * Splits packing list items across regulatory queues
   */
  public static splitInvoiceItems(items: CommercialInvoiceLineItem[]): RoutedConsignmentItem[] {
    return items.map((item) => {
      const routing = this.classifyHsCode(item.hsCode);
      return {
        ...item,
        routingTarget: routing.target,
        statutoryRegulatoryAuthority: routing.authority,
      };
    });
  }

  /**
   * Compiles routed items and external certificate references into an automated FASAH Bayan draft
   */
  public static compileBayanDraft(
    billOfLading: string,
    manifestId: string,
    portCode: string,
    routedItems: RoutedConsignmentItem[],
    certificatesMap: Map<number, string> // Map of itemIndex -> Certificate / Permit Number
  ): BayanDraftDeclaration {
    let totalCif = 0;
    let totalDuty = 0;

    const bayanItems: BayanDeclarationLineItem[] = routedItems.map((item) => {
      const clearanceRef = certificatesMap.get(item.itemIndex) ?? null;
      
      // Standard GCC unified tariff default is 5%, some special categories higher
      const dutyRate = 0.05; 
      const itemDuty = item.cifValueSar * dutyRate;
      const statutoryVat = (item.cifValueSar + itemDuty) * 0.15; // 15% ZATCA VAT on (CIF + Duty)

      totalCif += item.cifValueSar;
      totalDuty += itemDuty;

      return {
        lineNo: item.itemIndex + 1,
        hsCode: item.hsCode,
        goodsDescriptionArabic: item.commercialDescription,
        quantity: item.quantity,
        cifAmountSar: item.cifValueSar,
        saberScocNumber: item.statutoryRegulatoryAuthority === "SASO" ? clearanceRef : null,
        sfdaApprovalNumber: item.statutoryRegulatoryAuthority === "SFDA" ? clearanceRef : null,
        dutyRatePercent: 5,
        statutoryVatSar: Math.round(statutoryVat * 100) / 100,
      };
    });

    const totalVat = (totalCif + totalDuty) * 0.15;

    return {
      declarationHeader: {
        billOfLading,
        manifestId,
        portCode,
        totalCifSar: Math.round(totalCif * 100) / 100,
        estimatedCustomsDutySar: Math.round(totalDuty * 100) / 100,
        statutoryVat15PercentSar: Math.round(totalVat * 100) / 100,
      },
      bayanItems,
    };
  }
}