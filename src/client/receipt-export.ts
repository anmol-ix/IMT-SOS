export type ReceiptExportData = {
  saleNumber: string;
  completedAt: string;
  customerName: string | null;
  saleType: "RETAIL" | "WHOLESALE";
  payments: Array<{
    paymentMode: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER";
    amountPaise: number;
  }>;
  totalPaise: number;
  amountPaidPaise: number;
  balanceDuePaise: number;
  dueReason: "CUSTOMER_WILL_PAY_LATER" | "DIGITAL_PAYMENT_PENDING" | null;
  lines: Array<{
    productName: string;
    sku: string;
    quantity: number;
    mrpPaise?: number;
    listedPricePaise?: number;
    unitPricePaise: number;
    totalPaise: number;
  }>;
};

export function receiptSavings(receipt: Pick<ReceiptExportData, "lines">) {
  return receipt.lines.reduce((totals, line) => {
    const listed = line.listedPricePaise ?? line.unitPricePaise;
    const mrp = line.mrpPaise ?? listed;
    totals.additionalDiscountPaise += Math.max(0, listed - line.unitPricePaise) * line.quantity;
    totals.totalSavingPaise += Math.max(0, mrp - line.unitPricePaise) * line.quantity;
    return totals;
  }, { additionalDiscountPaise: 0, totalSavingPaise: 0 });
}

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const receiptDate = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

const encoder = new TextEncoder();

function formatMoney(paise: number) {
  return money.format(paise / 100);
}

function paymentLabel(mode: ReceiptExportData["payments"][number]["paymentMode"]) {
  if (mode === "UPI") return "UPI";
  return mode === "BANK_TRANSFER"
    ? "Bank transfer"
    : mode.charAt(0) + mode.slice(1).toLowerCase();
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Receipt logo could not be loaded."));
    image.src = source;
  });
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && context.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Receipt image could not be created.")),
      type,
      quality,
    );
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function concatBytes(parts: Uint8Array[]) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function receiptFilename(receipt: Pick<ReceiptExportData, "saleNumber">) {
  return `ItsMyToy-${receipt.saleNumber.replace(/[^a-z0-9-]+/gi, "-")}`;
}

