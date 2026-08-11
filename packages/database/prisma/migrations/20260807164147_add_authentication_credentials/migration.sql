/*
  Warnings:

  - A unique constraint covering the columns `[created_by_session_id]` on the table `sessions` will be added. If there are existing duplicate values, this will fail.
  - The required column `session_family_id` was added to the `sessions` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "created_by_session_id" UUID,
ADD COLUMN     "last_used_at" TIMESTAMPTZ(3),
ADD COLUMN     "rotated_at" TIMESTAMPTZ(3),
ADD COLUMN     "session_family_id" UUID NOT NULL;

-- CreateTable
CREATE TABLE "user_credentials" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "password_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_credentials_user_id_key" ON "user_credentials"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_created_by_session_id_key" ON "sessions"("created_by_session_id");

-- CreateIndex
CREATE INDEX "sessions_session_family_id_idx" ON "sessions"("session_family_id");

-- AddForeignKey
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_created_by_session_id_fkey" FOREIGN KEY ("created_by_session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
