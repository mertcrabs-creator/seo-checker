-- AlterTable
ALTER TABLE "audit_pages" ADD COLUMN     "canonical" TEXT,
ADD COLUMN     "external_links" INTEGER,
ADD COLUMN     "h2_count" INTEGER,
ADD COLUMN     "images" INTEGER,
ADD COLUMN     "images_no_alt" INTEGER,
ADD COLUMN     "in_sitemap" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inlinks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "internal_links" INTEGER,
ADD COLUMN     "lang" TEXT,
ADD COLUMN     "noindex" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "onpage_score" INTEGER,
ADD COLUMN     "primary_keyword" TEXT,
ADD COLUMN     "schema_types" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "audit_keywords" (
    "audit_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "count" INTEGER NOT NULL,
    "density" REAL NOT NULL,
    "in_title" BOOLEAN NOT NULL,
    "in_h1" BOOLEAN NOT NULL,
    "in_meta" BOOLEAN NOT NULL,
    "in_url" BOOLEAN NOT NULL,
    "in_headings" BOOLEAN NOT NULL,

    CONSTRAINT "audit_keywords_pkey" PRIMARY KEY ("audit_id","url","keyword")
);

-- CreateIndex
CREATE INDEX "audit_keywords_keyword_idx" ON "audit_keywords"("audit_id", "keyword");

-- AddForeignKey
ALTER TABLE "audit_keywords" ADD CONSTRAINT "audit_keywords_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "audits"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
