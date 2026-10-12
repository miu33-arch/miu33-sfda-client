export type SFDASector = "COSMETICS" | "MEDICAL_DEVICES" | "FOOD" | "PHARMACEUTICALS";

export type ApprovalStatus = "SUBMITTED" | "APPROVED" | "UNDER_REVIEW" | "REJECTED";

export interface ListedProduct {
  productName: string;
  brandName: string;
  modelOrSku: string;
  manufacturerCountry: string; // ISO 3166-1 alpha-2, e.g. "CN", "DE"
  manufacturerName: string;
  sfdaListingNumber: string; // e.g. "COS-2026-88102" or "MDMA-2026-4412"
}

export interface ImportPermitRequest {
  importerCr: string; // 10-digit Saudi CR
  sector: SFDASector;
  invoiceNumber: string;
  billOfLading: string;
  portOfEntry: "JED_SEA" | "DMM_SEA" | "RUH_AIR" | "KACST_DRY_PORT";
  products: ListedProduct[];
  warehouseLicenseNumber?: string; // SFDA-licensed storage facility
}

export interface ImportPermitResponse {
  permitNumber: string; // Official clearance permit (e.g. "SFDA-IMP-2026-90412")
  status: ApprovalStatus;
  sector: SFDASector;
  importerCr: string;
  issuedAt: string;
  expiresAt: string;
  customsIntegrationPayload: {
    portOfEntry: string;
    bayanLinkReady: boolean;
    sfdaApprovalNumber: string; // Plugs directly into BayanDeclarationDraft.DeclarationItem
  };
}