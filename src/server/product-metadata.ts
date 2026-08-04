import "server-only";

import type { CurrentUser } from "./auth/current-user";
import { requireRole } from "./auth/roles";
import { getDatabase } from "./database";

export type ProductMetadataOption = {
  name: string;
  code: string;
};

export type ProductSubcategoryOption = ProductMetadataOption & {
  category: string;
};

export type ProductMetadata = {
  categories: ProductMetadataOption[];
  subcategories: ProductSubcategoryOption[];
  brands: string[];
};

type ProductMetadataRow = {
  category: string;
  category_code: string;
  subcategory: string;
  subcategory_code: string;
  brand: string | null;
};

export async function listProductMetadata(
  user: CurrentUser,
): Promise<ProductMetadata> {
  requireRole(user.role, ["BUSINESS_OWNER", "TRUSTED_OPERATOR"]);
  const result = await getDatabase().query<ProductMetadataRow>(
    `SELECT DISTINCT
        p.category,
        split_part(v.sku, '-', 2) AS category_code,
        p.subcategory,
        split_part(v.sku, '-', 3) AS subcategory_code,
        p.brand
       FROM products p
       JOIN product_variants v ON v.product_id = p.id
      WHERE p.business_id = $1
        AND p.status = 'ACTIVE'
        AND v.status = 'ACTIVE'
      ORDER BY p.category, p.subcategory, p.brand NULLS LAST`,
    [user.businessId],
  );

  const categories = new Map<string, ProductMetadataOption>();
  const subcategories = new Map<string, ProductSubcategoryOption>();
  const brands = new Set<string>();

  for (const row of result.rows) {
    const categoryKey = row.category.trim().toLocaleLowerCase("en-IN");
    if (!categories.has(categoryKey)) {
      categories.set(categoryKey, {
        name: row.category,
        code: row.category_code,
      });
    }

    const subcategoryKey = `${categoryKey}:${row.subcategory
      .trim()
      .toLocaleLowerCase("en-IN")}`;
    if (!subcategories.has(subcategoryKey)) {
      subcategories.set(subcategoryKey, {
        name: row.subcategory,
        code: row.subcategory_code,
        category: row.category,
      });
    }

    if (row.brand?.trim()) brands.add(row.brand.trim());
  }

  return {
    categories: [...categories.values()],
    subcategories: [...subcategories.values()],
    brands: [...brands].sort((left, right) => left.localeCompare(right)),
  };
}
