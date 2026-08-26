/** @file Deterministic table and JSON inventory reporting. */
import type {
  DeletionStatus,
  InventoryDocument,
  InventoryResource,
  InventorySection
} from "./types.js";

const compare = (a: string, b: string): number => a.localeCompare(b, "en");

function status(resource: InventoryResource): DeletionStatus {
  if (resource.referencedBy.length > 0 || resource.deletionBlockers.length > 0) return "No";
  return resource.deletionDiscoveryComplete ? "Yes" : "Unknown";
}

/** Builds the stable machine-readable inventory document. */
export function buildDocument(accountId: string, sections: InventorySection[]): InventoryDocument {
  const resources = sections
    .flatMap((section) => section.resources)
    .map((resource) => ({
      ...resource,
      details: Object.fromEntries(
        Object.entries(resource.details).sort(([a], [b]) => compare(a, b))
      ),
      referencedBy: [...resource.referencedBy].sort(compare),
      deletionBlockers: [...resource.deletionBlockers].sort(compare),
      deletionStatus: status(resource)
    }))
    .sort(
      (a, b) =>
        compare(a.product, b.product)
        || compare(a.resourceType, b.resourceType)
        || compare(a.name, b.name)
    );
  const errors = sections
    .flatMap((section) => section.errors)
    .sort(
      (a, b) =>
        compare(a.product, b.product)
        || compare(a.operation, b.operation)
        || compare(a.message, b.message)
    );
  const coverageNotes = sections
    .flatMap((section) => section.coverageNotes.map((note) => ({ product: section.product, note })))
    .sort((a, b) => compare(a.product, b.product) || compare(a.note, b.note));
  const deletion: Record<DeletionStatus, number> = { Yes: 0, No: 0, Unknown: 0 };
  for (const resource of resources) deletion[resource.deletionStatus] += 1;
  return {
    schemaVersion: 1,
    accountId,
    status: errors.length === 0 ? "complete" : "partial",
    summary: {
      products: sections.length,
      resources: resources.length,
      errors: errors.length,
      deletion
    },
    resources,
    errors,
    coverageNotes
  };
}

function table(rows: string[][]): string {
  const headers = ["SERVICE", "TYPE", "NAME", "ID", "BOUND TO / BLOCKER", "CAN DELETE"];
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column].length))
  );
  const line = (row: string[]): string =>
    row
      .map((cell, column) => cell.padEnd(widths[column]))
      .join("  ")
      .trimEnd();
  return [line(headers), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)].join(
    "\n"
  );
}

/** Renders table output, including partial-discovery errors and optional coverage notes. */
export function renderTable(document: InventoryDocument, verbose: boolean): string {
  const lines: string[] = [];
  if (document.resources.length === 0) lines.push("No resources found.");
  else
    lines.push(
      table(
        document.resources.map((resource) => [
          resource.product,
          resource.resourceType,
          resource.name,
          resource.id ?? "-",
          [...resource.referencedBy, ...resource.deletionBlockers].join(", ") || "-",
          resource.deletionStatus!
        ])
      )
    );
  if (document.errors.length > 0)
    lines.push(
      "",
      "Errors:",
      ...document.errors.map(
        (error) => `  - ${error.product}: ${error.operation}: ${error.message}`
      )
    );
  if (verbose && document.coverageNotes.length > 0)
    lines.push(
      "",
      "Coverage notes:",
      ...document.coverageNotes.map(({ product, note }) => `  - ${product}: ${note}`)
    );
  lines.push(
    "",
    `${document.summary.resources} resource(s) across ${document.summary.products} product(s); ${document.summary.errors} error(s).`
  );
  return `${lines.join("\n")}\n`;
}
