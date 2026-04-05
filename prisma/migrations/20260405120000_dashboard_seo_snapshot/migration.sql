-- CreateTable
CREATE TABLE "DashboardSeoSnapshot" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardSeoSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DashboardSeoSnapshot_shop_key" ON "DashboardSeoSnapshot"("shop");
