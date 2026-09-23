ALTER TABLE "Asset" ADD CONSTRAINT "asset_status_valid" CHECK (status IN ('ACTIVE', 'ARCHIVED'));
ALTER TABLE "Transaction" ADD CONSTRAINT "transaction_type_valid" CHECK (type IN ('BUY','SELL','DEPOSIT','WITHDRAWAL','TRANSFER','FEE','DIVIDEND','REWARD','ADJUSTMENT'));
ALTER TABLE "Transaction" ADD CONSTRAINT "transaction_currency_valid" CHECK (currency IN ('EUR','USD'));
ALTER TABLE "Transaction" ADD CONSTRAINT "transaction_values_valid" CHECK (
  quantity <> 'NaN'::numeric AND "unitPrice" >= 0 AND "unitPrice" <> 'NaN'::numeric
  AND fees >= 0 AND fees <> 'NaN'::numeric AND amount >= 0 AND amount <> 'NaN'::numeric
  AND "fxToEur" > 0 AND "fxToEur" <> 'NaN'::numeric
  AND ("fxToUsd" IS NULL OR ("fxToUsd" > 0 AND "fxToUsd" <> 'NaN'::numeric))
);
ALTER TABLE "PriceHistory" ADD CONSTRAINT "price_valid" CHECK (price >= 0 AND price <> 'NaN'::numeric);
ALTER TABLE "FxRate" ADD CONSTRAINT "fx_valid" CHECK ("eurUsd" > 0 AND "eurUsd" <> 'NaN'::numeric);
CREATE INDEX "Transaction_portfolio_type_date_idx" ON "Transaction" ("portfolioId", type, "occurredAt");
