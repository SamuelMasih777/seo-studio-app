-- Add early-adopter and usage tracking fields to StoreSettings
ALTER TABLE "StoreSettings" ADD COLUMN "earlyAdopter" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StoreSettings" ADD COLUMN "earlyAdopterGrantedAt" TIMESTAMP(3);
ALTER TABLE "StoreSettings" ADD COLUMN "aiUsageCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StoreSettings" ADD COLUMN "compressionCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StoreSettings" ADD COLUMN "blogPostCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StoreSettings" ADD COLUMN "usageResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
