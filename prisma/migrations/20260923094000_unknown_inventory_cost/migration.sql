-- An inventory can establish quantities without supplying acquisition costs.
ALTER TABLE "PortfolioSnapshot" ALTER COLUMN "investedEur" DROP NOT NULL;
