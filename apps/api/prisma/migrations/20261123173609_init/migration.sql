-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('WTP', 'STP', 'WATER_SUPPLY', 'PIPELINE', 'PUMPING_STATION', 'SEWERAGE', 'CIVIL', 'RCC_BUILDING', 'MECH_ELEC', 'INDUSTRIAL_EPC', 'HYDRO_MECHANICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('ITEM_RATE', 'PERCENTAGE_RATE', 'LUMP_SUM', 'EPC', 'DESIGN_BUILD');

-- CreateEnum
CREATE TYPE "RevisionType" AS ENUM ('ORIGINAL', 'REVISED', 'VARIATION');

-- CreateEnum
CREATE TYPE "RevisionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'SUPERSEDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BoqItemKind" AS ENUM ('ORIGINAL', 'EXTRA', 'SUBSTITUTED', 'DEVIATED');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'MAPPED', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AllocationMethod" AS ENUM ('PERCENT', 'FIXED_RATE');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SubcontractorStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'SUSPENDED', 'BLACKLISTED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MaterialResponsibility" AS ENUM ('COMPANY_RECOVERABLE', 'COMPANY_FREE_ISSUE', 'SUBCONTRACTOR', 'MIXED');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('ACTIVE', 'PENDING_EXCEPTION', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MeasurementStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'SE_VERIFIED', 'BILLING_SCRUTINIZED', 'PM_APPROVED', 'COMMERCIAL_REVIEWED', 'CERTIFIED', 'RETURNED', 'REVERSED');

-- CreateEnum
CREATE TYPE "MeasurementType" AS ENUM ('GENERIC', 'PIPELINE', 'EXCAVATION', 'RCC', 'REBAR');

-- CreateEnum
CREATE TYPE "MaterialCategory" AS ENUM ('CEMENT', 'STEEL', 'STRUCTURAL_STEEL', 'PIPE', 'FITTING', 'VALVE', 'ELECTRODE', 'FASTENER', 'AGGREGATE', 'SAND', 'ADMIXTURE', 'CONSUMABLE', 'TOOL', 'OTHER');

-- CreateEnum
CREATE TYPE "SupplyBasis" AS ENUM ('RECOVERABLE', 'FREE_ISSUE', 'SUBCONTRACTOR_SUPPLIED', 'RETURNABLE', 'CONSUMABLE', 'SCRAP');

-- CreateEnum
CREATE TYPE "StockTxnType" AS ENUM ('RECEIPT', 'ISSUE', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'SCRAP_OUT');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('ISSUED', 'ACKNOWLEDGED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnCondition" AS ENUM ('GOOD', 'EXCESS', 'DAMAGED', 'REJECTED', 'SCRAP');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "pan" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ProjectType" NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "client" TEXT,
    "location" TEXT,
    "state" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "subcontractorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permission")
);

