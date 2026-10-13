import { z } from "zod";

/**
 * GSO 1943:2021 Cosmetic Safety Validation Schema
 */
export const InciIngredientSchema = z.object({
    inciName: z.string().trim().min(1),
    casNumber: z.string().trim().optional(),
    percentage: z.number().min(0).max(100),
    function: z.string().optional(),
});

export const PackagingMetadataSchema = z.object({
    hasArabicLabeling: z.boolean(),
    hasEnglishLabeling: z.boolean(),
    countryOfOrigin: z.string().length(2), // ISO-3166-1 alpha-2
    paoMonths: z.number().int().positive().optional(), // Period After Opening
    fixedExpiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    storageConditionsArabic: z.string().min(1),
    storageConditionsEnglish: z.string().min(1),
}).refine((data: { paoMonths?: number; fixedExpiryDate?: string }) => {
    return data.paoMonths !== undefined || data.fixedExpiryDate !== undefined;
}, {
    message: "Either PAO (Period After Opening) or a fixed expiry date must be declared.",
    path: ["paoMonths"],
});

export const CosmeticNotificationPayloadSchema = z.object({
    brandNameArabic: z.string().min(1),
    brandNameEnglish: z.string().min(1),
    productNameArabic: z.string().min(1),
    productNameEnglish: z.string().min(1),
    notificationNumber: z.string().optional(),
    gtin: z.string().regex(/^\d{13,14}$/, "GTIN must be a 13 or 14-digit GS1 string"),
    ingredients: z.array(InciIngredientSchema).min(1),
    packaging: PackagingMetadataSchema,
    manufacturerGln: z.string().length(13, "Manufacturer GLN must be 13 digits"),
});

export type CosmeticNotificationPayload = z.infer<typeof CosmeticNotificationPayloadSchema>;

export interface ComplianceValidationResult {
    isCompliant: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * High-risk / Annex II & III Banned / Restricted Substance Registry (GSO 1943)
 */
const BANNED_INCI_REGISTRY = new Set([
    "HYDROQUINONE",
    "BITHIONOL",
    "CHLOROFLUOROCARBONS",
    "HEXACHLOROPHENE",
    "MERCURY COMPOUNDS",
    "VINYL CHLORIDE",
    "ZIRCONIUM COMPLEXES",
]);

const RESTRICTED_CONCENTRATION_LIMITS: Record<string, number> = {
    "SALICYLIC ACID": 2.0,      // Max 2.0% for leave-on, 3.0% rinse-off
    "ZINC PYRITHIONE": 1.0,     // Max 1.0% in rinse-off hair products
    "BENZOPHENONE-3": 6.0,      // UV filter max 6%
    "TITANIUM DIOXIDE": 25.0,   // Colorant/UV filter max 25%
};

export class EcosmaRegulatoryEngine {
    /**
     * Deterministically validates a cosmetic dossier against SFDA GSO 1943 standards
     */
    public static validateDossier(payload: CosmeticNotificationPayload): ComplianceValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // 1. Zod schema structural validation
        const parseResult = CosmeticNotificationPayloadSchema.safeParse(payload);
        if (!parseResult.success) {
            parseResult.error.issues.forEach((issue: z.ZodIssue) => {
                errors.push(`[Structural Error] ${issue.path.join(".")}: ${issue.message}`);
            });
            return { isCompliant: false, errors, warnings };
        }

        // 2. Bilingual Packaging Rule
        if (!payload.packaging.hasArabicLabeling) {
            errors.push("[GSO 1943 Clause 8.1] Missing mandatory Arabic labeling on outer packaging.");
        }
        if (!payload.packaging.hasEnglishLabeling) {
            warnings.push("[Market Parity] Outer pack missing English translation.");
        }

        // 3. INCI banned & restricted substances check
        let totalPercentage = 0;

        for (const ingredient of payload.ingredients) {
            const normalizedName = ingredient.inciName.toUpperCase().trim();
            totalPercentage += ingredient.percentage;

            // Check strictly banned substances
            if (BANNED_INCI_REGISTRY.has(normalizedName)) {
                errors.push(`[GSO 1943 Annex II Violation] Prohibited ingredient detected: ${ingredient.inciName}`);
            }

            // Check threshold limits
            if (normalizedName in RESTRICTED_CONCENTRATION_LIMITS) {
                const limit = RESTRICTED_CONCENTRATION_LIMITS[normalizedName];
                if (ingredient.percentage > limit) {
                    errors.push(
                        `[GSO 1943 Annex III Violation] ${ingredient.inciName} concentration (${ingredient.percentage}%) exceeds regulatory ceiling of ${limit}%.`
                    );
                }
            }
        }

        // Sanity check formulation percentages
        if (totalPercentage > 100.5) {
            errors.push(`[Formulation Discrepancy] Total ingredient percentage exceeds 100% (${totalPercentage}%).`);
        }

        return {
            isCompliant: errors.length === 0,
            errors,
            warnings,
        };
    }

    /**
     * Formats the verified payload for the SFDA eCosma sandbox API endpoint
     */
    public static buildApiPayload(dossier: CosmeticNotificationPayload) {
        return {
            header: {
                systemSender: "MIU33_SOVEREIGN_GATEWAY",
                timestamp: new Date().toISOString(),
                correlationId: crypto.randomUUID(),
            },
            productRecord: {
                gtin: dossier.gtin,
                commercialNames: {
                    ar: dossier.productNameArabic,
                    en: dossier.productNameEnglish,
                },
                brandNames: {
                    ar: dossier.brandNameArabic,
                    en: dossier.brandNameEnglish,
                },
                formulation: dossier.ingredients.map((ing: z.infer<typeof InciIngredientSchema>) => ({
                    substanceName: ing.inciName,
                    cas: ing.casNumber ?? null,
                    concentrationRatio: ing.percentage / 100,
                })),
                traceability: {
                    origin: dossier.packaging.countryOfOrigin,
                    manufacturerGln: dossier.manufacturerGln,
                    paoMonths: dossier.packaging.paoMonths ?? null,
                    fixedExpiry: dossier.packaging.fixedExpiryDate ?? null,
                },
            },
        };
    }
}