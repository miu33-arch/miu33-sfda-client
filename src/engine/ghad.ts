import { z } from "zod";

/**
 * SFDA Medical Device Risk Classification
 * Aligned with IMDRF & EU MDR Rules (Class A, B, C, D)
 */
export const DeviceRiskClassSchema = z.enum(["CLASS_A", "CLASS_B", "CLASS_C", "CLASS_D"]);
export type DeviceRiskClass = z.infer<typeof DeviceRiskClassSchema>;

export const QualitySystemCertificateSchema = z.object({
  iso13485Number: z.string().min(1),
  notifiedBodyName: z.string().min(1),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD"),
});

export const AuthorizedRepresentativeSchema = z.object({
  arName: z.string().min(1),
  ghadLicenseNumber: z.string().regex(/^AR-\d{4}-\d+$/, "Format: AR-YYYY-XXXXX"),
  mdelNumber: z.string().regex(/^MDEL-\d{4}-\d+$/, "Format: MDEL-YYYY-XXXXX"),
  mandateExpiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const MedicalDeviceDossierSchema = z.object({
  deviceIdentifierGtin: z.string().regex(/^\d{13,14}$/, "Must be valid 13 or 14-digit GTIN / UDI-DI"),
  commercialNameEnglish: z.string().min(1),
  commercialNameArabic: z.string().min(1),
  deviceRiskClass: DeviceRiskClassSchema,
  isIvDevice: z.boolean().default(false), // In-Vitro Diagnostic
  isSterile: z.boolean().default(false),
  hasMeasuringFunction: z.boolean().default(false),
  isLayUserOriented: z.boolean().default(false), // Requires layperson Arabic IFU if true
  mdmaCertificateNumber: z.string().regex(/^MDMA-\d{4}-\d+$/).optional(),
  mdmaExpiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  qualityCertificates: QualitySystemCertificateSchema,
  authorizedRepresentative: AuthorizedRepresentativeSchema.optional(),
  isForeignManufacturer: z.boolean(),
});

export type MedicalDeviceDossier = z.infer<typeof MedicalDeviceDossierSchema>;

export interface GhadValidationResult {
  isCompliant: boolean;
  requiresFullMdma: boolean;
  errors: string[];
  warnings: string[];
}

export class GhadRegulatoryEngine {
  /**
   * Deterministically validates medical device dossier against SFDA GHAD / MDMA mandates
   */
  public static validateDeviceDossier(dossier: MedicalDeviceDossier): GhadValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const now = new Date().toISOString().split("T")[0];

    // 1. Structural parse
    const parseResult = MedicalDeviceDossierSchema.safeParse(dossier);
    if (!parseResult.success) {
      parseResult.error.issues.forEach((issue: z.ZodIssue) => {
        errors.push(`[Structural Error] ${issue.path.join(".")}: ${issue.message}`);
      });
      return { isCompliant: false, requiresFullMdma: false, errors, warnings };
    }

    // 2. MDMA Mandate Rule
    // Class B, C, D strictly mandate active MDMA. Class A sterile or measuring also requires MDMA.
    const requiresFullMdma =
      dossier.deviceRiskClass !== "CLASS_A" ||
      dossier.isSterile ||
      dossier.hasMeasuringFunction;

    if (requiresFullMdma) {
      if (!dossier.mdmaCertificateNumber) {
        errors.push(
          `[SFDA MDS-REQ 1 Violation] Device Class ${dossier.deviceRiskClass} requires an active MDMA (Medical Device Marketing Authorization) certificate.`
        );
      } else if (dossier.mdmaExpiryDate && dossier.mdmaExpiryDate < now) {
        errors.push(`[MDMA Expired] Certificate ${dossier.mdmaCertificateNumber} expired on ${dossier.mdmaExpiryDate}.`);
      }
    }

    // 3. Foreign Manufacturer & Authorized Representative (AR) Check
    if (dossier.isForeignManufacturer) {
      if (!dossier.authorizedRepresentative) {
        errors.push("[GHAD Mandate] Non-Saudi manufacturers must appoint a licensed SFDA Authorized Representative (AR).");
      } else {
        if (dossier.authorizedRepresentative.mandateExpiryDate < now) {
          errors.push(
            `[AR Mandate Lapsed] Authorized Representative license expired on ${dossier.authorizedRepresentative.mandateExpiryDate}.`
          );
        }
      }
    }

    // 4. ISO 13485 Quality Certificate Expiry Check
    if (dossier.qualityCertificates.expiryDate < now) {
      errors.push(`[ISO 13485 Expired] Device QMS certification expired on ${dossier.qualityCertificates.expiryDate}.`);
    }

    // 5. Layperson Arabic Labeling Rule
    if (dossier.isLayUserOriented && !dossier.commercialNameArabic) {
      errors.push("[SFDA Labeling Rule] Devices intended for lay users strictly require Arabic IFU and trade labeling.");
    }

    return {
      isCompliant: errors.length === 0,
      requiresFullMdma,
      errors,
      warnings,
    };
  }

  /**
   * Builds the pre-clearance clearance payload for the SFDA GHAD Customs Clearing Gateway
   */
  public static buildGhadClearancePayload(dossier: MedicalDeviceDossier, portOfEntry: string) {
    return {
      portal: "GHAD_MEDICAL_SYSTEM",
      transmissionTimestamp: new Date().toISOString(),
      consignment: {
        udiGtin: dossier.deviceIdentifierGtin,
        deviceClass: dossier.deviceRiskClass,
        mdmaRef: dossier.mdmaCertificateNumber ?? "EXEMPT_CLASS_A",
        arGhadLicense: dossier.authorizedRepresentative?.ghadLicenseNumber ?? "DOMESTIC_MANUFACTURER",
        importerMdel: dossier.authorizedRepresentative?.mdelNumber ?? "N/A",
        portOfEntry,
        customsStatusAssertion: "READY_FOR_BAYAN_LINKING",
      },
    };
  }
}