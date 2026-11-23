-- Database-level safeguards (defence in depth behind the service layer).

-- 1. Items and sections of an APPROVED or SUPERSEDED BOQ revision can never change.
CREATE OR REPLACE FUNCTION epc_block_locked_boq() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM "BoqRevision" WHERE id = COALESCE(NEW."revisionId", OLD."revisionId");
  IF st IN ('APPROVED','SUPERSEDED') THEN
    RAISE EXCEPTION 'BOQ revision is % and cannot be modified', st USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
CREATE TRIGGER boq_item_lock BEFORE INSERT OR UPDATE OR DELETE ON "BoqItem" FOR EACH ROW EXECUTE FUNCTION epc_block_locked_boq();
CREATE TRIGGER boq_section_lock BEFORE INSERT OR UPDATE OR DELETE ON "BoqSection" FOR EACH ROW EXECUTE FUNCTION epc_block_locked_boq();

-- An approved revision may only move to SUPERSEDED.
CREATE OR REPLACE FUNCTION epc_revision_status_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'APPROVED' AND (NEW.status <> 'SUPERSEDED' OR NEW."revisionNo" <> OLD."revisionNo" OR NEW."contractId" <> OLD."contractId") THEN
    RAISE EXCEPTION 'Approved BOQ revision can only be superseded' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'Superseded BOQ revision is read-only' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER boq_revision_guard BEFORE UPDATE ON "BoqRevision" FOR EACH ROW EXECUTE FUNCTION epc_revision_status_guard();
CREATE OR REPLACE FUNCTION epc_no_delete_approved_revision() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('APPROVED','SUPERSEDED') THEN RAISE EXCEPTION 'Approved BOQ revision cannot be deleted' USING ERRCODE = 'P0001'; END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER boq_revision_nodelete BEFORE DELETE ON "BoqRevision" FOR EACH ROW EXECUTE FUNCTION epc_no_delete_approved_revision();

-- 2. Approved measurements: quantities and links are frozen. Only status progression / reversal marker may change.
CREATE OR REPLACE FUNCTION epc_measurement_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'Only draft measurements can be deleted' USING ERRCODE = 'P0001'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('PM_APPROVED','COMMERCIAL_REVIEWED','CERTIFIED','REVERSED') AND (
     NEW.quantity <> OLD.quantity OR NEW."activityId" <> OLD."activityId" OR NEW."workOrderItemId" <> OLD."workOrderItemId"
     OR NEW."boqItemId" <> OLD."boqItemId" OR NEW.date <> OLD.date
     OR NEW."chainageFrom" IS DISTINCT FROM OLD."chainageFrom" OR NEW."chainageTo" IS DISTINCT FROM OLD."chainageTo"
     OR NEW.rate IS DISTINCT FROM OLD.rate) THEN
    RAISE EXCEPTION 'Approved measurement cannot be edited; reverse it and record a correction' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER measurement_guard BEFORE UPDATE OR DELETE ON "Measurement" FOR EACH ROW EXECUTE FUNCTION epc_measurement_guard();

CREATE OR REPLACE FUNCTION epc_measurement_line_guard() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM "Measurement" WHERE id = COALESCE(NEW."measurementId", OLD."measurementId");
  IF st IS NOT NULL AND st NOT IN ('DRAFT','RETURNED') THEN
    RAISE EXCEPTION 'Measurement lines are locked once submitted' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
CREATE TRIGGER measurement_line_guard BEFORE INSERT OR UPDATE OR DELETE ON "MeasurementLine" FOR EACH ROW EXECUTE FUNCTION epc_measurement_line_guard();

-- 3. Ledgers are append-only.
CREATE OR REPLACE FUNCTION epc_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION epc_append_only();
CREATE TRIGGER workflow_append_only BEFORE UPDATE OR DELETE ON "WorkflowAction" FOR EACH ROW EXECUTE FUNCTION epc_append_only();
CREATE TRIGGER stock_append_only BEFORE UPDATE OR DELETE ON "StockTransaction" FOR EACH ROW EXECUTE FUNCTION epc_append_only();
CREATE TRIGGER snapshot_append_only BEFORE UPDATE OR DELETE ON "MeasurementSnapshot" FOR EACH ROW EXECUTE FUNCTION epc_append_only();
