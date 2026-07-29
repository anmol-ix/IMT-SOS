import { z } from "zod";
import { requireCurrentUser } from "@/server/auth/current-user";
import { api, json } from "@/server/http";
import {
  createWorkbookValidation,
  getWorkbookReport,
  listWorkbookBatches,
  type WorkbookFile,
} from "@/server/workbook-import";
import type { WorkbookSheet } from "@/shared/workbook-import";

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const batchIdSchema = z.string().uuid();

function uploadedCsv(
  form: FormData,
  field: string,
  sheet: WorkbookSheet,
): File {
  const value = form.get(field);
  if (!(value instanceof File) || !value.name.toLowerCase().endsWith(".csv")) {
    throw new InvalidCsvUploadError(`Choose the exported ${sheet}.csv file.`);
  }
  if (value.size < 1 || value.size > MAX_FILE_BYTES) {
    throw new InvalidCsvUploadError(
      `${sheet}.csv must be between 1 byte and 3 MB.`,
    );
  }
  return value;
}

class InvalidCsvUploadError extends Error {
  readonly status = 400;
  readonly code = "INVALID_CSV_UPLOAD";

  constructor(message: string) {
    super(message);
    this.name = "InvalidCsvUploadError";
  }
}

export async function GET(request: Request) {
  return api(request, async (id) => {
    const owner = await requireCurrentUser(["BUSINESS_OWNER"]);
    const batchId = new URL(request.url).searchParams.get("batch");
    if (batchId) {
      const report = await getWorkbookReport(owner, batchIdSchema.parse(batchId));
      if (!report) return json({ error: { code: "NOT_FOUND", message: "Report not found." } }, 404, id);
      return json({ report }, 200, id);
    }
    return json({ batches: await listWorkbookBatches(owner) }, 200, id);
  });
}

export async function POST(request: Request) {
  return api(request, async (id) => {
    const owner = await requireCurrentUser(["BUSINESS_OWNER"]);
    const form = await request.formData();
    const uploads = [
      ["inventory", "Inventory Master"],
      ["sales", "Sales Log"],
      ["customers", "Customers"],
    ] as const;
    const selected = uploads.map(([field, sheet]) =>
      uploadedCsv(form, field, sheet)
    );
    const files: WorkbookFile[] = await Promise.all(
      selected.map(async (file, index) => ({
        sheet: uploads[index][1],
        name: file.name,
        content: await file.text(),
      })),
    );
    const report = await createWorkbookValidation(owner, files);
    return json({ report }, 201, id);
  });
}