export function buildJpegPdf(
  jpeg: Uint8Array,
  imageWidth: number,
  imageHeight: number,
) {
  const pageWidth = 226.77;
  const pageHeight = Number((pageWidth * imageHeight / imageWidth).toFixed(2));
  const objects: Uint8Array[] = [
    encoder.encode("<< /Type /Catalog /Pages 2 0 R >>"),
    encoder.encode("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    encoder.encode(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] `
      + "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
    ),
    concatBytes([
      encoder.encode(
        `<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} `
        + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      ),
      jpeg,
      encoder.encode("\nendstream"),
    ]),
    (() => {
      const command = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ`;
      return encoder.encode(`<< /Length ${command.length} >>\nstream\n${command}\nendstream`);
    })(),
  ];

  const chunks: Uint8Array[] = [encoder.encode("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n")];
  const offsets = [0];
  let byteOffset = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(byteOffset);
    const chunk = concatBytes([
      encoder.encode(`${index + 1} 0 obj\n`),
      object,
      encoder.encode("\nendobj\n"),
    ]);
    chunks.push(chunk);
    byteOffset += chunk.length;
  });

  const xrefOffset = byteOffset;
  const xref = [
    `xref\n0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    `startxref\n${xrefOffset}`,
    "%%EOF",
  ].join("\n");
  chunks.push(encoder.encode(`${xref}\n`));
  return concatBytes(chunks);
}

export async function renderReceiptCanvas(receipt: ReceiptExportData) {
  const savings = receiptSavings(receipt);
  const scale = 2;
  const width = 640;
  const lineHeight = 31;
  const itemHeight = receipt.lines.reduce((height, line) => {
    const estimatedNameLines = Math.max(1, Math.ceil(line.productName.length / 28));
    return height + 66 + ((estimatedNameLines - 1) * lineHeight);
  }, 0);
  const paymentHeight = Math.max(1, receipt.payments.length) * 42;
  const savingsHeight = (savings.additionalDiscountPaise > 0 ? 30 : 0)
    + (savings.totalSavingPaise > 0 ? 30 : 0);
  const height = 780 + itemHeight + paymentHeight + savingsHeight
    + (receipt.balanceDuePaise > 0 ? 116 : 0);
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Receipt image is not supported in this browser.");
  context.scale(scale, scale);

  const left = 48;
  const right = width - 48;
  const usable = right - left;
  const center = width / 2;
  let y = 42;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#18181b";
  context.textBaseline = "top";
  context.textAlign = "left";

  try {
    const logo = await loadImage("/logo.png");
    context.save();
    context.beginPath();
    context.arc(center, y + 35, 35, 0, Math.PI * 2);
    context.clip();
    context.drawImage(logo, center - 35, y, 70, 70);
    context.restore();
  } catch {
    context.fillStyle = "#6d46ad";
    context.beginPath();
    context.arc(center, y + 35, 35, 0, Math.PI * 2);
    context.fill();
  }
  y += 86;

  context.textAlign = "center";
  context.fillStyle = "#111827";
  context.font = "700 28px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.fillText("ITSMYTOY", center, y);
  y += 36;
  context.fillStyle = "#475569";
  context.font = "600 16px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.fillText("WHOLESALE & RETAIL", center, y);
  y += 40;
  context.font = "800 24px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.fillStyle = "#111827";
  context.fillText("SALE RECEIPT", center, y);
  y += 43;

  const status = receipt.balanceDuePaise > 0
    ? receipt.amountPaidPaise > 0 ? "PARTLY PAID" : "PAYMENT DUE"
    : "PAID";
  context.fillStyle = receipt.balanceDuePaise > 0 ? "#fff2d8" : "#dcfce7";
  context.fillRect(center - 92, y, 184, 34);
  context.fillStyle = receipt.balanceDuePaise > 0 ? "#9a3412" : "#166534";
  context.font = "800 16px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.fillText(status, center, y + 8);
  y += 58;

  const divider = () => {
    context.strokeStyle = "#cbd5e1";
    context.setLineDash([8, 7]);
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(right, y);
    context.stroke();
    context.setLineDash([]);
    y += 22;
  };
  const labelValue = (label: string, value: string) => {
    context.textAlign = "left";
    context.fillStyle = "#64748b";
    context.font = "500 15px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.fillText(label.toUpperCase(), left, y);
    context.fillStyle = "#111827";
    context.font = "700 16px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.textAlign = "right";
    context.fillText(value, right, y);
    y += 30;
  };

  divider();
  labelValue("Sale receipt no.", receipt.saleNumber);
  labelValue("Date & time", receiptDate.format(new Date(receipt.completedAt)));
  labelValue("Sale type", receipt.saleType === "WHOLESALE" ? "Wholesale" : "Retail");
  labelValue("Customer", receipt.customerName ?? "Walk-in customer");
  y += 4;
  divider();

  context.font = "800 15px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.fillStyle = "#334155";
  context.textAlign = "left";
  context.fillText("ITEM", left, y);
  context.textAlign = "right";
  context.fillText("AMOUNT", right, y);
  y += 35;

  for (const line of receipt.lines) {
    context.textAlign = "left";
    context.fillStyle = "#111827";
    context.font = "700 18px ui-monospace, SFMono-Regular, Menlo, monospace";
    const nameLines = wrapText(context, line.productName, usable - 130);
    nameLines.forEach((text, index) => {
      context.fillText(text, left, y + (index * lineHeight));
    });
    context.textAlign = "right";
    context.fillText(formatMoney(line.totalPaise), right, y);
    y += nameLines.length * lineHeight;
    context.textAlign = "left";
    context.fillStyle = "#64748b";
    context.font = "500 14px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.fillText(
      `${line.quantity} × ${formatMoney(line.unitPricePaise)}  ·  ${line.sku}`,
      left,
      y,
    );
    y += 43;
  }

  divider();
  if (savings.additionalDiscountPaise > 0) {
    labelValue("Additional discount", `-${formatMoney(savings.additionalDiscountPaise)}`);
  }
  if (savings.totalSavingPaise > 0) {
    labelValue("You saved in total", formatMoney(savings.totalSavingPaise));
  }
  context.textAlign = "left";
  context.fillStyle = "#334155";
  context.font = "700 16px ui-monospace, SFMono-Regular, Menlo, monospace";
  if (receipt.payments.length === 0) {
    labelValue("Payment received", formatMoney(0));
  } else {
    receipt.payments.forEach((payment) => {
      labelValue(`Received by ${paymentLabel(payment.paymentMode)}`, formatMoney(payment.amountPaise));
    });
  }

  if (receipt.balanceDuePaise > 0) {
    context.fillStyle = "#fff1f2";
    context.fillRect(left, y + 2, usable, 78);
    context.fillStyle = "#9f1239";
    context.font = "800 17px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.textAlign = "left";
    context.fillText("BALANCE DUE", left + 18, y + 19);
    context.font = "900 28px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.textAlign = "right";
    context.fillText(formatMoney(receipt.balanceDuePaise), right - 18, y + 14);
    context.fillStyle = "#be123c";
    context.font = "600 13px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.textAlign = "left";
    context.fillText(
      receipt.dueReason === "DIGITAL_PAYMENT_PENDING"
        ? "Digital payment pending"
        : "Customer will pay later",
      left + 18,
      y + 50,
    );
    y += 102;
  }

  context.fillStyle = "#111827";
  context.font = "900 25px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "left";
  context.fillText("GRAND TOTAL", left, y);
  context.textAlign = "right";
  context.fillText(formatMoney(receipt.totalPaise), right, y);
  y += 46;
  divider();

  context.textAlign = "center";
  context.fillStyle = "#111827";
  context.font = "700 17px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.fillText("THANK YOU FOR SHOPPING WITH US", center, y);
  y += 31;
  context.fillStyle = "#64748b";
  context.font = "500 13px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.fillText("Keep this receipt for payment and exchange reference.", center, y);
  y += 25;
  context.fillText("This is a sale receipt, not a GST tax invoice.", center, y);
  y += 36;
  context.fillText(receipt.saleNumber, center, y);

  const tearY = height - 18;
  context.fillStyle = "#f1f5f9";
  for (let x = 0; x < width; x += 20) {
    context.beginPath();
    context.moveTo(x, tearY);
    context.lineTo(x + 10, height);
    context.lineTo(x + 20, tearY);
    context.fill();
  }
  return canvas;
}

export async function copyReceiptImage(receipt: ReceiptExportData) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("Copying images is not supported here. Download the image instead.");
  }
  const canvas = await renderReceiptCanvas(receipt);
  const blob = await canvasBlob(canvas, "image/png");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

export async function downloadReceiptImage(receipt: ReceiptExportData) {
  const canvas = await renderReceiptCanvas(receipt);
  const blob = await canvasBlob(canvas, "image/png");
  downloadBlob(blob, `${receiptFilename(receipt)}.png`);
}

export async function downloadReceiptPdf(receipt: ReceiptExportData) {
  const canvas = await renderReceiptCanvas(receipt);
  const jpegBlob = await canvasBlob(canvas, "image/jpeg", 0.96);
  const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());
  const pdf = buildJpegPdf(jpeg, canvas.width, canvas.height);
  downloadBlob(new Blob([pdf], { type: "application/pdf" }), `${receiptFilename(receipt)}.pdf`);
}
