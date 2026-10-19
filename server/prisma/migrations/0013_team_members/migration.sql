-- AlterTable
ALTER TABLE "users" ADD COLUMN     "created_by" UUID;

-- CreateTable
CREATE TABLE "domain_members" (
    "domain_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_members_pkey" PRIMARY KEY ("domain_id","user_id")
);

-- CreateIndex
CREATE INDEX "domain_members_user_idx" ON "domain_members"("user_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "domain_members" ADD CONSTRAINT "domain_members_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "domain_members" ADD CONSTRAINT "domain_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
