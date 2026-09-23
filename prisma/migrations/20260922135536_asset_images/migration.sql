-- DropIndex
DROP INDEX "Transaction_portfolio_type_date_idx";

-- CreateTable
CREATE TABLE "AssetImage" (
    "assetId" UUID NOT NULL,
    "portfolioId" UUID NOT NULL,
    "content" BYTEA NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AssetImage_pkey" PRIMARY KEY ("assetId")
);

-- CreateIndex
CREATE INDEX "AssetImage_portfolioId_idx" ON "AssetImage"("portfolioId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetImage_assetId_portfolioId_key" ON "AssetImage"("assetId", "portfolioId");

-- AddForeignKey
ALTER TABLE "AssetImage" ADD CONSTRAINT "AssetImage_assetId_portfolioId_fkey" FOREIGN KEY ("assetId", "portfolioId") REFERENCES "Asset"("id", "portfolioId") ON DELETE RESTRICT ON UPDATE CASCADE;
