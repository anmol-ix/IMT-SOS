import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import {
  getWorkbookReport,
  listWorkbookBatches,
  workbookValidationEnabled,
} from "@/server/workbook-import";
import MigrationWorkspace from "./MigrationWorkspace";

export default async function MigrationPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>;
}) {
  const owner = await requireCurrentUser(["BUSINESS_OWNER"]);
  const batches = await listWorkbookBatches(owner);
  const requested = z.string().uuid().safeParse((await searchParams).batch);
  const selectedId = requested.success ? requested.data : batches[0]?.id;
  const report = selectedId
    ? await getWorkbookReport(owner, selectedId)
    : null;

  return (
    <MigrationWorkspace
      displayName={owner.displayName}
      initialBatches={batches}
      initialReport={report}
      validationEnabled={workbookValidationEnabled()}
    />
  );
}
