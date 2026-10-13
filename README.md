# @miu33/sfda-client

Deterministic, zero-trust sovereign compliance engine and pre-clearance validation suite for Saudi Food & Drug Authority (**SFDA**) protocols and the **FASAH Customs Bayan** ecosystem.

Designed for high-throughput GCC trade corridors, cross-border ERP integrations, and EPC mega-project procurement channels.

---

## Key Capabilities

- **eCosma Cosmetic Dossier Engine (`GSO 1943:2021`):** In-memory formulation audit checking against banned Annex II ingredients, restricted concentration ceilings (e.g., salicylic acid, benzophenone-3), and mandatory Arabic outer-packaging metadata.
- **GHAD Medical Device Engine (`SFDA MDS-REQ 1`):** IMDRF/EU MDR risk-class tiering (Class A, B, C, D), automated MDMA (*Medical Device Marketing Authorization*) validity verification, and Authorized Representative (AR) / MDEL license enforcement.
- **Food & Supplement Port Clearance Engine (`SFDA.FD 150`):** Enforces port-of-entry shelf-life ceilings (auto-rejects consignments arriving with $<50\%$ remaining shelf life), trans-fat bans ($<0.1\text{g}$), and SFDA-accredited Halal certification tracking.
- **GS1 DataMatrix & Wasfy (وصفي) Telemetry:** High-speed string and ASCII 29 `<GS>` parser for Application Identifiers `(01)` GTIN, `(17)` Expiry, `(10)` Batch/Lot, and `(21)` Serial Number, formatted for the National Drug Track and Trace System (RSD).
- **Sovereign HS Code Bridge (`@miu33/sfda-fasah-bridge`):** Automatic line-item classification and routing between SFDA, SABER (SASO), and direct customs queues, compiling automated Bayan draft declarations with GCC duty ($5\%$) and statutory ZATCA VAT ($15\%$).
- **mTLS & Sovereign Auth Gateway:** OAuth2 token lifecycle management with automatic refresh skew margins and exponential backoff retry algorithms with randomized full jitter to absorb sovereign gateway throttling (`HTTP 429/503`).

---

## Architecture Flow