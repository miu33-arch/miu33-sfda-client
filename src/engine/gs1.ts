import { z } from "zod";

export const Gs1DataMatrixRecordSchema = z.object({
  gtin: z.string().regex(/^\d{14}$/, "GTIN must be exactly 14 digits"),
  expiryDateRaw: z.string().regex(/^\d{6}$/, "GS1 AI (17) date format must be YYMMDD"),
  batchLot: z.string().min(1).max(20),
  serialNumber: z.string().min(1).max(20),
  standardizedExpiryIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type Gs1DataMatrixRecord = z.infer<typeof Gs1DataMatrixRecordSchema>;

export interface Gs1ParseResult {
  success: boolean;
  record?: Gs1DataMatrixRecord;
  error?: string;
}

export interface WasfyBatchTelemetryPayload {
  reportingEntityGln: string;
  portal: "SFDA_RSD_WASFY";
  timestamp: string;
  consignmentReference: string;
  units: {
    gtin: string;
    expiryDate: string;
    batchNumber: string;
    serial: string;
  }[];
}

export class Gs1TraceabilityEngine {
  /**
   * GS1 Group Separator character (ASCII 29 / <GS>)
   */
  private static readonly GS = String.fromCharCode(29);

  /**
   * Parses raw GS1-128 / DataMatrix barcode string containing AIs (01), (17), (10), (21)
   * Handles both ASCII <GS> separated streams and bracketed human-readable strings.
   */
  public static parseDataMatrix(rawBarcode: string): Gs1ParseResult {
    let cleanBarcode = rawBarcode.trim();

    // 1. Check for bracketed human-readable format: (01)...(17)...(10)...(21)...
    if (cleanBarcode.includes("(") && cleanBarcode.includes(")")) {
      return this.parseBracketedString(cleanBarcode);
    }

    // 2. Parse raw FNC1 / ASCII GS stream
    return this.parseRawFncStream(cleanBarcode);
  }

  private static parseBracketedString(str: string): Gs1ParseResult {
    const gtinMatch = str.match(/\(01\)(\d{14})/);
    const expMatch = str.match(/\(17\)(\d{6})/);
    const batchMatch = str.match(/\(10\)([^()]+)/);
    const snMatch = str.match(/\(21\)([^()]+)/);

    if (!gtinMatch || !expMatch || !batchMatch || !snMatch) {
      return {
        success: false,
        error: "Missing required SFDA GS1 identifiers: (01) GTIN, (17) EXP, (10) BATCH, or (21) SN.",
      };
    }

    const gtin = gtinMatch[1];
    const expiryRaw = expMatch[1];
    const batchLot = batchMatch[1].trim();
    const serialNumber = snMatch[1].trim();

    return {
      success: true,
      record: {
        gtin,
        expiryDateRaw: expiryRaw,
        batchLot,
        serialNumber,
        standardizedExpiryIso: this.convertGs1DateToIso(expiryRaw),
      },
    };
  }

  private static parseRawFncStream(stream: string): Gs1ParseResult {
    // Normalizing possible visual representation of GS
    let cursor = stream.startsWith("]") ? stream.substring(3) : stream; // strip sym prefix like ]d2

    let gtin: string | null = null;
    let expiryRaw: string | null = null;
    let batchLot: string | null = null;
    let serialNumber: string | null = null;

    // AI 01: GTIN-14 (fixed length 14 digits)
    const idx01 = cursor.indexOf("01");
    if (idx01 !== -1 && cursor.length >= idx01 + 2 + 14) {
      gtin = cursor.substring(idx01 + 2, idx01 + 2 + 14);
      cursor = cursor.substring(0, idx01) + cursor.substring(idx01 + 2 + 14);
    }

    // AI 17: EXPIRY (fixed length 6 digits YYMMDD)
    const idx17 = cursor.indexOf("17");
    if (idx17 !== -1 && cursor.length >= idx17 + 2 + 6) {
      expiryRaw = cursor.substring(idx17 + 2, idx17 + 2 + 6);
      cursor = cursor.substring(0, idx17) + cursor.substring(idx17 + 2 + 6);
    }

    // Split remaining stream by GS character for variable-length fields (10) and (21)
    const segments = cursor.split(this.GS);
    for (const seg of segments) {
      if (seg.startsWith("10") && !batchLot) {
        batchLot = seg.substring(2);
      } else if (seg.startsWith("21") && !serialNumber) {
        serialNumber = seg.substring(2);
      }
    }

    if (!gtin || !expiryRaw || !batchLot || !serialNumber) {
      return {
        success: false,
        error: "Failed to resolve mandatory GS1 AI sequence (01, 17, 10, 21) from raw stream.",
      };
    }

    return {
      success: true,
      record: {
        gtin,
        expiryDateRaw: expiryRaw,
        batchLot,
        serialNumber,
        standardizedExpiryIso: this.convertGs1DateToIso(expiryRaw),
      },
    };
  }

  /**
   * Converts GS1 YYMMDD to standard ISO YYYY-MM-DD
   * If day is "00", sets to the last day of the given month.
   */
  public static convertGs1DateToIso(yymmdd: string): string {
    const yearShort = parseInt(yymmdd.substring(0, 2), 10);
    const month = parseInt(yymmdd.substring(2, 4), 10);
    let day = parseInt(yymmdd.substring(4, 6), 10);

    // GS1 51-99 indicates 1951-1999, 00-50 indicates 2000-2050
    const fullYear = yearShort < 51 ? 2000 + yearShort : 1900 + yearShort;

    if (day === 0) {
      // Last day of month
      const lastDay = new Date(fullYear, month, 0).getDate();
      day = lastDay;
    }

    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${fullYear}-${pad(month)}-${pad(day)}`;
  }

  /**
   * Prepares the serialized telemetry payload for the SFDA Wasfy (RSD) batch clearance gateway
   */
  public static buildWasfyBatchTelemetry(
    records: Gs1DataMatrixRecord[],
    reportingGln: string,
    consignmentId: string
  ): WasfyBatchTelemetryPayload {
    return {
      reportingEntityGln: reportingGln,
      portal: "SFDA_RSD_WASFY",
      timestamp: new Date().toISOString(),
      consignmentReference: consignmentId,
      units: records.map((r) => ({
        gtin: r.gtin,
        expiryDate: r.standardizedExpiryIso,
        batchNumber: r.batchLot,
        serial: r.serialNumber,
      })),
    };
  }
}