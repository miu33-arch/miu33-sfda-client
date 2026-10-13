import { z } from "zod";

export const AllergenEnum = z.enum([
  "GLUTEN",
  "CRUSTACEANS",
  "EGGS",
  "FISH",
  "PEANUTS",
  "SOYBEANS",
  "MILK_DAIRY",
  "TREE_NUTS",
  "CELERY",
  "MUSTARD",
  "SESAME",
  "SULPHITES",
  "LUPIN",
  "MOLLUSCS",
]);

export const NutritionFactsSchema = z.object({
  servingSizeGrams: z.number().positive(),
  caloriesKcal: z.number().nonnegative(),
  totalFatGrams: z.number().nonnegative(),
  saturatedFatGrams: z.number().nonnegative(),
  transFatGrams: z.number().nonnegative(), // SFDA bans partially hydrogenated oils
  sodiumMg: z.number().nonnegative(),
  totalCarbohydratesGrams: z.number().nonnegative(),
  dietaryFiberGrams: z.number().nonnegative().optional(),
  totalSugarsGrams: z.number().nonnegative(),
  addedSugarsGrams: z.number().nonnegative().optional(),
  proteinGrams: z.number().nonnegative(),
});

export const HalalCertificateSchema = z.object({
  certificateNumber: z.string().min(1),
  approvedIslamicBody: z.string().min(1), // Must be an SFDA-accredited Islamic certification center
  slaughterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const FoodConsignmentItemSchema = z.object({
  itemCodeGtin: z.string().regex(/^\d{13,14}$/, "GTIN must be 13 or 14 digits"),
  productNameEnglish: z.string().min(1),
  productNameArabic: z.string().min(1),
  category: z.enum(["GENERAL_FOOD", "MEAT_POULTRY", "DAIRY", "DIETARY_SUPPLEMENT", "BEVERAGE"]),
  productionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format: YYYY-MM-DD"),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format: YYYY-MM-DD"),
  expectedArrivalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format: YYYY-MM-DD"),
  hasArabicLabel: z.boolean(),
  nutritionFacts: NutritionFactsSchema,
  containsAnimalDerivatives: z.boolean(),
  halalCertificate: HalalCertificateSchema.optional(),
  declaredAllergens: z.array(AllergenEnum).default([]),
});

export type FoodConsignmentItem = z.infer<typeof FoodConsignmentItemSchema>;

export interface FoodClearanceResult {
  isCompliant: boolean;
  remainingShelfLifePercentage: number;
  errors: string[];
  warnings: string[];
}

export class FoodRegulatoryEngine {
  /**
   * Evaluates food consignment compliance under SFDA.FD standards and port shelf-life mandates
   */
  public static validateItem(item: FoodConsignmentItem): FoodClearanceResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Zod structural validation
    const parseResult = FoodConsignmentItemSchema.safeParse(item);
    if (!parseResult.success) {
      parseResult.error.issues.forEach((issue: z.ZodIssue) => {
        errors.push(`[Structural Error] ${issue.path.join(".")}: ${issue.message}`);
      });
      return { isCompliant: false, remainingShelfLifePercentage: 0, errors, warnings };
    }

    // 2. Shelf-Life 50% Rule Calculation
    const prodTime = new Date(item.productionDate).getTime();
    const expTime = new Date(item.expiryDate).getTime();
    const arrivalTime = new Date(item.expectedArrivalDate).getTime();

    const totalLifeSpanMs = expTime - prodTime;
    const remainingLifeMs = expTime - arrivalTime;

    if (totalLifeSpanMs <= 0) {
      errors.push("[Date Discrepancy] Expiry date must occur chronologically after production date.");
      return { isCompliant: false, remainingShelfLifePercentage: 0, errors, warnings };
    }

    const remainingPercentage = Math.round((remainingLifeMs / totalLifeSpanMs) * 100);

    if (remainingPercentage < 50) {
      errors.push(
        `[SFDA Shelf-Life Rejection Risk] Consignment arrives with only ${remainingPercentage}% remaining shelf life. SFDA mandates ≥50% upon port arrival.`
      );
    } else if (remainingPercentage < 60) {
      warnings.push(`[Border Delay Risk] Consignment has ${remainingPercentage}% shelf life remaining; demurrage or port clearance delays could push it below 50%.`);
    }

    // 3. Mandatory Halal Verification for Meat and Animal Derivatives
    const requiresHalal = item.category === "MEAT_POULTRY" || item.containsAnimalDerivatives;
    if (requiresHalal) {
      if (!item.halalCertificate) {
        errors.push("[SFDA Halal Mandate] Missing mandatory Halal slaughter/derivative certificate issued by an SFDA-accredited center.");
      } else {
        const arrivalDateStr = item.expectedArrivalDate;
        if (item.halalCertificate.expiryDate < arrivalDateStr) {
          errors.push(`[Halal Certificate Lapsed] Halal certificate expired on ${item.halalCertificate.expiryDate}.`);
        }
      }
    }

    // 4. Zero Trans-Fat Rule (SFDA circular on hydrogenated oil limits)
    if (item.nutritionFacts.transFatGrams > 0.1) {
      errors.push(`[SFDA Trans-Fat Ceiling] Trans-fat level (${item.nutritionFacts.transFatGrams}g) violates SFDA bans on artificial trans-fats.`);
    }

    // 5. Mandatory Arabic Packaging
    if (!item.hasArabicLabel) {
      errors.push("[Bilingual Requirement] Missing Arabic nutritional facts and product description on retail packaging.");
    }

    return {
      isCompliant: errors.length === 0,
      remainingShelfLifePercentage: remainingPercentage,
      errors,
      warnings,
    };
  }

  /**
   * Prepares the clearance line item for SFDA electronic food import inspection submittals
   */
  public static buildFoodClearancePayload(item: FoodConsignmentItem, billOfLadingNumber: string) {
    return {
      consignmentHeader: {
        billOfLading: billOfLadingNumber,
        clearanceSubsystem: "SFDA_FOOD_INSPECTION",
        generatedAt: new Date().toISOString(),
      },
      itemDetails: {
        gtin: item.itemCodeGtin,
        productArabic: item.productNameArabic,
        productEnglish: item.productNameEnglish,
        category: item.category,
        dates: {
          production: item.productionDate,
          expiry: item.expiryDate,
          portArrival: item.expectedArrivalDate,
        },
        halalReference: item.halalCertificate?.certificateNumber ?? "NOT_APPLICABLE",
        allergensCount: item.declaredAllergens.length,
      },
    };
  }
}