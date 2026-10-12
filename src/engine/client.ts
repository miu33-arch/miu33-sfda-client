import axios, { AxiosInstance } from "axios";
import crypto from "node:crypto";
import {
  ImportPermitRequest,
  ImportPermitResponse,
  ListedProduct,
} from "../types/sfda.js";

export interface SFDAClientConfig {
  apiKey: string;
  clientId: string;
  clientSecret: string;
  environment?: "sandbox" | "production";
  mockMode?: boolean;
}

export class SFDAApiClient {
  private http: AxiosInstance;
  private readonly mockMode: boolean;
  private permits = new Map<string, ImportPermitResponse>();

  constructor(private config: SFDAClientConfig) {
    this.mockMode = Boolean(config.mockMode);
    const baseUrl =
      config.environment === "production"
        ? "https://api.sfda.gov.sa/clearance/v1"
        : "https://sandbox.sfda.gov.sa/clearance/v1";

    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 10000,
      headers: {
        "Content-Type": "application/json",
        "X-SFDA-API-KEY": config.apiKey,
        "User-Agent": "MIU33-SFDA-Client/1.0.0",
      },
    });
  }

  /**
   * Validates product listing conformity before submitting permit request
   */
  public validateProductListing(product: ListedProduct): boolean {
    if (!product.sfdaListingNumber || product.sfdaListingNumber.trim() === "") {
      throw new Error(`[SFDAApiClient] Product ${product.modelOrSku} is missing an SFDA listing number.`);
    }
    if (!product.manufacturerCountry || product.manufacturerCountry.length !== 2) {
      throw new Error(`[SFDAApiClient] Manufacturer country must be an ISO 2-letter code.`);
    }
    return true;
  }

  /**
   * Request SFDA Import Permit (اذن فسح) for customs clearance
   */
  public async requestImportPermit(request: ImportPermitRequest): Promise<ImportPermitResponse> {
    if (!request.products || request.products.length === 0) {
      throw new Error("[SFDAApiClient] Permit request requires at least one listed product.");
    }

    for (const prod of request.products) {
      this.validateProductListing(prod);
    }

    if (this.mockMode) {
      const hash = crypto
        .createHash("sha256")
        .update(request.importerCr + request.invoiceNumber + request.billOfLading)
        .digest("hex")
        .substring(0, 8)
        .toUpperCase();

      const permitNumber = `SFDA-IMP-2026-${hash}`;
      const now = new Date();
      const expires = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days validity

      const response: ImportPermitResponse = {
        permitNumber,
        status: "APPROVED",
        sector: request.sector,
        importerCr: request.importerCr,
        issuedAt: now.toISOString(),
        expiresAt: expires.toISOString(),
        customsIntegrationPayload: {
          portOfEntry: request.portOfEntry,
          bayanLinkReady: true,
          sfdaApprovalNumber: permitNumber,
        },
      };

      this.permits.set(permitNumber, response);
      return response;
    }

    try {
      const res = await this.http.post("/permits/import", request);
      return res.data;
    } catch (err) {
      throw new Error(`[SFDAApiClient] Failed to request import permit: ${(err as Error).message}`);
    }
  }

  /**
   * Verify an existing permit against SFDA database
   */
  public async verifyPermit(permitNumber: string): Promise<ImportPermitResponse | null> {
    if (this.mockMode) {
      return this.permits.get(permitNumber) || null;
    }

    try {
      const res = await this.http.get(`/permits/verify/${permitNumber}`);
      return res.data;
    } catch (err) {
      return null;
    }
  }
}