-- CreateTable
CREATE TABLE "UserRoleAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT,
    "financialLimit" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "userName" TEXT,
    "companyId" TEXT,
    "projectId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowAction" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "comment" TEXT,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,

    CONSTRAINT "WorkflowAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocSequence" (
    "projectId" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DocSequence_pkey" PRIMARY KEY ("projectId","series")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "category" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contractNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "type" "ContractType" NOT NULL DEFAULT 'ITEM_RATE',
    "contractValue" DECIMAL(18,2) NOT NULL,
    "agreementDate" TIMESTAMP(3),
    "loaRef" TEXT,
    "startDate" TIMESTAMP(3),
    "completionDate" TIMESTAMP(3),
    "rebatePercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoqRevision" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "type" "RevisionType" NOT NULL,
    "status" "RevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "basedOnId" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "authorityRef" TEXT,
    "remarks" TEXT,
    "sourceDocumentId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "BoqRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoqSection" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "BoqSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoqItem" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "sectionId" TEXT,
    "itemKey" TEXT NOT NULL,
    "itemNo" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "rate" DECIMAL(18,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "isHeader" BOOLEAN NOT NULL DEFAULT false,
    "kind" "BoqItemKind" NOT NULL DEFAULT 'ORIGINAL',
    "substitutesKey" TEXT,
    "specRef" TEXT,
    "drawingRef" TEXT,
    "contractRef" TEXT,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "BoqItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoqImport" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "sheetName" TEXT,
    "headerRow" INTEGER,
    "mapping" JSONB,
    "rows" JSONB,
    "revisionId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoqImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionActivity" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "method" "AllocationMethod" NOT NULL,
    "percentage" DECIMAL(9,4),
    "fixedRate" DECIMAL(18,2),
    "unit" TEXT NOT NULL,
    "conversionFactor" DECIMAL(18,6) NOT NULL,
    "conversionBasis" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ExecutionActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subcontractor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "firmName" TEXT,
    "constitution" TEXT,
    "address" TEXT,
    "state" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "bankName" TEXT,
    "bankAccount" TEXT,
    "ifsc" TEXT,
    "workCategories" TEXT[],
    "gstRegistered" BOOLEAN NOT NULL DEFAULT true,
    "gstRate" DECIMAL(6,2) NOT NULL DEFAULT 18,
    "tdsSection" TEXT DEFAULT '194C',
    "tdsRate" DECIMAL(6,3) NOT NULL DEFAULT 1,
    "retentionPercent" DECIMAL(6,3) NOT NULL DEFAULT 5,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "status" "SubcontractorStatus" NOT NULL DEFAULT 'ONBOARDING',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subcontractor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubcontractorCompliance" (
    "id" TEXT NOT NULL,
    "subcontractorId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docNo" TEXT,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "documentId" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "remarks" TEXT,

    CONSTRAINT "SubcontractorCompliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "subcontractorId" TEXT NOT NULL,
    "woNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3),
    "completionDate" TIMESTAMP(3),
    "materialResponsibility" "MaterialResponsibility" NOT NULL DEFAULT 'COMPANY_RECOVERABLE',
    "retentionPercent" DECIMAL(6,3) NOT NULL,
    "securityDepositPercent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "advanceAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "advanceRecoveryPercent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "paymentTerms" TEXT,
    "recoveryConditions" TEXT,
    "otherDeductions" TEXT,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderItem" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "rate" DECIMAL(18,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "WorkOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderItemRate" (
    "id" TEXT NOT NULL,
    "workOrderItemId" TEXT NOT NULL,
    "rate" DECIMAL(18,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "amendmentId" TEXT,
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderItemRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderAmendment" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "amendmentNo" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "changes" JSONB NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'SUBMITTED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "WorkOrderAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkAllocation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "workOrderItemId" TEXT NOT NULL,
    "subcontractorId" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "zone" TEXT,
    "chainageFrom" DECIMAL(18,3),
    "chainageTo" DECIMAL(18,3),
    "remarks" TEXT,
    "status" "AllocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "exceptions" TEXT[],
    "exceptionReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "WorkAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Measurement" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "measurementNo" TEXT NOT NULL,
    "mbNo" TEXT,
    "mbPage" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "type" "MeasurementType" NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "workOrderItemId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "boqItemId" TEXT NOT NULL,
    "allocationId" TEXT,
    "location" TEXT,
    "structure" TEXT,
    "drawingRef" TEXT,
    "zone" TEXT,
    "chainageFrom" DECIMAL(18,3),
    "chainageTo" DECIMAL(18,3),
    "attributes" JSONB,
    "measurementRule" TEXT,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "rate" DECIMAL(18,2),
    "status" "MeasurementStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "reversalOfId" TEXT,
    "reversedById" TEXT,
    "remarks" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Measurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasurementLine" (
    "id" TEXT NOT NULL,
    "measurementId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "description" TEXT,
    "nos" DECIMAL(18,3),
    "length" DECIMAL(18,3),
    "breadth" DECIMAL(18,3),
    "depth" DECIMAL(18,3),
    "chainageFrom" DECIMAL(18,3),
    "chainageTo" DECIMAL(18,3),
    "barDia" DECIMAL(9,2),
    "cuttingLength" DECIMAL(18,3),
    "unitWeight" DECIMAL(18,4),
    "directQty" DECIMAL(18,3),
    "isDeduction" BOOLEAN NOT NULL DEFAULT false,
    "quantity" DECIMAL(18,3) NOT NULL,
    "formula" TEXT NOT NULL,

    CONSTRAINT "MeasurementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasurementSnapshot" (
    "id" TEXT NOT NULL,
    "measurementId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeasurementSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "MaterialCategory" NOT NULL,
    "unit" TEXT NOT NULL,
    "altUnit" TEXT,
    "altFactor" DECIMAL(18,6),
    "defaultBasis" "SupplyBasis" NOT NULL DEFAULT 'RECOVERABLE',
    "standardRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "batchTracked" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransaction" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" "StockTxnType" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "batchNo" TEXT,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "refNo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialReceipt" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "grnNo" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "supplier" TEXT,
    "invoiceRef" TEXT,
    "remarks" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lines" JSONB NOT NULL,

    CONSTRAINT "MaterialReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialRequisition" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reqNo" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "subcontractorId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "activityId" TEXT,
    "purpose" TEXT,
    "lines" JSONB NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'SUBMITTED',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialRequisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialIssue" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "voucherNo" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT NOT NULL,
    "subcontractorId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "activityId" TEXT,
    "requisitionId" TEXT,
    "transferFromReturnId" TEXT,
    "issuedById" TEXT NOT NULL,
    "issuedByName" TEXT NOT NULL,
    "receivedByName" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "status" "IssueStatus" NOT NULL DEFAULT 'ISSUED',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialIssueLine" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "issueRate" DECIMAL(18,4) NOT NULL,
    "issueValue" DECIMAL(18,2) NOT NULL,
    "basis" "SupplyBasis" NOT NULL,
    "recoveryRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "recoveryTerms" TEXT,
    "batchNo" TEXT,

    CONSTRAINT "MaterialIssueLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialReturn" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "voucherNo" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT NOT NULL,
    "subcontractorId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "transferToIssueId" TEXT,
    "receivedByName" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialReturnLine" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "condition" "ReturnCondition" NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "restock" BOOLEAN NOT NULL DEFAULT true,
    "batchNo" TEXT,

    CONSTRAINT "MaterialReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumptionNorm" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "normQty" DECIMAL(18,6) NOT NULL,
    "normUnit" TEXT NOT NULL,
    "wastagePercent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "basis" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "ConsumptionNorm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialReconciliation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reconNo" TEXT NOT NULL,
    "subcontractorId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "lines" JSONB NOT NULL,
    "totalRecoverable" DECIMAL(18,2) NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "MaterialReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_code_key" ON "Company"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Project_companyId_code_key" ON "Project"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_companyId_code_key" ON "Role"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "UserRoleAssignment_userId_roleId_projectId_key" ON "UserRoleAssignment"("userId", "roleId", "projectId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_projectId_at_idx" ON "AuditLog"("projectId", "at");

-- CreateIndex
CREATE INDEX "WorkflowAction_entityType_entityId_idx" ON "WorkflowAction"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Document_entityType_entityId_idx" ON "Document"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_projectId_contractNo_key" ON "Contract"("projectId", "contractNo");

-- CreateIndex
CREATE UNIQUE INDEX "BoqRevision_contractId_revisionNo_key" ON "BoqRevision"("contractId", "revisionNo");

-- CreateIndex
CREATE UNIQUE INDEX "BoqSection_revisionId_code_key" ON "BoqSection"("revisionId", "code");

-- CreateIndex
CREATE INDEX "BoqItem_itemKey_idx" ON "BoqItem"("itemKey");

-- CreateIndex
CREATE UNIQUE INDEX "BoqItem_revisionId_itemKey_key" ON "BoqItem"("revisionId", "itemKey");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionActivity_contractId_itemKey_code_key" ON "ExecutionActivity"("contractId", "itemKey", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Subcontractor_companyId_code_key" ON "Subcontractor"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_projectId_woNo_key" ON "WorkOrder"("projectId", "woNo");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderAmendment_workOrderId_amendmentNo_key" ON "WorkOrderAmendment"("workOrderId", "amendmentNo");

-- CreateIndex
CREATE INDEX "Measurement_activityId_status_idx" ON "Measurement"("activityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Measurement_projectId_measurementNo_key" ON "Measurement"("projectId", "measurementNo");

-- CreateIndex
CREATE UNIQUE INDEX "Material_companyId_code_key" ON "Material"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Store_projectId_code_key" ON "Store"("projectId", "code");

-- CreateIndex
CREATE INDEX "StockTransaction_storeId_materialId_date_idx" ON "StockTransaction"("storeId", "materialId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialReceipt_projectId_grnNo_key" ON "MaterialReceipt"("projectId", "grnNo");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialRequisition_projectId_reqNo_key" ON "MaterialRequisition"("projectId", "reqNo");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialIssue_projectId_voucherNo_key" ON "MaterialIssue"("projectId", "voucherNo");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialReturn_projectId_voucherNo_key" ON "MaterialReturn"("projectId", "voucherNo");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumptionNorm_activityId_materialId_key" ON "ConsumptionNorm"("activityId", "materialId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialReconciliation_projectId_reconNo_key" ON "MaterialReconciliation"("projectId", "reconNo");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocSequence" ADD CONSTRAINT "DocSequence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqRevision" ADD CONSTRAINT "BoqRevision_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqSection" ADD CONSTRAINT "BoqSection_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "BoqRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqItem" ADD CONSTRAINT "BoqItem_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "BoqRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqItem" ADD CONSTRAINT "BoqItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "BoqSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqImport" ADD CONSTRAINT "BoqImport_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionActivity" ADD CONSTRAINT "ExecutionActivity_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subcontractor" ADD CONSTRAINT "Subcontractor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractorCompliance" ADD CONSTRAINT "SubcontractorCompliance_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderItem" ADD CONSTRAINT "WorkOrderItem_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderItem" ADD CONSTRAINT "WorkOrderItem_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "ExecutionActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderItemRate" ADD CONSTRAINT "WorkOrderItemRate_workOrderItemId_fkey" FOREIGN KEY ("workOrderItemId") REFERENCES "WorkOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderAmendment" ADD CONSTRAINT "WorkOrderAmendment_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkAllocation" ADD CONSTRAINT "WorkAllocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkAllocation" ADD CONSTRAINT "WorkAllocation_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "ExecutionActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkAllocation" ADD CONSTRAINT "WorkAllocation_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkAllocation" ADD CONSTRAINT "WorkAllocation_workOrderItemId_fkey" FOREIGN KEY ("workOrderItemId") REFERENCES "WorkOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkAllocation" ADD CONSTRAINT "WorkAllocation_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_workOrderItemId_fkey" FOREIGN KEY ("workOrderItemId") REFERENCES "WorkOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "ExecutionActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "WorkAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasurementLine" ADD CONSTRAINT "MeasurementLine_measurementId_fkey" FOREIGN KEY ("measurementId") REFERENCES "Measurement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasurementSnapshot" ADD CONSTRAINT "MeasurementSnapshot_measurementId_fkey" FOREIGN KEY ("measurementId") REFERENCES "Measurement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReceipt" ADD CONSTRAINT "MaterialReceipt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequisition" ADD CONSTRAINT "MaterialRequisition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialIssue" ADD CONSTRAINT "MaterialIssue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialIssue" ADD CONSTRAINT "MaterialIssue_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialIssue" ADD CONSTRAINT "MaterialIssue_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialIssueLine" ADD CONSTRAINT "MaterialIssueLine_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "MaterialIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturn" ADD CONSTRAINT "MaterialReturn_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturn" ADD CONSTRAINT "MaterialReturn_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReturnLine" ADD CONSTRAINT "MaterialReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "MaterialReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionNorm" ADD CONSTRAINT "ConsumptionNorm_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionNorm" ADD CONSTRAINT "ConsumptionNorm_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "ExecutionActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionNorm" ADD CONSTRAINT "ConsumptionNorm_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialReconciliation" ADD CONSTRAINT "MaterialReconciliation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
