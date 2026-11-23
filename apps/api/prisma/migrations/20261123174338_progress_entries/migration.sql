-- CreateTable
CREATE TABLE "ProgressEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "allocationId" TEXT,
    "subcontractorId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "location" TEXT,
    "chainageFrom" DECIMAL(18,3),
    "chainageTo" DECIMAL(18,3),
    "manpower" INTEGER,
    "remarks" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProgressEntry_activityId_date_idx" ON "ProgressEntry"("activityId", "date");

-- AddForeignKey
ALTER TABLE "ProgressEntry" ADD CONSTRAINT "ProgressEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressEntry" ADD CONSTRAINT "ProgressEntry_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "ExecutionActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressEntry" ADD CONSTRAINT "ProgressEntry_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "WorkAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
